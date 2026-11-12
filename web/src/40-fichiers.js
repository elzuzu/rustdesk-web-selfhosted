// ===================================================================
// Transfert de fichiers.
//
// Pourquoi une SECONDE connexion : sur le pair, `file_action` n'est traite que
// si `self.file_transfer.is_some()` (connection.rs), champ pose uniquement par
// `LoginRequest.file_transfer`. En session distante ordinaire, toute FileAction
// est ignoree EN SILENCE — ni erreur, ni accuse. Il faut donc une session
// dediee, qui n'ouvre aucun flux video.
//
// Pourquoi pas le presse-papier : un navigateur ne peut ecrire dans le
// presse-papier du systeme que text/plain, text/html et image/png. Il n'existe
// aucun chemin vers CF_HDROP (Windows) ni NSFilenamesPboardType (macOS). Coller
// un fichier du Mac dans le Finder local est hors d'atteinte du web —
// definitivement, pas temporairement. C'est aussi la conclusion de Teleport,
// Guacamole et Kasm, qui ouvrent tous un canal lateral plutot que d'essayer.
// ===================================================================
(function(){
  var BLOC = 128 * 1024;          // meme taille que le pair (fs.rs, BUF_SIZE)
  var HAUT = 4 * 1024 * 1024;     // contre-pression : on suspend au-dessus
  var T_FICHIER = 4;              // FileType.File (Dir=0, DirLink=2, DirDrive=3)

  var FT = {
    conn: null,
    etat: "ferme",                // ferme | ouverture | prete | erreur
    err: "",
    cwd: "",
    entries: [],
    jobs: {},
    prochainId: 1,
    attente: []
  };
  window.RDFT = FT;

  // ---------------------------------------------------------- utilitaires
  function taille(n){
    if (!(n > 0)) return "0 " + T("o");
    var u = [T("o"),T("Ko"),T("Mo"),T("Go"),T("To")], i = Math.floor(Math.log(n)/Math.log(1024));
    if (i > 4) i = 4;
    return (n/Math.pow(1024,i)).toFixed(i ? 1 : 0) + " " + u[i];
  }
  function date(s){
    if (!s) return "";
    try { return new Date(s*1000).toLocaleDateString(window.__rdLangue === "en" ? "en-GB" : "fr-CH",
            {day:"2-digit",month:"2-digit",year:"2-digit"}); }
    catch(_){ return ""; }
  }
  // Le pair est un Mac : separateur "/".
  function joindre(a, b){
    if (!a) return b; if (!b) return a;
    return a.replace(/\/+$/,"") + "/" + b.replace(/^\/+/,"");
  }
  function parent(p){
    if (!p || p === "/") return p || "";
    var i = p.replace(/\/+$/,"").lastIndexOf("/");
    return i <= 0 ? "/" : p.slice(0, i);
  }
  function base(p){ return (p || "").replace(/\/+$/,"").split("/").pop() || p; }
  function dormir(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  function envoyer(msg){
    var c = FT.conn;
    if (!c || !c._ws || !c._ws._websocket) return false;
    if (c._ws._websocket.readyState !== 1) return false;
    try { c._ws.sendMessage(msg); return true; }
    catch(e){ console.warn("[fichiers] envoi", e); return false; }
  }
  function tampon(){
    try { return FT.conn._ws._websocket.bufferedAmount; } catch(_){ return 0; }
  }

  // ------------------------------------------------------- sonde entrante
  // parseMessage est une methode de PROTOTYPE de la classe websock : on
  // l'enveloppe une seule fois, donc avant meme que la connexion fichier
  // n'existe. Aucune course, aucune table d'instances a tenir — file_response
  // n'arrive jamais sur la session video.
  var sondePosee = false;
  function poserSonde(){
    if (sondePosee) return true;
    var k = window.curConn;
    if (!k || !k._ws || !k._ws.constructor) return false;
    var WS = k._ws.constructor;
    if (!WS.prototype.__rdSonde){
      var orig = WS.prototype.parseMessage;
      WS.prototype.parseMessage = function(b){
        var m = orig.call(this, b);
        try { if (m && m.file_response) onReponse(m.file_response); }
        catch(e){ console.warn("[fichiers] reponse", e); }
        return m;
      };
      WS.prototype.__rdSonde = true;
      console.log("[fichiers] sonde de messages posee");
    }
    sondePosee = true;
    return true;
  }

  // ------------------------------------------------- ouverture de session
  function resoudre(ok, err){
    var l = FT.attente; FT.attente = [];
    l.forEach(function(p){ if (ok) p.res(FT.conn); else p.rej(new Error(err)); });
  }
  function echec(msg){
    FT.etat = "erreur"; FT.err = msg;
    console.warn("[fichiers] " + msg);
    majEtat(); resoudre(false, msg);
  }

  function ouvrir(){
    return new Promise(function(res, rej){
      if (FT.etat === "prete" && FT.conn) { res(FT.conn); return; }
      FT.attente.push({res:res, rej:rej});
      if (FT.etat === "ouverture") return;

      if (!poserSonde()){ echec("session vidéo absente"); return; }
      var k = window.curConn, id = k && k._id;
      if (!id){ echec("aucune session en cours"); return; }

      FT.etat = "ouverture"; FT.err = ""; majEtat();
      var c;
      try { c = new (k.constructor)(); }
      catch(e){ echec("instanciation impossible : " + e); return; }
      FT.conn = c;

      // --- Les quatre neutralisations, POSEES AVANT start() ---

      // 1. Le seul changement fonctionnel : declarer file_transfer dans le
      //    LoginRequest. `option` est volontairement omis — le pair ecarte
      //    hors perimetre toute option de login sur une session fichier
      //    (scoped_login_option), et nous n'en avons besoin d'aucune.
      c._sendLoginMessage = function(pwd){
        if (!this._ws) return;
        this._ws.sendMessage({ login_request: {
          username: this._id, my_id: "web", my_name: "web",
          password: pwd, video_ack_required: false,
          file_transfer: { dir: "", show_hidden: false }
        }});
      };

      // 2. L'original fait `if (displays.length == 0) msgbox("No Display")` :
      //    une session fichier n'a JAMAIS de display. Il faut donc le
      //    remplacer, pas l'envelopper — sinon la session s'annonce en erreur
      //    au moment meme ou elle reussit.
      c.handlePeerInfo = function(){
        FT.etat = "prete"; FT.err = "";
        console.log("[fichiers] session ouverte");
        majEtat(); resoudre(true);
      };

      // 3. Les messages de cette session ne doivent pas ecraser l'interface de
      //    la session video. setMsgbox est l'API publique du bundle pour cela.
      c.setMsgbox(function(type, titre, texte){
        if (type === "error"){ var m = texte || titre || "erreur"; fermer(); echec(m); }
      });

      // 4. Aucun flux video ici : ne pas charger ogv.js ni son wasm.
      c.loadVideoDecoder = function(){};

      c.start(id);   // ne se resout jamais : _start attend msgLoop
      setTimeout(function(){
        if (FT.etat === "ouverture") echec("délai dépassé à l'ouverture");
      }, 20000);
    });
  }

  function fermer(){
    var c = FT.conn; FT.conn = null;
    if (FT.etat !== "erreur") { FT.etat = "ferme"; FT.err = ""; }
    Object.keys(FT.jobs).forEach(function(k){ FT.jobs[k].annule = true; });
    if (c) { try { c.close(); } catch(_){} }
    majEtat();
  }
  FT.fermer = fermer;

  // ------------------------------------------------------------- travaux
  function nouveauJob(type, libelle){
    var j = { id: FT.prochainId++, type: type, libelle: libelle,
              fait: 0, total: 0, etat: "en cours", err: "",
              annule: false, chaine: Promise.resolve(), t0: Date.now(),
              apres: null, puits: null, numCourant: -1 };
    FT.jobs[j.id] = j; majFile();
    return j;
  }
  function finirJob(j, err){
    if (j.etat !== "en cours") return;
    j.etat = err ? "echec" : "fini"; j.err = err || "";
    if (err) console.warn("[fichiers] " + (j.libelle || j.type) + " : " + err);
    // Une etape interne qui echoue n'a pas de ligne a elle : sans cela, la
    // suppression d'un dossier resterait partielle en silence.
    if (err && j.discret){ FT.err = err; majEtat(); }
    majFile();
    if (!err && j.apres) { var f = j.apres; j.apres = null; try { f(); } catch(e){ console.warn(e); } }
    // Les reussites s'effacent d'elles-memes ; les echecs restent affiches,
    // sinon on ne saurait pas ce qui a rate.
    if (!err) setTimeout(function(){ delete FT.jobs[j.id]; majFile(); }, 4000);
  }

  // -------------------------------------------------------- navigation
  function lister(chemin){
    return ouvrir().then(function(){
      envoyer({ file_action: { read_dir: { path: chemin || "", include_hidden: false } } });
    });
  }
  FT.lister = lister;

  // --------------------------------------------------------- reception
  function onReponse(fr){
    if (fr.dir)   return onDir(fr.dir);
    if (fr.block) return onBloc(fr.block);
    if (fr.done)  return onFini(fr.done);
    if (fr.error) return onErreur(fr.error);
  }

  function onDir(d){
    var j = FT.jobs[d.id];
    // Une reponse read_dir n'a pas d'identifiant propre — le message ReadDir
    // n'a pas de champ id. Tout ce qui ne correspond pas a un travail en
    // attente de liste est donc un listing de navigation.
    if (j && j.attendListe){
      j.attendListe = false;
      var fichiers = (d.entries || []).slice();
      // Un chemin de FICHIER produit une entree unique au nom VIDE : le pair
      // en derive le nom depuis le chemin (fs.rs, read_dir_recursive, branche
      // is_file). On fait pareil, sinon le fichier serait ecrit sans nom.
      if (fichiers.length === 1 && !fichiers[0].name) fichiers[0].name = base(j.chemin);
      j.fichiers = fichiers;
      j.total = fichiers.reduce(function(a,f){ return a + (f.size||0); }, 0);
      majFile();
      if (j.suiteListe) j.suiteListe();
      return;
    }
    FT.cwd = d.path || FT.cwd;
    FT.entries = (d.entries || []).slice();
    rendreListe();
  }

  function onErreur(e){
    var j = FT.jobs[e.id];
    if (j) finirJob(j, e.error || "erreur");
    else { FT.err = e.error || "erreur"; majEtat(); }
  }

  function onFini(d){
    var j = FT.jobs[d.id];
    if (!j) return;
    // Enchaine derriere les blocs encore en traitement : `done` arrive apres
    // le dernier bloc sur le fil, mais notre traitement, lui, est asynchrone.
    j.chaine = j.chaine.then(function(){
      return j.puits ? Promise.resolve(j.puits.fermer()).catch(function(){}) : null;
    }).then(function(){
      j.puits = null;
      finirJob(j, j.annule ? "annule" : null);
    });
  }

  // ----------------------------------------------------- telechargement
  function onBloc(b){
    var j = FT.jobs[b.id];
    if (!j || j.type !== "dl" || j.annule) return;
    // Serialisation stricte : la decompression et l'ecriture sont asynchrones
    // et les blocs arrivent en rafale. Sans cette chaine, l'ordre des octets
    // ecrits dependrait de l'ordonnancement des promesses.
    j.chaine = j.chaine.then(function(){ return traiterBloc(j, b); })
                       .catch(function(e){ finirJob(j, String(e && e.message || e)); });
  }

  function traiterBloc(j, b){
    if (j.annule) return null;
    var num = b.file_num | 0;
    var p = Promise.resolve();
    if (j.numCourant !== num){
      if (j.puits) p = Promise.resolve(j.puits.fermer()).catch(function(){});
      p = p.then(function(){
        j.numCourant = num;
        var f = j.fichiers[num];
        if (!f) throw new Error("bloc hors liste (file_num " + num + ")");
        return ouvrirPuits(j, f.name);
      }).then(function(puits){ j.puits = puits; });
    }
    return p.then(function(){
      if (!b.compressed) return b.data;
      if (!window.__rdUnzstd) throw new Error("decodeur zstd absent du bundle");
      return window.__rdUnzstd(b.data).then(function(d){
        // Le decodeur ne leve jamais : une sortie VIDE est un echec, sauf si la
        // trame declare elle-meme une taille de 0 (voir RDLib.clip.decompress).
        if (!d || RDLib.clip.sortieVideSuspecte(b.data, d)) throw new Error("decompression zstd echouee");
        return d;
      });
    }).then(function(data){
      if (j.annule || !j.puits) return null;
      j.fait += data.length; majFile();
      return j.puits.ecrire(data);
    });
  }

  // cible : {dossier: FileSystemDirectoryHandle} | {handle: FileSystemFileHandle} | null
  function telecharger(entree, cible){
    var chemin = joindre(FT.cwd, entree.name);
    return ouvrir().then(function(){
      var j = nouveauJob("dl", "↓ " + entree.name);
      j.chemin = chemin;
      j.attendListe = true;
      j.dossierCible = (cible && cible.dossier) || null;
      j.handleUnique = (cible && cible.handle) || null;
      // Deux temps imposes par le protocole : all_files donne les noms dans
      // l'ORDRE EXACT ou les blocs arriveront (les deux passent par
      // get_recursive_files). C'est l'unique moyen de nommer un file_num.
      j.suiteListe = function(){
        if (!j.fichiers.length){ finirJob(j, "rien à transférer"); return; }
        envoyer({ file_action: { send: {
          id: j.id, path: chemin, file_num: 0, include_hidden: false } } });
      };
      envoyer({ file_action: { all_files: {
        id: j.id, path: chemin, include_hidden: false } } });
    });
  }
  FT.telecharger = telecharger;

  // ------------------------------------------------------------ puits
  function ouvrirPuits(j, nom){
    // 1. Chromium : ecriture directe sur le disque, bloc par bloc. Rien n'est
    //    accumule, un fichier de plusieurs Go passe sans occuper de memoire.
    if (j.dossierCible){
      return creerDansDossier(j.dossierCible, nom).then(function(fh){
        return fh.createWritable();
      }).then(enrober);
    }
    if (j.handleUnique){
      var h = j.handleUnique; j.handleUnique = null;
      return h.createWritable().then(enrober);
    }
    // 2. Partout ailleurs : accumulation en Blob. Contrairement a un tableau
    //    d'octets, un Blob n'est PAS tenu de rester en memoire — le navigateur
    //    le deverse sur disque. L'OPFS a ete ecarte : il faudrait de toute
    //    facon en ressortir un Blob pour declencher le telechargement, donc il
    //    ajouterait une copie complete sans rien resoudre.
    var parts = [];
    return Promise.resolve({
      ecrire: function(d){ parts.push(new Blob([d])); },
      fermer: function(){
        var blob = new Blob(parts, {type:"application/octet-stream"});
        parts = null;
        offrir(blob, base(nom));
      }
    });
  }
  function enrober(w){
    return { ecrire: function(d){ return w.write(d); },
             fermer: function(){ return w.close(); } };
  }

  function creerDansDossier(racine, nomRelatif){
    var bouts = nomRelatif.split("/").filter(Boolean);
    var fichier = bouts.pop();
    var p = Promise.resolve(racine);
    bouts.forEach(function(d){
      p = p.then(function(h){ return h.getDirectoryHandle(d, {create:true}); });
    });
    return p.then(function(h){ return h.getFileHandle(fichier, {create:true}); });
  }

  var offerts = [];
  function offrir(blob, nom){
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = nom; a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(function(){ a.remove(); }, 0);
    // L'URL reste vivante : elle sert au glisser-vers-le-bureau, et la
    // revoquer trop tot casserait un telechargement encore en cours.
    offerts.push({url:url, nom:nom, blob:blob});
    while (offerts.length > 12){ URL.revokeObjectURL(offerts.shift().url); }
    majFile();
  }

  // ------------------------------------------------------- televersement
  function televerser(fichiers, destination){
    if (!fichiers.length) return Promise.resolve();
    return ouvrir().then(function(){
      var total = fichiers.reduce(function(a,f){ return a + f.file.size; }, 0);
      var lib = fichiers.length === 1 ? "↑ " + (fichiers[0].chemin || fichiers[0].file.name)
                                      : "↑ " + fichiers.length + " fichiers";
      var j = nouveauJob("ul", lib);
      j.total = total;
      // Le pair attend la liste AVANT les blocs : elle fixe l'ordre, et donc
      // la signification de chaque file_num.
      envoyer({ file_action: { receive: {
        id: j.id, path: destination, file_num: 0, total_size: total,
        files: fichiers.map(function(f){
          return { entry_type: T_FICHIER,
                   name: f.chemin || f.file.name,
                   is_hidden: false,
                   size: f.file.size,
                   modified_time: Math.floor((f.file.lastModified || Date.now())/1000) };
        }) } } });
      return pousser(j, fichiers);
    });
  }
  FT.televerser = televerser;

  function pousser(j, fichiers){
    var i = 0;
    function fichierSuivant(){
      if (j.annule) return Promise.resolve();
      if (i >= fichiers.length){
        envoyer({ file_response: { done: { id: j.id, file_num: fichiers.length } } });
        finirJob(j, null);
        return Promise.resolve();
      }
      var num = i, f = fichiers[i++].file, pos = 0, blk = 0;
      function trancheSuivante(){
        if (j.annule) return Promise.resolve();
        if (pos >= f.size) return fichierSuivant();
        // Contre-pression : sans elle le tampon du socket enfle sans limite et
        // la session VIDEO devient saccadee — les deux connexions partagent la
        // meme liaison relais.
        if (tampon() > HAUT) return dormir(20).then(trancheSuivante);
        var fin = Math.min(pos + BLOC, f.size);
        return f.slice(pos, fin).arrayBuffer().then(function(buf){
          if (j.annule) return null;
          var d = new Uint8Array(buf);
          // compressed:false — le pair ne decompresse que sur ce drapeau, et
          // compresser ici couterait du temps processeur pour rien.
          if (!envoyer({ file_response: { block: {
                id: j.id, file_num: num, data: d, compressed: false, blk_id: blk++ } } })){
            throw new Error("liaison fermee");
          }
          pos = fin; j.fait += d.length; majFile();
          return trancheSuivante();
        });
      }
      return trancheSuivante();
    }
    return fichierSuivant().catch(function(e){ finirJob(j, String(e && e.message || e)); });
  }

  // ------------------------------------------------- lecture d'un depot
  // webkitGetAsEntry est supporte partout et sait descendre une arborescence
  // deposee. C'est le seul moyen d'accepter un DOSSIER par glisser-deposer.
  function lireEntree(entry, prefixe){
    return new Promise(function(res){
      if (entry.isFile){
        entry.file(function(f){ res([{ file:f, chemin: joindre(prefixe, entry.name) }]); },
                   function(){ res([]); });
      } else if (entry.isDirectory){
        var lect = entry.createReader(), tout = [];
        (function lot(){
          lect.readEntries(function(es){
            if (!es.length){
              Promise.all(tout.map(function(e){
                return lireEntree(e, joindre(prefixe, entry.name));
              })).then(function(rs){ res([].concat.apply([], rs)); });
              return;
            }
            tout = tout.concat(Array.prototype.slice.call(es));
            lot();
          }, function(){ res([]); });
        })();
      } else res([]);
    });
  }

  function depuisTransfert(dt){
    var items = dt && dt.items;
    if (items && items.length && items[0].webkitGetAsEntry){
      var es = [];
      for (var i=0;i<items.length;i++){
        if (items[i].kind !== "file") continue;
        var e = items[i].webkitGetAsEntry();
        if (e) es.push(e);
      }
      if (es.length){
        return Promise.all(es.map(function(e){ return lireEntree(e, ""); }))
                      .then(function(rs){ return [].concat.apply([], rs); });
      }
    }
    var fs = dt && dt.files ? Array.prototype.slice.call(dt.files) : [];
    return Promise.resolve(fs.map(function(f){ return { file:f, chemin:f.name }; }));
  }
  FT.depuisTransfert = depuisTransfert;

  function aDesFichiers(dt){
    if (!dt || !dt.types) return false;
    for (var i=0;i<dt.types.length;i++) if (dt.types[i] === "Files") return true;
    return false;
  }

  // =================================================================
  // Interface
  // =================================================================
  var pan, ul, filAr, etatEl, filesEl, btnHaut, btnMaj, btnUp, btnDir, inF, inD;

  function construire(){
    if (pan) return pan;
    pan = document.createElement("div"); pan.id = "rdfiles";

    var head = document.createElement("header");
    var titre = document.createElement("b"); titre.textContent = T("Fichiers distants");
    etatEl = document.createElement("span"); etatEl.className = "etat";
    var x = document.createElement("button"); x.textContent = "✕";
    x.title = T("Fermer le panneau"); x.onclick = function(){ basculer(false); };
    head.appendChild(titre); head.appendChild(etatEl); head.appendChild(x);

    var nav = document.createElement("nav");
    btnHaut = document.createElement("button"); btnHaut.textContent = "⟵";
    btnHaut.title = T("Dossier parent");
    btnHaut.onclick = function(){ lister(parent(FT.cwd)); rendreMain(); };
    btnMaj = document.createElement("button"); btnMaj.textContent = "⟳";
    btnMaj.title = T("Rafraîchir");
    btnMaj.onclick = function(){ lister(FT.cwd); rendreMain(); };
    btnUp = document.createElement("button"); btnUp.textContent = T("Téléverser");
    btnUp.title = T("Envoyer des fichiers ou un dossier vers ce répertoire");
    btnDir = document.createElement("button"); btnDir.textContent = T("+ Dossier");
    btnDir.onclick = function(){ demanderDossier(); };
    filAr = document.createElement("span"); filAr.className = "fil";
    [btnHaut, btnMaj, btnUp, btnDir, filAr].forEach(function(e){ nav.appendChild(e); });

    // Deux champs : webkitdirectory est exclusif, un navigateur ne peut pas
    // proposer "fichiers OU dossier" dans le meme selecteur.
    inF = document.createElement("input");
    inF.type = "file"; inF.multiple = true; inF.style.display = "none";
    inD = document.createElement("input");
    inD.type = "file"; inD.webkitdirectory = true; inD.style.display = "none";
    inF.onchange = function(){ depuisInput(inF); };
    inD.onchange = function(){ depuisInput(inD); };
    btnUp.onclick = function(){ choisirSource(); };

    ul = document.createElement("ul");
    filesEl = document.createElement("div"); filesEl.className = "files";
    var depot = document.createElement("div"); depot.className = "depot";
    depot.textContent = T("Déposer ici pour téléverser dans ce dossier");

    pan.appendChild(inF); pan.appendChild(inD);
    pan.appendChild(head); pan.appendChild(nav); pan.appendChild(ul);
    pan.appendChild(filesEl); pan.appendChild(depot);
    document.body.appendChild(pan);
    cablerDepot(pan);
    return pan;
  }

  function choisirSource(){
    modale({
      titre: T("Que téléverser ?"),
      corps: T("Le sélecteur du navigateur ne peut pas proposer les deux à la fois."),
      okTexte: T("Des fichiers"), autreTexte: T("Un dossier"),
      onOk:    function(){ inF.value = ""; inF.click(); },
      onAutre: function(){ inD.value = ""; inD.click(); }
    });
  }

  function depuisInput(inp){
    var fs = Array.prototype.slice.call(inp.files || []);
    if (!fs.length) return;
    var liste = fs.map(function(f){
      return { file:f, chemin: f.webkitRelativePath || f.name };
    });
    var dest = FT.cwd;
    televerser(liste, dest).then(function(){ lister(dest); });
  }

  function cablerDepot(cible){
    var n = 0;
    cible.addEventListener("dragover", function(ev){
      if (!aDesFichiers(ev.dataTransfer)) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = "copy";
    });
    cible.addEventListener("dragenter", function(ev){
      if (!aDesFichiers(ev.dataTransfer)) return;
      ev.preventDefault(); n++; pan.classList.add("survol");
    });
    cible.addEventListener("dragleave", function(){
      if (--n <= 0){ n = 0; pan.classList.remove("survol"); }
    });
    cible.addEventListener("drop", function(ev){
      if (!aDesFichiers(ev.dataTransfer)) return;
      ev.preventDefault(); n = 0; pan.classList.remove("survol");
      accepterDepot(ev.dataTransfer);
    });
  }

  function accepterDepot(dt){
    var dest = FT.cwd;
    return depuisTransfert(dt).then(function(liste){
      if (!liste.length) return null;
      basculer(true);
      return televerser(liste, dest).then(function(){ lister(dest); });
    });
  }
  FT.accepterDepot = accepterDepot;

  // ------------------------------------------------------------- rendus
  function majEtat(){
    if (!etatEl) return;
    var m = { ferme:T("déconnecté"), ouverture:T("connexion…"), prete:T("connecté"), erreur:T(FT.err) };
    etatEl.textContent = m[FT.etat] || FT.etat;
    etatEl.className = "etat" + (FT.etat === "erreur" ? " err" : "");
    var off = FT.etat !== "prete";
    [btnHaut, btnMaj, btnUp, btnDir].forEach(function(b){ if (b) b.disabled = off; });
  }

  function rendreMain(){ var c = window.__rdActive && window.__rdActive(); if (c) c.focus(); }

  function estDossier(e){ var t = e.entry_type|0; return t === 0 || t === 2 || t === 3; }

  function rendreListe(){
    if (!ul) return;
    filAr.innerHTML = "";
    var r = document.createElement("a"); r.textContent = "/";
    r.onclick = function(){ lister("/"); };
    filAr.appendChild(r);
    var acc = "";
    (FT.cwd || "").split("/").filter(Boolean).forEach(function(b, i){
      acc = acc + "/" + b;
      var chemin = acc;
      filAr.appendChild(document.createTextNode(i ? " / " : " "));
      var a = document.createElement("a"); a.textContent = b;
      a.onclick = function(){ lister(chemin); };
      filAr.appendChild(a);
    });

    ul.innerHTML = "";
    var es = FT.entries.slice().sort(function(a,b){
      var da = estDossier(a), db = estDossier(b);
      if (da !== db) return da ? -1 : 1;
      return (a.name||"").localeCompare(b.name||"", "fr");
    });
    if (!es.length){
      var v = document.createElement("li"); v.className = "vide";
      v.textContent = FT.etat === "prete" ? T("Dossier vide") : "…";
      ul.appendChild(v); return;
    }
    es.forEach(function(e){ ul.appendChild(ligne(e)); });
  }

  function ligne(e){
    var li = document.createElement("li");
    var dossier = estDossier(e);
    var nom = document.createElement("span"); nom.className = "nom";
    nom.textContent = (dossier ? "📁 " : "📄 ") + e.name;
    nom.title = dossier ? T("Ouvrir") : T("Télécharger");
    nom.onclick = function(){
      if (dossier) lister(joindre(FT.cwd, e.name)); else lancerTelechargement(e, dossier);
      rendreMain();
    };
    var meta = document.createElement("span"); meta.className = "meta";
    meta.textContent = (dossier ? "" : taille(e.size||0) + "  ") + date(e.modified_time);

    var actes = document.createElement("span"); actes.className = "actes";
    var dl = document.createElement("button"); dl.textContent = "↓";
    dl.title = dossier ? T("Télécharger le dossier") : T("Télécharger");
    dl.onclick = function(){ lancerTelechargement(e, dossier); rendreMain(); };
    var ren = document.createElement("button"); ren.textContent = "✏️";
    ren.title = T("Renommer"); ren.onclick = function(){ demanderRenommage(e); };
    var sup = document.createElement("button"); sup.textContent = "🗑";
    sup.title = T("Supprimer"); sup.onclick = function(){ demanderSuppression(e, dossier); };
    [dl, ren, sup].forEach(function(b){ actes.appendChild(b); });

    li.appendChild(nom); li.appendChild(meta); li.appendChild(actes);
    return li;
  }

  // Le selecteur de destination exige un geste utilisateur : il doit surgir
  // MAINTENANT, pas a l'arrivee du premier bloc.
  function lancerTelechargement(e, dossier){
    if (dossier && window.showDirectoryPicker){
      return window.showDirectoryPicker({ mode:"readwrite" })
        .then(function(h){ return telecharger(e, {dossier:h}); })
        .catch(function(){});
    }
    if (!dossier && window.showSaveFilePicker){
      return window.showSaveFilePicker({ suggestedName: e.name })
        .then(function(h){ return telecharger(e, {handle:h}); })
        .catch(function(){});
    }
    return telecharger(e, null);
  }

  function majFile(){
    if (!filesEl) return;
    filesEl.innerHTML = "";
    Object.keys(FT.jobs).forEach(function(k){
      var j = FT.jobs[k];
      if (j.discret) return;                                  // etapes internes
      if (j.type === "op" && j.etat === "en cours") return;   // trop bref pour etre utile
      var d = document.createElement("div");
      d.className = "job" + (j.etat === "echec" ? " ko" : "");
      var t = document.createElement("div"); t.className = "t";
      var n = document.createElement("span"); n.textContent = j.libelle;
      var em = document.createElement("em");
      var dt = (Date.now() - j.t0)/1000;
      em.textContent = j.etat === "echec" ? T(j.err)
                     : j.etat === "fini"  ? T("terminé")
                     : taille(j.fait) + (j.total ? " / " + taille(j.total) : "")
                       + (dt > 0.4 ? "  " + taille(j.fait/dt) + "/s" : "");
      t.appendChild(n); t.appendChild(em);
      if (j.etat === "en cours"){
        var x = document.createElement("button"); x.textContent = "✕";
        x.title = T("Annuler"); x.onclick = function(){ annuler(j); };
        t.appendChild(x);
      }
      d.appendChild(t);
      if (j.etat === "en cours" && j.total){
        var p = document.createElement("progress");
        p.max = j.total; p.value = Math.min(j.fait, j.total);
        d.appendChild(p);
      }
      filesEl.appendChild(d);
    });
    offerts.slice().reverse().forEach(function(o){ filesEl.appendChild(ligneOfferte(o)); });
  }

  function annuler(j){
    j.annule = true;
    envoyer({ file_action: { cancel: { id: j.id } } });
    finirJob(j, "annulé");
  }

  // ------------------------------- glisser vers le bureau (Chromium seul)
  // API non documentee, nee pour les pieces jointes de Gmail. C'est le plus
  // pres du "couper-coller vers le Finder" que le web autorise. Detectee par
  // la valeur de retour de setData, qui vaut false hors Chromium.
  function ligneOfferte(o){
    var d = document.createElement("div"); d.className = "job";
    var t = document.createElement("div"); t.className = "t";
    var n = document.createElement("span"); n.textContent = "✓ " + o.nom;
    n.style.cursor = "pointer";
    n.onclick = function(){
      var a = document.createElement("a"); a.href = o.url; a.download = o.nom;
      document.body.appendChild(a); a.click(); a.remove();
    };
    var em = document.createElement("em"); em.textContent = taille(o.blob.size);
    t.appendChild(n); t.appendChild(em); d.appendChild(t);
    d.draggable = true;
    d.title = T("Glisser vers le bureau (Chromium), ou cliquer pour retélécharger");
    d.addEventListener("dragstart", function(ev){
      var ok = false;
      try {
        ok = ev.dataTransfer.setData("DownloadURL",
              (o.blob.type || "application/octet-stream") + ":" + o.nom + ":" + o.url) !== false;
      } catch(_){ ok = false; }
      if (!ok) ev.preventDefault();
    });
    return d;
  }

  // ---------------------------------------------------------- modales
  // Pas de confirm()/prompt() natifs : ils bloquent la boucle d'evenements du
  // navigateur, et toute commande ulterieure resterait sans effet.
  var modal;
  function modale(o){
    if (!modal){
      modal = document.createElement("div"); modal.id = "rdmodal";
      document.body.appendChild(modal);
    }
    modal.innerHTML = "";
    var b = document.createElement("div"); b.className = "boite";
    var h = document.createElement("b"); h.textContent = o.titre;
    var p = document.createElement("p"); p.textContent = o.corps || "";
    b.appendChild(h); b.appendChild(p);
    if (o.avert){
      var av = document.createElement("p"); av.className = "avert";
      av.textContent = o.avert; b.appendChild(av);
    }
    var inp = null;
    if (o.champ !== undefined){
      inp = document.createElement("input"); inp.value = o.champ;
      inp.onkeydown = function(ev){ if (ev.key === "Enter") valider(); };
      b.appendChild(inp);
    }
    var btns = document.createElement("div"); btns.className = "btns";
    var no = document.createElement("button"); no.textContent = T("Annuler");
    no.onclick = function(){ fermerModale(); if (o.onAnnule) o.onAnnule(); };
    btns.appendChild(no);
    if (o.autreTexte){
      var au = document.createElement("button"); au.textContent = o.autreTexte;
      au.onclick = function(){ fermerModale(); if (o.onAutre) o.onAutre(); };
      btns.appendChild(au);
    }
    var ok = document.createElement("button");
    ok.textContent = o.okTexte || T("Confirmer");
    ok.className = "ok" + (o.danger ? " danger" : "");
    ok.onclick = valider; btns.appendChild(ok);
    b.appendChild(btns); modal.appendChild(b); modal.classList.add("ouvert");
    if (inp) setTimeout(function(){ inp.focus(); inp.select(); }, 30);

    function valider(){
      var v = inp ? inp.value : null;
      fermerModale(); if (o.onOk) o.onOk(v);
    }
  }
  function fermerModale(){ if (modal) modal.classList.remove("ouvert"); rendreMain(); }
  // Le bloc de session s'en sert aussi (redemarrage, code 2FA) : le bundle a
  // REMPLACE window.confirm par sa propre fonction, et prompt() gelerait la page.
  window.__rdModale = modale;

  function demanderDossier(){
    var dest = FT.cwd;
    modale({ titre:T("Nouveau dossier"), corps:T("Créé dans {0}", dest), champ:T("nouveau dossier"),
      onOk: function(nom){
        if (!nom) return;
        var j = nouveauJob("op", "+ " + nom);
        j.apres = function(){ lister(dest); };
        envoyer({ file_action: { create: { id:j.id, path: joindre(dest, nom) } } });
      }});
  }

  function demanderRenommage(e){
    var dest = FT.cwd;
    modale({ titre:T("Renommer"), corps: joindre(dest, e.name), champ:e.name,
      onOk: function(nom){
        if (!nom || nom === e.name) return;
        // new_name est un nom NU : le pair refuse tout separateur
        // (validate_file_name_no_traversal) et rejoint lui-meme le parent.
        var j = nouveauJob("op", "✏️ " + e.name);
        j.apres = function(){ lister(dest); };
        envoyer({ file_action: { rename: {
          id:j.id, path: joindre(dest, e.name), new_name: nom } } });
      }});
  }

  function demanderSuppression(e, dossier){
    var dest = FT.cwd, chemin = joindre(dest, e.name);
    modale({
      titre: dossier ? T("Supprimer le dossier") : T("Supprimer le fichier"),
      corps: chemin,
      avert: dossier
        ? T("Le dossier ET tout son contenu seront effacés sur le poste distant. Il n'y a pas de corbeille : c'est irréversible.")
        : T("Le fichier sera effacé sur le poste distant. Il n'y a pas de corbeille : c'est irréversible."),
      okTexte:T("Supprimer"), danger:true,
      onOk: function(){
        if (!dossier){
          var j = nouveauJob("op", "🗑 " + e.name);
          j.apres = function(){ lister(dest); };
          envoyer({ file_action: { remove_file: { id:j.id, path:chemin, file_num:0 } } });
          return;
        }
        // Second palier pour un dossier : le contenu ne revient pas.
        modale({ titre:T("Confirmer la suppression"),
          corps:T("Taper le nom du dossier pour confirmer : {0}", e.name),
          champ:"", okTexte:T("Supprimer définitivement"), danger:true,
          onOk: function(saisi){
            if (saisi !== e.name){ FT.err = "nom non confirmé"; majEtat(); return; }
            supprimerDossier(chemin, e.name, dest);
          }});
      }});
  }

  // remove_dir{recursive:true} n'efface PAS les fichiers : cote pair il appelle
  // remove_all_empty_dir, qui ne retire que les repertoires vides et les liens
  // (ui_cm_interface.rs). Il faut donc enumerer, effacer chaque fichier, puis
  // demander le retrait de l'arborescence videe. C'est ce que fait le client
  // natif, et l'ignorer laisserait le dossier intact sans le moindre message.
  function supprimerDossier(chemin, nom, dest){
    var j = nouveauJob("rm", "🗑 " + nom);
    j.attendListe = true;
    j.suiteListe = function(){
      var restants = j.fichiers.length;
      j.total = restants || 1;
      if (!restants){ finVidage(); return; }
      var k = 0;
      // Un identifiant par suppression, sinon les reponses seraient
      // indiscernables ; on ne suit que le compte.
      j.fichiers.forEach(function(f){
        var sub = nouveauJob("op", "");
        sub.discret = true;
        sub.apres = function(){ avance(); };
        envoyer({ file_action: { remove_file: {
          id: sub.id, path: joindre(chemin, f.name), file_num: 0 } } });
      });
      function avance(){
        k++; j.fait = k; majFile();
        if (k >= restants) finVidage();
      }
    };
    function finVidage(){
      var fin = nouveauJob("op", "");
      fin.discret = true;
      fin.apres = function(){ finirJob(j, null); lister(dest); };
      envoyer({ file_action: { remove_dir: { id: fin.id, path: chemin, recursive: true } } });
    }
    envoyer({ file_action: { all_files: { id:j.id, path:chemin, include_hidden:true } } });
  }

  // ------------------------------------------------------- bascule / bouton
  function basculer(ouvert){
    construire();
    if (ouvert === undefined) ouvert = !pan.classList.contains("ouvert");
    pan.classList.toggle("ouvert", !!ouvert);
    if (ouvert){
      majEtat(); majFile();
      lister(FT.cwd || "").catch(function(e){ console.warn("[fichiers]", e); });
    } else rendreMain();
  }
  FT.basculer = basculer;

  // Le bouton se greffe sur la barre existante des qu'elle apparait : le bloc
  // precedent n'a ainsi rien a connaitre de ce module.
  var greffe = setInterval(function(){
    var bar = window.__rdBar;
    if (!bar || bar.querySelector(".rdfilesbtn")) return;
    var b = document.createElement("button");
    b.className = "rdfilesbtn"; b.textContent = T("Fichiers");
    b.title = T("Parcourir, téléverser et télécharger sur le poste distant");
    b.onclick = function(){ basculer(); };
    var q = bar.querySelector("button.quit");
    if (q) bar.insertBefore(b, q); else bar.appendChild(b);
    clearInterval(greffe);
  }, 400);

  // Depot sur le canvas video : meme geste, meme destination.
  document.addEventListener("dragover", function(ev){
    var c = window.__rdActive && window.__rdActive();
    if (!c || ev.target !== c || !aDesFichiers(ev.dataTransfer)) return;
    ev.preventDefault(); ev.dataTransfer.dropEffect = "copy";
  });
  document.addEventListener("drop", function(ev){
    var c = window.__rdActive && window.__rdActive();
    if (!c || ev.target !== c || !aDesFichiers(ev.dataTransfer)) return;
    ev.preventDefault(); accepterDepot(ev.dataTransfer);
  });

  // La session fichier ne survit pas a la session video : on la ferme avec.
  setInterval(function(){
    if (!window.__rdEtait && FT.conn) fermer();
  }, 1500);

  // Diagnostic, en pendant de rdDiag().
  window.rdFiles = function(){
    console.group("Transfert de fichiers");
    console.log("etat      : " + FT.etat + (FT.err ? " (" + FT.err + ")" : ""));
    console.log("dossier   : " + FT.cwd + " — " + FT.entries.length + " entree(s)");
    Object.keys(FT.jobs).forEach(function(k){
      var j = FT.jobs[k];
      console.log("  #" + j.id + " " + (j.libelle || j.type) + " — " + j.etat + " "
                  + taille(j.fait) + " / " + taille(j.total));
    });
    console.log("tampon    : " + taille(tampon()));
    console.log("zstd      : " + (window.__rdUnzstd ? "disponible" : "ABSENT"));
    console.groupEnd();
  };
})();
