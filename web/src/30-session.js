// Couche d'entree et chemin video WebCodecs.
// ui.js ne cable que l'affichage : souris, clavier et codec sont ajoutes ici,
// par substitution de methodes sur window.curConn. Aucun patch du bundle.
(function(){
  var RD = window.RD;

  // La langue de l'interface, fixee au chargement : la preference memorisee,
  // sinon celle du navigateur. window.__rdT sert aux autres blocs.
  var LANGUE = (function(){
    var pref = null;
    try { pref = RDLib.prefs.create(window.localStorage).get().lang; } catch(_){}
    return RDLib.i18n.langue(pref, window.navigator && window.navigator.language);
  })();
  var T = RDLib.i18n.creer(LANGUE);
  window.__rdT = T; window.__rdLangue = LANGUE;
  try { document.documentElement.setAttribute("lang", LANGUE); } catch(_){}

  // ---------------------------------------------------------------- entrees
  var CTRL={Enter:"Return",Backspace:"Backspace",Escape:"Escape",Tab:"Tab",
    ArrowLeft:"LeftArrow",ArrowRight:"RightArrow",ArrowUp:"UpArrow",ArrowDown:"DownArrow",
    Home:"Home",End:"End",Delete:"Delete",Insert:"Insert",PageUp:"PageUp",
    PageDown:"PageDown"," ":"Space",CapsLock:"CapsLock",
    Alt:"Alt",AltGraph:"Alt",Control:"Control",Shift:"Shift",Meta:"Meta"};
  for(var i=1;i<=12;i++) CTRL["F"+i]="F"+i;
  var MODK={Shift:1,Control:1,Alt:1,AltGraph:1,Meta:1};

  function send(n,v){ try{ window.setByName(n, JSON.stringify(v)); }catch(e){ console.warn("[entree]",e); } }
  function mods(e){ return {alt:String(e.altKey),ctrl:String(e.ctrlKey),
                            shift:String(e.shiftKey),command:String(e.metaKey)}; }

  // RustDesk transmet les modificateurs UN POUR UN : Ctrl+C arrive en Control+C
  // sur le Mac, ou copier est Cmd+C. Seul le Terminal y reagit, parce que
  // Control+C y est le vrai raccourci (SIGINT) — d'ou l'impression trompeuse
  // que "ca marche par endroits". Les raccourcis sont donc TRADUITS ici, cote
  // navigateur, selon les deux plateformes (RDLib.clavier) : clavier PC devant
  // un Mac, clavier Mac devant un PC, ou rien si les deux sont de la meme famille.
  // Desactivable : dans un terminal distant, Control doit rester Control.
  // (La cle de stockage garde son nom d'origine : c'etait une simple permutation.)
  var clavierTraduit = localStorage.getItem("rd-swap-ctrl") !== "0";
  var PLATEFORME_LOCALE = (function(){
    try{
      var n = window.navigator || {};
      return (n.userAgentData && n.userAgentData.platform) || n.platform || n.userAgent || "";
    }catch(_){ return ""; }
  })();
  var LOCAL_MAC = RDLib.clavier.famille(PLATEFORME_LOCALE) === "mac";
  function plateformeDistante(){
    try{ var c = window.curConn; return (c && c._peerInfo && c._peerInfo.platform) || ""; }
    catch(_){ return ""; }
  }
  // Lu a chaque frappe : la plateforme du pair n'est connue qu'a peer_info, et
  // change d'une session a l'autre.
  function modeClavier(){
    return clavierTraduit ? RDLib.clavier.mode(PLATEFORME_LOCALE, plateformeDistante()) : "direct";
  }
  function versPont(r){ return {alt:String(r.alt),ctrl:String(r.ctrl),shift:String(r.shift),command:String(r.meta)}; }
  function etat(e){ return {ctrl:!!e.ctrlKey,alt:!!e.altKey,shift:!!e.shiftKey,meta:!!e.metaKey}; }
  // Les modificateurs d'un evenement souris, traduits (Ctrl+clic -> Cmd+clic).
  function modsSouris(e){ return versPont(RDLib.clavier.souris(modeClavier(), etat(e))); }
  function merge(a,b){ for(var k in b) a[k]=b[k]; return a; }
  // Bornee a l'image : avec la capture du pointeur, un glisser continue hors du
  // canvas, et le pair ne doit pas recevoir de coordonnees hors de son ecran.
  function pos(c,e){ var r=c.getBoundingClientRect();
    function b(v,max){ return Math.max(0, Math.min(Math.max(0,(max|0)-1), Math.round(v)||0)); }
    return {x:b((e.clientX-r.left)*(c.width/r.width), c.width),
            y:b((e.clientY-r.top)*(c.height/r.height), c.height)}; }
  function btn(e){ return e.button===2?"right":e.button===1?"wheel":"left"; }

  // Envoi direct d'un message protobuf via la connexion courante.
  // curConn est expose globalement et ses proprietes survivent a la
  // minification, donc aucun patch du bundle n'est necessaire.
  function rdSend(msg){
    try{
      if(!RD.ready) return false;                     // jamais avant peer_info :
      var c=window.curConn;                           // les compteurs secretbox
      if(!c||!c._ws||!c._ws._websocket) return false; // seraient desynchronises
      if(c._ws._websocket.readyState!==1) return false;
      c._ws.sendMessage(msg);
      return true;
    }catch(e){ console.warn("[envoi]",e); return false; }
  }
  window.__rdSend = rdSend;

  // ------------------------------------------------------------- canvas
  function player(){ return document.getElementById("player"); }
  function rdcanvas(){
    var c = document.getElementById("rdcanvas");
    if (c) return c;
    var p = player(); if (!p) return null;
    c = document.createElement("canvas");
    c.id = "rdcanvas";
    p.parentNode.insertBefore(c, p.nextSibling);
    return c;
  }
  // Le canvas reellement affiche depend du chemin de decodage actif.
  function active(){ return RD.codec ? rdcanvas() : player(); }
  window.__rdActive = active;

  function showActive(){
    var p = player(), r = document.getElementById("rdcanvas");
    if (!p) return;
    if (RD.codec && r){ p.style.display="none"; r.style.display="block"; }
    else { p.style.display="block"; if(r) r.style.display="none"; }
  }

  // Taille d'affichage calculee a la main : conserver le ratio exact evite
  // les bandes noires DANS l'element, qui fausseraient les coordonnees souris.
  function fitCanvas(){
    var c = active(); if(!c || !c.width || !c.height) return;
    var k = Math.min(window.innerWidth/c.width, window.innerHeight/c.height);
    c.style.width  = Math.floor(c.width*k)+"px";
    c.style.height = Math.floor(c.height*k)+"px";
    placerHud();
  }
  window.__rdFit = fitCanvas;

  // fitCanvas conserve le rapport d'image : des qu'il differe de celui de la
  // fenetre — ce qui est le cas courant, un navigateur n'etant presque jamais
  // exactement au format de l'ecran distant — il reste une bande noire. Le HUD
  // est colle en bas a gauche : il ne mord sur l'image que si NI la bande
  // basse NI la bande gauche ne peuvent le contenir. Tant qu'une des deux le
  // peut, il garde sa plaque et ne masque rien du tout ; sinon il passe en
  // halo, sans plaque. Aucune position n'est calculee ici, seulement constatee.
  function placerHud(){
    var h = window.__rdHud; if (!h) return;
    var b = h.getBoundingClientRect();
    if (!b.height) return;                       // masque : rien a decider
    var c = active();
    var r = (c && c.getBoundingClientRect) ? c.getBoundingClientRect() : null;
    var hors = !!r && (b.height <= Math.floor(window.innerHeight - r.bottom)
                    || b.width  <= Math.floor(r.left));
    h.classList.toggle("horsimage", hors);
    h.classList.toggle("surimage", !hors);
  }
  window.__rdPlacerHud = placerHud;

  // --------------------------------------------------------- sonde codec
  // Les chaines, l'ordre de preference et la declaration au pair sont dans
  // RDLib.codec (logique pure, testee sous Node). Ici : ce que CE navigateur
  // sait decoder (RD.caps), et ce qui a echoue sur cette page (RD.rates).
  var CODECS = RDLib.codec.CHAINES;
  function configDecodeur(){
    return { codec: CODECS[RD.codec], codedWidth: RD.W||1920, codedHeight: RD.H||1080,
             hardwareAcceleration: "prefer-hardware", optimizeForLatency: true };
  }
  // TOUS les codecs sont sondes, pas seulement le premier accepte : le pair
  // choisit parmi ceux qu'on lui annonce, et le repli descend l'echelle.
  async function probeCodecs(){
    RD.caps = {};
    if (typeof VideoDecoder === "undefined"){
      console.log("[codec] WebCodecs indisponible — decodage logiciel");
      return null;
    }
    var w = RD.W || 1920, h = RD.H || 1080, caps = {};
    for (var name of RDLib.codec.ORDRE){
      try{
        var s = await VideoDecoder.isConfigSupported({
          codec: CODECS[name], codedWidth: w, codedHeight: h,
          hardwareAcceleration: "prefer-hardware", optimizeForLatency: true });
        caps[name] = !!(s && s.supported);
        console.log("[codec] "+name+(caps[name] ? " accepte ("+CODECS[name]+")" : " refuse"));
      }catch(e){ caps[name] = false; console.log("[codec] "+name+" refuse ("+e.name+")"); }
    }
    RD.caps = caps;
    return RDLib.codec.meilleur(RD.caps, RD.rates);
  }

  // ------------------------------------------------------ decodeur unique
  // Un seul VideoDecoder pour toute la vie de la page : conn.close() ne ferme
  // que le decodeur ogv, le notre fuirait a chaque reconnexion.
  function ensureDecoder(){
    if (RD.dec && RD.dec.state !== "closed") return RD.dec;
    var ctx = null, pendingFrame = null, rafId = null;

    function drawPendingFrame(){
      rafId = null;
      if (!pendingFrame) return;
      var frame = pendingFrame; pendingFrame = null;
      try {
        var c = rdcanvas();
        if (c.width !== frame.displayWidth || c.height !== frame.displayHeight){
          c.width = frame.displayWidth; c.height = frame.displayHeight;
          ctx = null; fitCanvas();
        }
        if (!ctx) {
          ctx = c.getContext("2d", {alpha:false, desynchronized:true});
          if (ctx) ctx.imageSmoothingEnabled = false;
        }
        ctx.drawImage(frame, 0, 0);
        RD.errors = 0;
        var S = RD.stats, t0 = S.pend.shift();
        if (t0 !== undefined){
          S.decode.push(performance.now() - t0);
          if (S.decode.length > 300) S.decode.shift();
        }
        S.frames++;
      } catch(e){ console.warn("[webcodecs] rendu", e); }
      finally { frame.close(); }
    }

    RD.dec = new VideoDecoder({
      output: function(frame){
        // Le decodeur sort les trames au rythme du reseau, l'ecran ne les
        // affiche qu'au rafraichissement : dessiner hors de ce rythme fait du
        // travail invisible. On ne garde donc que la derniere trame arrivee et
        // on la dessine dans le rAF suivant. Une trame remplacee avant d'etre
        // affichee est fermee sur-le-champ, sinon le pool GPU se vide.
        if (pendingFrame) { pendingFrame.close(); }
        pendingFrame = frame;
        if (!rafId) { rafId = requestAnimationFrame(drawPendingFrame); }
      },
      error: function(e){
        console.warn("[webcodecs] erreur", e.message||e);
        // Une erreur FERME le decodeur : le suivant, recree a la prochaine trame,
        // ne peut repartir que d'une image-cle. Sans la demander, il jetait
        // tous les deltas en attendant une cle que personne n'enverrait.
        RD.wantKey = true;
        if (++RD.errors >= 3) fallbackToSoftware("erreurs de decodage repetees");
        else { try{ window.curConn && window.curConn.refresh(); }catch(_){} }
      }
    });
    RD.dec.configure(configDecodeur());
    RD.wantKey = true;
    console.log("[webcodecs] configure en "+RD.codec);
    return RD.dec;
  }
  function resetDecoder(){
    if (!RD.dec || RD.dec.state === "closed") return;
    try{ RD.dec.reset(); RD.dec.configure(configDecodeur()); }
    catch(e){ console.warn("[webcodecs] reset", e); }
    RD.wantKey = true;
    try{ window.curConn && window.curConn.refresh(); }catch(_){}
  }
  // Le pair emet un autre codec que celui pour lequel le decodeur est
  // configure : on le suit. Pas d'image-cle demandee — un changement de codec
  // commence par une cle, et la trame qui nous l'apprend la porte.
  function changerCodec(nom){
    console.log("[codec] le pair emet en "+nom+" (decodeur en "+RD.codec+") : bascule");
    RD.codec = nom; RD.errors = 0; RD.wantKey = true;
    RD.stats.pend.length = 0;
    if (RD.dec && RD.dec.state !== "closed"){
      try{ RD.dec.reset(); RD.dec.configure(configDecodeur()); }
      catch(e){ console.warn("[webcodecs] bascule", e); try{ RD.dec.close(); }catch(_){} RD.dec = null; }
    }
  }
  window.__rdResetDecoder = function(){ if (RD.codec) resetDecoder(); };

  // ---------------------------------------------------- negociation codec
  function negotiate(){
    if (!RD.ready) return false;
    var ab = RDLib.codec.capacites(RD.codec, codecForce(), RD.caps, RD.rates);
    var ok = rdSend({misc:{option:{supported_decoding:ab}}});
    if (ok){
      console.log("[codec] declare : "+(RD.codec||"logiciel")+" (prefer="+ab.prefer+")");
      try{ window.curConn.refresh(); }catch(_){}   // force une image-cle
    }
    return ok;
  }
  // Un codec nomme par l'utilisateur, par opposition a « auto » et « logiciel ».
  function codecForce(){ return !!RDLib.codec.PREFER[RD.forced]; }
  window.__rdNegotiate = function(){
    if (RD.forced === "logiciel"){ RD.codec = null; showActive(); negotiate(); return; }
    if (codecForce()){ RD.codec = RD.forced; }
    // En automatique, chaque session repart du meilleur codec encore valable :
    // un renoncement propre a UNE session (pair sans encodeur adequat) ne doit
    // pas condamner les suivantes au logiciel jusqu'au rechargement.
    else if (RDLib.codec.meilleur(RD.caps, RD.rates)){ RD.codec = RDLib.codec.meilleur(RD.caps, RD.rates); }
    RD.horsPortee = 0;
    if (RD.codec) { ensureDecoder(); }
    showActive(); fitCanvas(); negotiate();
  };

  // Repli : renegocier AVANT de restaurer, sinon le serveur continue d'emettre
  // du H265 que la methode d'origine ne sait ni decoder ni acquitter -> freeze.
  function fallbackToSoftware(raison){
    if (!RD.codec) return;
    console.warn("[codec] repli logiciel : "+raison);
    // Un codec FORCE (et memorise) qui ne tient pas reviendrait a chaque session,
    // et echouerait de la meme facon : on le rend a « auto ».
    if (codecForce()){
      var ancien = RD.forced;
      RD.forced = "auto";
      prefs.set({ codec: "auto" });
      if (ui.cod) ui.cod.value = "auto";
      notifier(T("Codec {0} indisponible ({1}) : retour en automatique.", ancien.toUpperCase(), raison), "erreur");
    }
    // Un codec qui a echoue n'est plus propose de toute la vie de la page, et
    // l'on descend d'un barreau avant de renoncer a WebCodecs : H265 en panne
    // ne condamne plus a du VP9 logiciel quand H264 ou AV1 sont la.
    RD.rates[RD.codec] = true;
    var suivant = RDLib.codec.meilleur(RD.caps, RD.rates);
    if (suivant){
      console.warn("[codec] " + RD.codec + " abandonne, essai en " + suivant);
      RD.codec = suivant; RD.errors = 0; RD.wantKey = true;
      RD.stats.pend.length = 0;
      try{ if (RD.dec && RD.dec.state !== "closed") RD.dec.close(); }catch(_){}
      RD.dec = null;
      negotiate();
      showActive(); fitCanvas();
      return;
    }
    RD.codec = null; RD.errors = 0;
    negotiate();
    var c = window.curConn;
    if (c && c.__rdOrigHandle){ c.handleVideoFrame = c.__rdOrigHandle; }
    if (c && c.__rdOrigDraw){ c.draw = c.__rdOrigDraw; }
    showActive(); fitCanvas();
  }
  window.__rdFallback = fallbackToSoftware;

  // ---------------------------------------------------------------- retours
  // Une seule region « aria-live », creee a la demande. Les echecs passent en
  // role="alert" (annonces tout de suite), le reste en role="status".
  var toastsZone = null;
  // Une region « aria-live » creee EN MEME TEMPS que son premier contenu n'est
  // pas annoncee de facon fiable : elle est donc posee d'avance (wireGlobal).
  function zoneRetours(){
    if (!toastsZone){
      toastsZone = document.createElement("div");
      toastsZone.id = "rdtoasts";
      toastsZone.setAttribute("aria-live", "polite");
      document.body.appendChild(toastsZone);
    }
    return toastsZone;
  }
  function notifier(texte, niveau){
    try{
      zoneRetours();
      var t = document.createElement("div");
      t.className = "rdtoast" + (niveau === "erreur" ? " erreur" : "");
      t.setAttribute("role", niveau === "erreur" ? "alert" : "status");
      t.textContent = texte;
      toastsZone.appendChild(t);
      setTimeout(function(){ t.remove(); }, niveau === "erreur" ? 9000 : 4500);
    }catch(e){ console.warn("[retour]", e); }
  }
  window.__rdToast = notifier;

  // Le texte d'une erreur de presse-papier, pour l'utilisateur.
  function messageErreur(e){
    if (e && e.name === "ClipError") return RDLib.messages[e.code] ? T(RDLib.messages[e.code]) : String(e.message);
    if (e && e.name === "NotAllowedError") return T(RDLib.messages.DENIED);
    return T("Presse-papier : opération impossible ({0}).", (e && e.name) || "erreur");
  }

  // ============================================ presse-papier ENTRANT
  // Le poste distant annonce son presse-papier de deux facons, et le bundle
  // n'en traite qu'une : « clipboard », qu'il decode inconditionnellement en
  // texte, et « multi_clipboards », pour lequel msgLoop n'a aucune branche —
  // un presse-papier multi-format arrive donc et se perd en silence.
  //
  // On se greffe sur « this._ws.next() », dont msgLoop tire chaque message :
  // c'est le seul endroit ou l'on voit le message decode AVANT l'aiguillage,
  // ce qui permet aussi de lui retirer une image que sa branche texte
  // collerait sinon en charabia.
  //
  // Ce point de greffe est sur le chemin de TOUS les messages, video comprise :
  // msgLoop est sequentiel et acquitte chaque image par sendVideoReceived. On
  // n'y fait donc que RANGER ce qui arrive — le decodage et la conversion en
  // PNG, qui coutent des dizaines de millisecondes sur une capture d'ecran,
  // partent dans une tache a part et leur resultat est une promesse.
  var FMT_PNG_R = RDLib.clip.FMT.PNG, FMT_RGBA_R = RDLib.clip.FMT.RGBA;
  var ppSlots = RDLib.clip.slots();        // un emplacement par usage : image / texte

  // Le decodeur zstd du bundle. __rdZstdDecoder (patch 5) donne le decodeur
  // lui-meme, dont on choisit la taille de destination ; un bundle patche par
  // une version anterieure n'a que __rdUnzstd, dont le tampon est trop petit
  // pour une image tres compressible : on s'en sert quand meme, mais une sortie
  // vide y est une erreur.
  async function ppDecodeur(){
    if (window.__rdZstdDecoder) return await window.__rdZstdDecoder();
    if (window.__rdUnzstd){
      return { unique: true, decode: function(u8){ return window.__rdUnzstd(u8); } };
    }
    throw RDLib.clip.ClipError(RDLib.clip.ERR.DECODE, "decodeur zstd absent du bundle");
  }

  async function ppContenu(cb, attendu){
    var d = cb.content;
    if (cb.compress) d = await RDLib.clip.decompress(await ppDecodeur(), d, { hint: attendu || 0 });
    return d;
  }

  // Le format 21 transporte les octets bruts de l'image. Passer par un canvas
  // est le seul moyen d'en faire un PNG, seul type d'image qu'un navigateur
  // accepte d'ecrire dans le presse-papier du systeme.
  async function ppRgbaEnPng(pixels, w, h){
    var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    var cx = cv.getContext("2d");
    var img = cx.createImageData(w, h);
    img.data.set(pixels);
    cx.putImageData(img, 0, 0);
    var blob = await new Promise(function(r){ cv.toBlob(r, "image/png"); });
    if (!blob) throw RDLib.clip.ClipError(RDLib.clip.ERR.ENCODE, "toBlob a rendu null (" + w + "x" + h + ")");
    return blob;
  }

  // Image -> Blob PNG. Deux formes : PNG (deja pret, au mieux a decompresser)
  // et RGBA brut (a valider puis a passer par un canvas).
  async function ppImageEnBlob(image){
    var cb = image.cb;
    if (image.kind === "png"){
      var png = await ppContenu(cb, 0);
      // Des octets qui ne sont pas un PNG feraient echouer write() avec un nom
      // generique, et le bouton resterait pour rien.
      if (!RDLib.clip.estPng(png))
        throw RDLib.clip.ClipError(RDLib.clip.ERR.DECODE, "signature PNG absente (" + (png ? png.length : 0) + " octets)");
      return new Blob([png], { type: "image/png" });
    }
    var w = cb.width | 0, h = cb.height | 0;
    var brut = await ppContenu(cb, w * h * 4);
    console.log("[presse-papier] image décompressée : " + RDLib.clip.describe(cb, brut.length));
    return ppRgbaEnPng(RDLib.clip.rgbaPixels(brut, w, h), w, h);
  }

  async function ppTexteEnValeur(sel){
    var r = { html: null, texte: null };
    if (sel.html) r.html = new TextDecoder().decode(await ppContenu(sel.html, 0));
    if (sel.text) r.texte = new TextDecoder().decode(await ppContenu(sel.text, 0));
    return r;
  }

  // Range l'image : la conversion demarre tout de suite, mais HORS du chemin de
  // msgLoop — un « setTimeout » que personne n'attend. Un emplacement remplace
  // avant que la tache ne tourne n'est pas converti du tout.
  function ppRangerImage(image){
    var slot = { kind: "image", cb: image.cb, w: image.cb.width, h: image.cb.height };
    slot.promesse = new Promise(function(resolve, reject){
      setTimeout(function(){
        // Supplante avant que la tache ne tourne : inutile de convertir — sauf si
        // un clic l'attend deja (voir ppDeposer), auquel cas sa promesse doit tenir.
        if (ppSlots.get("image") !== slot && !slot.clique){ resolve(null); return; }
        ppImageEnBlob(image).then(function(blob){
          slot.pret = true;
          image.cb.content = null;                                   // les octets recus ne servent plus
          resolve(blob);
        }, reject);
      }, 0);
    });
    slot.promesse.catch(function(e){                                 // pas de « unhandledrejection »
      slot.erreur = e;
      console.warn("[presse-papier] conversion de l'image : " + (e && e.message || e));
    });
    ppSlots.put("image", slot);
  }

  function ppRangerTexte(sel){
    var slot = { kind: "text", riche: !!sel.html };
    slot.promesse = ppTexteEnValeur(sel);
    slot.promesse.catch(function(e){
      slot.erreur = e;
      console.warn("[presse-papier] decodage du texte : " + (e && e.message || e));
    });
    ppSlots.put("text", slot);
  }

  function ppRetenir(liste){
    var sel = RDLib.clip.select(liste);
    (liste || []).forEach(function(cb){
      if (cb) console.log("[presse-papier] recu du poste distant : " + RDLib.clip.describe(cb));
    });
    if (sel.image) ppRangerImage(sel.image);
    if (sel.html || sel.text) ppRangerTexte(sel);
    if (sel.image || sel.html || sel.text) ppAuto();
  }

  // ------------------------------------------------ depot AUTOMATIQUE
  // Copier sur le poste distant doit suffire : ce qui en arrive est ecrit tout
  // de suite dans le presse-papier local, sans bouton. C'est possible parce
  // que la copie distante est presque toujours declenchee par un geste DANS
  // cette page (Ctrl+C, un clic sur un menu) : le navigateur accorde alors
  // l'ecriture pendant quelques secondes, et le contenu revient en moins d'une.
  //
  // Quand il refuse — page sans le focus, navigateur plus strict — le bouton
  // d'avant reprend son role, et le depot est retente au prochain geste. Sauf
  // si la page a perdu le focus entre-temps : l'utilisateur a pu copier autre
  // chose ailleurs, et l'ecraser avec un contenu plus ancien serait une faute.
  var clipSync = { actif: false, dernier: null };
  function ppFocus(){
    try{ return typeof document.hasFocus === "function" && document.hasFocus()
              && document.visibilityState === "visible"; }
    catch(_){ return false; }
  }
  function ppAuto(){
    if (!ppFocus() || !window.navigator.clipboard){ ppBouton(); return; }
    ppSlots.kinds().forEach(function(kind){
      var slot = ppSlots.get(kind);
      if (!slot || slot.essai) return;
      slot.essai = true;
      ppDeposer(kind, { auto: true }).then(function(ok){
        slot.essai = false;
        if (ok || ppSlots.get(kind) !== slot) return;
        slot.reessayer = ppFocus();
        ppBouton();
      });
    });
  }
  // Au prochain geste dans la page : le navigateur vient de rouvrir le droit d'ecrire.
  function ppGeste(){
    ppSlots.kinds().forEach(function(kind){
      var slot = ppSlots.get(kind);
      if (!slot || !slot.reessayer || slot.essai) return;
      slot.reessayer = false; slot.essai = true;
      ppDeposer(kind, { auto: true }).then(function(ok){ slot.essai = false; if (!ok) ppBouton(); });
    });
  }
  function ppOublierReprises(){
    ppSlots.kinds().forEach(function(kind){ var s = ppSlots.get(kind); if (s) s.reessayer = false; });
  }
  try{
    // Sur window, en capture : aucun ecouteur clavier n'est pose sur document
    // (le canvas transmet ses touches au poste distant, et rien ne doit les doubler).
    ["keydown", "pointerdown"].forEach(function(t){ window.addEventListener(t, ppGeste, true); });
    window.addEventListener("blur", ppOublierReprises);
  }catch(_){}
  window.__rdPpGeste = ppGeste; window.__rdPpBlur = ppOublierReprises;

  // Synchrone, et volontairement : rien ici ne doit retarder msgLoop.
  function ppFiltrer(m){
    if (!m) return m;
    if (m.multi_clipboards && m.multi_clipboards.clipboards
        && m.multi_clipboards.clipboards.length){
      ppRetenir(m.multi_clipboards.clipboards);
      return m;                       // le bundle l'ignore, rien a lui cacher
    }
    if (m.clipboard && (m.clipboard.format === FMT_PNG_R
                     || m.clipboard.format === FMT_RGBA_R)){
      var cb = m.clipboard;
      delete m.clipboard;             // sinon : TextDecoder sur du PNG
      ppRetenir([cb]);
    }
    // Texte simple (pairs anterieurs a 1.3.0, ou client annonce comme tel). Le
    // bundle le posait par execCommand("copy"), hors de tout geste : presque
    // toujours refuse, et sans rien dire. La page s'en charge, comme du reste —
    // sauf sans API de presse-papier (page servie en http), ou il garde la main.
    var cl = window.navigator && window.navigator.clipboard;
    if (m.clipboard && cl && typeof cl.writeText === "function"){
      var ct = m.clipboard;
      delete m.clipboard;
      ppRetenir([ct]);
    }
    return m;
  }

  // Ecrire dans le presse-papier du systeme exige, selon les navigateurs, une
  // activation utilisateur recente (Safari l'exige strictement). Une pose
  // automatique a la reception n'est donc pas fiable — d'ou ces boutons, qui
  // fournissent le geste. C'est le meme choix que Guacamole, qui expose une zone
  // dediee plutot que d'automatiser. Un bouton par usage : image, texte.
  var PP_LIBELLES = { image: "Image reçue ⇩", text: "Texte reçu ⇩" };
  function ppBouton(){
    var bar = window.__rdBar;
    if (!bar) return;
    ppSlots.kinds().forEach(function(kind){
      var b = bar.querySelector('.rdppbtn[data-kind="' + kind + '"]');
      if (!b){
        b = document.createElement("button");
        b.className = "rdppbtn";
        b.setAttribute("data-kind", kind);
        b.onclick = function(){ ppDeposer(kind); };
        bar.insertBefore(b, bar.firstChild);
      }
      b.textContent = T(PP_LIBELLES[kind]);
      b.title = T("Déposer ce contenu dans le presse-papier de ce navigateur. Un clic est nécessaire : le navigateur n'écrit pas dans le presse-papier sans geste de ta part.");
    });
    if (ppSlots.kinds().length) bar.classList.add("attention");
  }

  function ppRetirerBouton(kind){
    var bar = window.__rdBar;
    if (!bar) return;
    var b = bar.querySelector('.rdppbtn[data-kind="' + kind + '"]');
    if (b) b.remove();
    if (!ppSlots.kinds().length) bar.classList.remove("attention");
  }

  // Une image : la PROMESSE du blob va directement dans le ClipboardItem. Le
  // geste est ainsi consomme au clic, que la conversion soit finie ou non.
  // Certains navigateurs refusent une promesse comme valeur : TypeError a la
  // construction, on attend alors le blob avant d'ecrire.
  async function ppEcrireImage(promesse){
    var item;
    try { item = new ClipboardItem({ "image/png": promesse }); }
    catch (e){
      if (!(e && e.name === "TypeError")) throw e;
      item = new ClipboardItem({ "image/png": await promesse });
    }
    await navigator.clipboard.write([item]);
  }

  async function ppEcrireTexte(valeur){
    if (valeur.html){
      // Le vrai texte brut, s'il a ete annonce : on ne fabrique le sien en
      // retirant les balises qu'a defaut.
      var plain = valeur.texte != null ? valeur.texte : valeur.html.replace(/<[^>]*>/g, "");
      await navigator.clipboard.write([ new ClipboardItem({
        "text/html":  new Blob([valeur.html], {type:"text/html"}),
        "text/plain": new Blob([plain], {type:"text/plain"}) }) ]);
    } else {
      await navigator.clipboard.writeText(valeur.texte || "");
    }
  }

  // opts.auto : depot spontane, a l'arrivee du contenu. Il reussit en silence
  // — un presse-papier qui marche ne s'annonce pas — et un refus du navigateur
  // n'est pas une erreur a montrer : le bouton prend le relais. Rend vrai s'il
  // n'y a plus rien a tenter (contenu depose, ou inutilisable).
  async function ppDeposer(kind, opts){
    var auto = !!(opts && opts.auto);
    var slot = ppSlots.get(kind);
    if (!slot) return false;
    slot.clique = true;
    // Pendant l'attente, un contenu plus recent a pu prendre l'emplacement : ce
    // qu'on vient d'ecrire est l'ANCIEN, le nouveau et son bouton doivent rester.
    var encoreLe_mien = function(){ return ppSlots.get(kind) === slot; };
    try{
      if (kind === "image") await ppEcrireImage(slot.promesse);
      else {
        var valeur = await slot.promesse;
        await ppEcrireTexte(valeur);
        // Ce texte vient du poste distant : la synchronisation sortante ne
        // doit pas le lui renvoyer au prochain retour sur la page.
        clipSync.dernier = RDLib.clip.signature(valeur.texte || "") + "|" + RDLib.clip.signature(valeur.html || "");
      }
      console.log("[presse-papier] " + kind + " déposé dans le presse-papier local" + (auto ? " (automatique)" : ""));
      if (encoreLe_mien()){ ppSlots.take(kind); ppRetirerBouton(kind); }
      if (kind === "image") ppNoterImageLocale();
      if (!auto) notifier(kind === "image" ? T("Image déposée dans le presse-papier local.")
                                           : T("Texte déposé dans le presse-papier local."));
      return true;
    }catch(e0){
      // Si la CONVERSION a echoue, c'est elle la vraie cause : write() rejoue son
      // rejet sous un autre nom (NotAllowedError, DataError…) et le message
      // « le navigateur a refuse » serait faux — et definitif, donc trompeur.
      var e = slot.erreur || e0;
      var defaut = !!(e && e.name === "ClipError");
      console.warn("[presse-papier] depot refuse : " + (e && e.name) + " — " + (e && e.message));
      // Une erreur de conversion est definitive : reessayer ne changerait rien.
      // Un refus du navigateur, lui, peut passer au geste suivant.
      if (defaut && encoreLe_mien()){ ppSlots.take(kind); ppRetirerBouton(kind); }
      if (!auto || defaut) notifier(messageErreur(e), "erreur");
      return defaut;
    }finally{
      if (!auto){ var c = active(); if (c) c.focus(); }  // le bouton ne doit pas garder le clavier
    }
  }
  // Apres le depot d'une image distante : le navigateur la reencode, sa taille
  // locale n'est donc pas celle recue. On la relit pour que la synchronisation
  // sortante la reconnaisse et ne la renvoie pas d'ou elle vient.
  function ppNoterImageLocale(){
    if (!clipSync.actif) return;
    try{
      window.navigator.clipboard.read().then(function(items){
        for (var i = 0; i < items.length; i++){
          if (items[i].types.indexOf("image/png") >= 0){
            items[i].getType("image/png").then(function(b){ clipSync.dernier = "img:" + b.size; });
            return;
          }
        }
      }).catch(function(){});
    }catch(_){}
  }
  window.__rdPpFiltrer = ppFiltrer;

  // ------------------------------------------------ ce que le pair repond
  // Deux reponses que le bundle recoit sans les traiter :
  //  - BackNotification : le pair accepte ou refuse « bloquer la saisie » et le
  //    mode confidentialite. Sans elle, le menu affichait une option prise que
  //    le pair avait refusee.
  //  - « 2FA Required » : le bundle l'affichait comme une erreur de connexion
  //    sans issue. On demande le code et on l'envoie (Auth2FA, champ 27 du
  //    Message) ; le pair repond alors par un login_response ordinaire.
  // Appelee sur le chemin de msgLoop : rend le message, ou un message VIDE pour
  // que le bundle n'affiche pas l'erreur a laquelle on vient de repondre.
  var saisieBloquee = false;
  function pairFiltrer(c, m){
    if (!m) return m;
    var bn = m.misc && m.misc.back_notification;
    if (bn){
      var r = RDLib.pair.retour(bn);
      if (r.option){
        if (r.option === "block-input") saisieBloquee = r.actif;
        else { try{ c.setOption(r.option, r.actif); }catch(_){} }
        notifier(T(r.texte) + (r.details ? " (" + r.details + ")" : ""), r.ok ? null : "erreur");
        if (window.__rdActions) window.__rdActions();
      }
      return m;
    }
    // La latence mesuree par le pair : lue ICI, dans le message, et non plus
    // dans ce que le bundle en ecrit sur la console.
    var td = m.test_delay;
    if (td && typeof td.last_delay === "number"){
      var S = RD.stats;
      S.delay.push(td.last_delay);
      if (S.delay.length > 300) S.delay.shift();
      if (typeof td.target_bitrate === "number") S.bitrate = td.target_bitrate;
      return m;
    }
    var lr = m.login_response, cas = lr && RDLib.pair.demande2fa(lr.error);
    if (!cas) return m;
    return demander2fa(c, m, cas);              // une promesse : next() l'attend
  }
  // Une question posee dans la modale de la page. Rend une promesse : la
  // saisie (ou true sans champ), null si l'utilisateur annule.
  function demander(o){
    return new Promise(function(res){
      if (!window.__rdModale){ res(null); return; }
      var q = { titre: o.titre, corps: o.corps, okTexte: o.okTexte, danger: o.danger,
                onOk: function(v){ res(o.champ !== undefined ? String(v == null ? "" : v) : true); },
                onAnnule: function(){ res(null); } };
      if (o.champ !== undefined) q.champ = o.champ;
      window.__rdModale(q);
    });
  }
  async function demander2fa(c, m, cas){
    for (;;){
      var saisi = await demander({
        titre: cas === "faux" ? T("Code refusé") : T("Vérification en deux étapes"),
        corps: T("Code à 6 chiffres de l'application d'authentification du poste distant."),
        champ: "", okTexte: T("Valider") });
      if (saisi === null) return m;               // annule : l'erreur du bundle s'affiche
      var code = RDLib.pair.code2fa(saisi);
      if (code){
        // PAS rdSend : RD.ready est faux tant que peer_info n'est pas arrive. Le
        // canal est pourtant etabli — ce login_response vient d'y passer.
        c._ws.sendMessage({ auth_2fa: { code: code } });
        console.log("[2fa] code envoye");
        return {};
      }
      cas = "faux";
    }
  }
  window.__rdPairFiltrer = pairFiltrer;

  // ------------------------------------------- substitution sur curConn
  function patchConn(c){
    if (!c || !c._ws) return;
    if (c.__rdPatchedWs === c._ws) return;    // reconnect() reutilise l'instance
    c.__rdPatchedWs = c._ws;

    if (!c.__rdOrigHandle) c.__rdOrigHandle = c.handleVideoFrame;
    if (!c.__rdOrigDraw)   c.__rdOrigDraw   = c.draw;

    c.handleVideoFrame = function(vf){
      // Ce msgbox est ce qui rend div#canvas visible (ui.js, branche !type).
      // L'omettre laisse la page bloquee sur "Connecting" — ecran noir.
      if (!this._firstFrame){ this.msgbox("", "", ""); this._firstFrame = true; }

      // Le pair decide seul du codec : celui qu'on prefere n'est qu'un voeu.
      // Sans encodeur materiel chez lui, « prefer H265 » revient en VP9 — et
      // ce VP9 partait au decodeur logiciel, qui dessine sur un canvas alors
      // masque : ecran noir. On suit donc le flux reellement recu.
      var flux = RD.codec ? RDLib.codec.flux(vf) : null;
      if (flux && flux.nom !== RD.codec){
        if (RD.caps[flux.nom] && !RD.rates[flux.nom]){ RD.horsPortee = 0; changerCodec(flux.nom); }
        else {
          // WebCodecs ne le decode pas ici : seul VP9 peut arriver dans ce cas
          // (c'est le seul codec annonce sans etre sonde), et ogv sait le lire.
          // Les premieres trames d'une session sont TOUJOURS du VP9 — le pair
          // n'a pas encore lu notre declaration — donc on patiente avant de
          // conclure : une trentaine de trames, puis on renonce a WebCodecs
          // pour cette session ET on le dit au pair, qui n'emettra plus que
          // du VP9. Sans cela le decodeur logiciel dessinait sur un canvas masque.
          RD.horsPortee = (RD.horsPortee | 0) + 1;
          if (RD.horsPortee > 30){
            console.warn("[codec] le pair reste en " + flux.nom + ", que WebCodecs ne decode pas ici : decodage logiciel pour cette session");
            RD.horsPortee = 0; RD.codec = null; RD.errors = 0;
            negotiate(); showActive(); fitCanvas();
          }
          flux = null;
        }
      } else if (flux) RD.horsPortee = 0;
      var evfs = flux ? flux.lot : null;

      if (!RD.codec || !evfs){
        return this.__rdOrigHandle.call(this, vf);   // chemin ogv d'origine
      }

      var dec;
      try { dec = ensureDecoder(); }
      catch(e){ console.warn("[webcodecs] init", e); this.sendVideoReceived();
                fallbackToSoftware("configuration impossible"); return; }

      // Purge anti-retard : si la file du decodeur s'accumule, tout ce qui y
      // reste est deja perime — mieux vaut la vider et repartir d'une image-cle.
      //
      // Chaque purge coute une image-cle complete reemise par le poste distant.
      // Sans garde-fou, un simple hoquet en declenche une, dont le surcout de
      // debit en provoque une autre : la boucle s'entretient. D'ou un seuil plus
      // haut qu'une simple trame de retard, et un intervalle minimal entre deux
      // purges.
      var qMax = 6, purgeMinMs = 3000;
      if (dec && dec.decodeQueueSize > qMax
              && Date.now() - (RD.lastPurge || 0) > purgeMinMs) {
        RD.lastPurge = Date.now();
        console.warn("[webcodecs] file de decodage encombree ("
                   + dec.decodeQueueSize + " trames), purge et image-cle");
        try {
          dec.reset();
          dec.configure(configDecodeur());
          RD.wantKey = true;
          // reset() abandonne les trames en vol : leurs horodatages resteraient
          // dans la file de mesure et fausseraient durablement les percentiles.
          RD.stats.pend.length = 0;
          this.refresh();
        } catch(_){}
      }

      var frames = evfs.frames || [];
      for (var i=0; i<frames.length; i++){
        var f = frames[i];
        if (RD.wantKey){
          if (!f.key) continue;                       // garde image-cle
          RD.wantKey = false;
          if (!RD.sawAnnexB){
            RD.sawAnnexB = true;
            console.log("[flux] premiers octets de la cle : " +
              Array.from(f.data.slice(0,5)).map(function(b){
                return b.toString(16).padStart(2,"0"); }).join(" "));
          }
        }
        try{
          RD.stats.pend.push(performance.now());
          if (RD.stats.pend.length > 60) RD.stats.pend.shift();
          dec.decode(new EncodedVideoChunk({
            type: f.key ? "key" : "delta",
            timestamp: Number(f.pts||0) * 1000,
            data: f.data }));
        }catch(e){
          RD.stats.pend.pop();
          console.warn("[webcodecs] decode", e.name);
          RD.wantKey = true;
          if (++RD.errors >= 3) fallbackToSoftware("decode a echoue 3 fois");
          break;
        }
      }
      // ACK inconditionnel, une fois par VideoFrame recu, y compris pour les
      // lots jetes : video_ack_required=true, un ACK manquant fige le flux.
      this.sendVideoReceived();
    };

    // Supprime le SECOND globals.draw (un drawFrame + un readPixels+flip de
    // 8,3 Mo en moins par trame). Le rendu visible reste dans _draw, dont la
    // closure appartient au bundle. Sans effet aux niveaux 1 et 2, ou draw()
    // n'est plus appele du tout.
    c.draw = function(f){ if (this._draw) this._draw(f); };

    // msgLoop() fait « const a = await this._ws.next() » puis aiguille :
    // envelopper next() est le seul point ou le message decode passe avant
    // l'aiguillage.
    if (c._ws && typeof c._ws.next === "function" && c._ws.__rdNext !== c._ws){
      c._ws.__rdNext = c._ws;
      var suivant = c._ws.next.bind(c._ws);
      c._ws.next = async function(){
        var m = await suivant();
        try { m = await pairFiltrer(c, m); }
        catch(e){ console.warn("[pair] entrant :", e); }
        try { return ppFiltrer(m); }
        catch(e){ console.warn("[presse-papier] entrant :", e); return m; }
      };
    }

    console.log("[patch] connexion instrumentee");
  }

  // ---------------------------------------------------- cablage par canvas
  function wireCanvas(c){
    if(!c || c.dataset.wired) return; c.dataset.wired="1";
    // Pas de curseur impose : c'est le curseur distant, recu par cursor_data,
    // qui doit s'afficher pour refleter l'etat de macOS.
    c.tabIndex=0; c.style.outline="none";
    c.oncontextmenu=function(e){ e.preventDefault(); };

    // Une souris a haute frequence produit plusieurs positions par trame ; le
    // navigateur les regroupe et getCoalescedEvents() les restitue toutes. Plus
    // fidele, mais chaque position devient un message sortant de plus vers le
    // relais. Le gain n'etant pas acquis sur une liaison distante, c'est un choix
    // explicite et mesurable, pas un defaut. Voir rdCoalesce() et rdDiag().
    c.addEventListener("mousemove", function(e){
      var evs = (RD.coalesce && typeof e.getCoalescedEvents === "function")
              ? e.getCoalescedEvents() : [e];
      if (!RD.stats.movesT0) RD.stats.movesT0 = Date.now();
      for (var i = 0; i < evs.length; i++){
        var p = pos(c, evs[i]);
        send("send_mouse", merge({type:"", buttons:"", x:p.x, y:p.y}, modsSouris(evs[i])));
        RD.stats.moves++;
      }
    });
    // Un bouton enfonce doit TOUJOURS etre relache cote distant. Le relachement
    // n'etait ecoute que sur le canvas : un glisser termine hors de l'image, ou
    // une fenetre qui perd le focus en plein glisser, laissait le bouton tenu.
    // La capture du pointeur ramene mousemove et mouseup au canvas ou que soit
    // la souris ; la perte de focus relache ce qui reste.
    var enfonces = {}, derniere = {x:0,y:0};
    function relacherTout(){
      for (var b in enfonces){
        send("send_mouse",{type:"up",buttons:b,x:derniere.x,y:derniere.y,
                           alt:"false",ctrl:"false",shift:"false",command:"false"});
      }
      enfonces = {};
    }
    window.addEventListener("blur", relacherTout);
    c.addEventListener("mousedown",function(e){ e.preventDefault(); c.focus(); var p=pos(c,e);
      enfonces[btn(e)] = 1; derniere = p;
      send("send_mouse",merge({type:"down",buttons:btn(e),x:p.x,y:p.y},modsSouris(e))); });
    c.addEventListener("mouseup",function(e){ e.preventDefault(); var p=pos(c,e);
      delete enfonces[btn(e)]; derniere = p;
      send("send_mouse",merge({type:"up",buttons:btn(e),x:p.x,y:p.y},modsSouris(e))); });
    var molette = RDLib.molette.creer(100);
    c.addEventListener("wheel",function(e){ e.preventDefault();
      var w = molette.pousser(e.deltaX, e.deltaY, e.deltaMode);
      if (w.x || w.y) send("send_mouse",merge({type:"wheel",buttons:"",x:w.x,y:w.y},mods(e)));
    },{passive:false});

    // --- Tactile. touch-action:none retire le defilement et le zoom de la page
    // sur l'image ; preventDefault sur touchstart retire les evenements souris
    // de compatibilite, qui doubleraient chaque geste.
    c.style.touchAction = "none";
    var tact = RDLib.tactile.creer(), tactMol = RDLib.molette.creer(30), longT = null;
    var SANS = {alt:"false",ctrl:"false",shift:"false",command:"false"};
    function jouer(acts){
      acts.forEach(function(a){
        if (a.a === "wheel"){
          var w = tactMol.pousser(a.dx, a.dy, 0);
          if (w.x || w.y) send("send_mouse",merge({type:"wheel",buttons:"",x:w.x,y:w.y},SANS));
          return;
        }
        var p = pos(c,{clientX:a.x,clientY:a.y}); derniere = p;
        if (a.a === "move") send("send_mouse",merge({type:"",buttons:"",x:p.x,y:p.y},SANS));
        else if (a.a === "down"){ enfonces.left = 1; send("send_mouse",merge({type:"down",buttons:"left",x:p.x,y:p.y},SANS)); }
        else if (a.a === "up"){ delete enfonces.left; send("send_mouse",merge({type:"up",buttons:"left",x:p.x,y:p.y},SANS)); }
        else if (a.a === "clic-droit"){
          send("send_mouse",merge({type:"down",buttons:"right",x:p.x,y:p.y},SANS));
          send("send_mouse",merge({type:"up",buttons:"right",x:p.x,y:p.y},SANS));
        }
      });
    }
    function finLong(){ if (longT){ clearTimeout(longT); longT = null; } }
    c.addEventListener("touchstart",function(e){ e.preventDefault(); c.focus(); },{passive:false});
    c.addEventListener("pointerdown",function(e){
      if (e.pointerType !== "touch"){
        try{ c.setPointerCapture(e.pointerId); }catch(_){}
        return;
      }
      try{ c.setPointerCapture(e.pointerId); }catch(_){}
      finLong();
      jouer(tact.down(e.pointerId, e.clientX, e.clientY));
      if (tact.etat() === "un") longT = setTimeout(function(){ longT = null; jouer(tact.long()); }, 600);
    });
    c.addEventListener("pointermove",function(e){
      if (e.pointerType !== "touch") return;
      jouer(tact.move(e.pointerId, e.clientX, e.clientY));
      if (tact.etat() !== "un") finLong();
    });
    c.addEventListener("pointerup",function(e){
      if (e.pointerType !== "touch") return;
      finLong(); jouer(tact.up(e.pointerId));
    });
    c.addEventListener("pointercancel",function(e){
      if (e.pointerType !== "touch") return;
      finLong(); tactMol.raz(); jouer(tact.cancel());
    });

    // Ce qui a ete envoye ENFONCE, par touche physique. On relache Ctrl avant C
    // plus souvent qu'on ne croit : le keyup de C arrive alors sans Ctrl, et
    // passait pour une lettre — donc rien ne partait, et le poste distant
    // gardait Cmd+C enfonce. Le relachement rejoue exactement ce qui est parti.
    var tenues = {};
    function key(e,down){
      var k=e.key;
      var repere = e.code || k;
      if(!down && tenues[repere]){
        var t0 = tenues[repere]; delete tenues[repere];
        e.preventDefault();
        send("input_key",merge({name:t0.nom,down:"false",press:"false"},versPont(t0)));
        return;
      }
      if(MODK[k]){ e.preventDefault(); return; }
      // Ctrl/Cmd+V, Maj+Inser : NE PAS intercepter, sinon le navigateur n'emet
      // pas "paste". Le collage distant est rejoue par le gestionnaire de paste.
      if(RDLib.clip.isPasteChord(e)) return;
      var name=CTRL[k];
      if(!name){
        if(k.length!==1) return;
        // Du texte : le navigateur a deja resolu la disposition locale (accents,
        // majuscules, AltGr). On envoie le caractere final tel quel.
        var ag = !!(e.getModifierState && e.getModifierState("AltGraph"));
        if (RDLib.clavier.estTexte({key:k,ctrl:e.ctrlKey,alt:e.altKey,meta:e.metaKey,altGraph:ag}, LOCAL_MAC)){
          e.preventDefault();
          if(down){ try{ window.setByName("input_string",k); }catch(x){ console.warn("[entree]",x); } }
          return;
        }
        name=(k>="A"&&k<="Z")?k.toLowerCase():k;
      }
      // Une touche de commande, ou un raccourci : traduit pour l'autre plateforme.
      e.preventDefault();
      var s0=etat(e); s0.nom=name;
      var r=RDLib.clavier.traduire(modeClavier(), s0);
      if(down) tenues[repere]=r;
      send("input_key",merge({name:r.nom,down:String(down),press:"false"},versPont(r)));
    }
    function relacherTouches(){
      for (var k in tenues) send("input_key",merge({name:tenues[k].nom,down:"false",press:"false"},versPont(tenues[k])));
      tenues = {};
    }
    window.addEventListener("blur", relacherTouches);
    c.addEventListener("keydown",function(e){ key(e,true); });
    c.addEventListener("keyup",function(e){ key(e,false); });
    c.focus();
  }



  // ------------------------------------------------------ reprise auto
  // Une coupure reseau, un relais recree ou un onglet endormi terminent la
  // session. Plutot que de retomber sur le formulaire, on retente, avec un
  // delai croissant pour ne pas marteler un serveur qui redemarre.
  var reprise = { n:0, timer:null, voulue:false };

  function repriseAnnuler(){
    if (reprise.timer){ clearTimeout(reprise.timer); reprise.timer = null; }
    reprise.n = 0;
  }

  function repriseInfo(txt){
    var h = window.__rdHud;
    if (!h) return;
    // L'attribut porte la revelation (voir le CSS), le span porte l'annonce :
    // la telemetrie est muette pour les lecteurs d'ecran — annoncer trois
    // percentiles chaque seconde serait du bavardage — mais une reconnexion
    // en cours est un vrai changement d'etat, et role="status" l'annonce.
    h.dataset.reprise = txt || "";
    if (h.__statut) h.__statut.textContent = txt ? "\n" + txt : "";
  }

  function repriseplanifier(){
    if (reprise.voulue){ console.log("[reprise] deconnexion demandee, pas de reprise"); return; }
    if (reprise.timer) return;
    // La fermeture d'UNE liaison relais n'est pas la fin de la session : la
    // connexion « fichiers » en ouvre une seconde, et sa fermeture appelle
    // __rdReprise alors que la session video est bien vivante.
    if (sessionVivante()) return;
    if (reprise.n >= 6){
      console.warn("[reprise] abandon apres 6 tentatives");
      repriseInfo(T("reprise abandonnée — recharge la page"));
      return;
    }
    var delai = Math.min(30000, 1000 * Math.pow(2, reprise.n));
    reprise.n++;
    console.log("[reprise] tentative " + reprise.n + "/6 dans " + (delai/1000) + " s");
    repriseInfo(T("reconnexion {0}/6 dans {1} s", reprise.n, delai/1000));
    reprise.timer = setTimeout(function(){
      reprise.timer = null;
      // Elle a pu revenir entre-temps : ne pas relancer connect() par-dessus.
      if (sessionVivante()){ repriseAnnuler(); repriseInfo(""); return; }
      repriseInfo(T("reconnexion en cours…"));
      try { if (window.connect) window.connect(); }
      catch(e){ console.warn("[reprise]", e); }
    }, delai);
  }

  // Le gestionnaire de fermeture des WebSockets vit dans un autre bloc
  // <script> et n'a donc pas cette fonction dans sa portee.
  window.__rdReprise = repriseplanifier;

  // --------------------------------------------------- verrou de veille
  // Empeche l'ecran de se verrouiller pendant une session, comme le font
  // YouTube en lecture et le client RustDesk natif. Le navigateur libere
  // le verrou des que l'onglet passe en arriere-plan : il faut le reprendre
  // au retour, sinon l'ecran s'eteint apres un aller-retour vers un autre onglet.
  var veille = null, veillePrevenu = false;

  async function veilleActiver(){
    if (veille) return;
    // L'API refuse par conception tant que la page n'est pas visible. Le
    // veilleur appelant cette fonction toutes les 800 ms tant que la session
    // dure, sans cette garde chaque passage en arriere-plan produisait un rejet
    // par battement : le journal en etait noye au moment precis ou il fallait
    // le lire. Le verrou est repris par le gestionnaire de visibilite.
    if (document.visibilityState !== "visible") return;
    if (!("wakeLock" in navigator)){
      if (!veillePrevenu){
        veillePrevenu = true;
        console.warn("[veille] API Screen Wake Lock indisponible dans ce navigateur — "
                   + "l'ecran pourra se verrouiller pendant la session");
      }
      return;
    }
    try{
      veille = await navigator.wakeLock.request("screen");
      veille.addEventListener("release", function(){ veille = null; });
      console.log("[veille] verrou acquis — l'ecran ne se verrouillera pas");
    }catch(e){
      // Refus typique : document non visible, ou politique d'economie d'energie.
      console.warn("[veille] refus :", e.name, e.message);
      veille = null;
    }
  }

  async function veilleLiberer(){
    if (!veille) return;
    var v = veille; veille = null;
    try{ await v.release(); console.log("[veille] verrou libere"); }catch(_){}
  }

  document.addEventListener("visibilitychange", function(){
    if (document.visibilityState !== "visible"){ veille = null; return; }
    var c = active();
    if (c && c.width > 300) veilleActiver();
  });

  // Le canvas GARDE sa largeur apres une coupure : c.width reste a 1920 et la fin
  // de session passait inapercue. On interroge donc l'etat reel : le conteneur
  // d'affichage est-il visible, et la liaison est-elle ouverte.
  function sessionVivante(){
    var d = document.getElementById("canvas");
    if (!d || getComputedStyle(d).display === "none") return false;
    var k = window.curConn;
    if (!k || !k._ws || !k._ws._websocket) return false;
    return k._ws._websocket.readyState === 1;
  }

  // ------------------------------------------------------ reglages memorises
  // Qualite, plafond de cadence et codec survivent au rechargement de la page,
  // et se reappliquent a chaque session : le ratio de qualite n'etait envoye
  // qu'UNE fois par page (le sondage « tuned »), donc jamais apres une reprise.
  var prefs = (function(){
    try { return RDLib.prefs.create(window.localStorage); }
    catch(e){ return RDLib.prefs.create({ getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} }); }
  })();
  var ui = {};                       // les <select> de la barre, poses par wireGlobal

  // ----------------------------------------------- dernieres connexions
  // Dix ID au plus, les plus recents d'abord, sous le champ « Id » de l'ecran de
  // connexion. On enregistre a peer_info (une session REUSSIE — pas un clic sur
  // Connect, qui garderait les fautes de frappe), et l'on ne stocke que des
  // chiffres et des horodatages : « peers » porte les mots de passe memorises,
  // on n'y touche pas.
  var recents = (function(){
    try { return RDLib.recent.create(window.localStorage); }
    catch(e){ return RDLib.recent.create({ getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} }); }
  })();

  function viderNoeud(n){ while (n.firstChild) n.removeChild(n.firstChild); }

  // Tout passe par textContent : un ID vient du stockage, jamais du balisage.
  function rendreRecents(){
    var zone = document.getElementById("rd-recents");
    if (!zone) return;
    viderNoeud(zone);
    var liste = recents.list();
    liste.forEach(function(e){
      var pastille = document.createElement("span");
      pastille.className = "rdchip";
      var b = document.createElement("button");
      b.type = "button"; b.className = "rdchip-id";
      b.textContent = (e.n ? e.n + " · " : "") + RDLib.fmtId(e.id);
      b.title = T("Utiliser cet ID (Suppr ou Retour arrière pour le retirer de la liste)");
      b.onclick = function(){ choisirRecent(e.id); };
      b.addEventListener("keydown", function(ev){
        // Suppr, ou Retour arriere : un portable Mac n'a pas de touche Suppr.
        if (ev.key === "Delete" || ev.key === "Backspace"){ ev.preventDefault(); retirerRecent(e.id); }
      });
      // La croix est reservee a la souris : vingt arrets de tabulation pour dix
      // ID seraient pire que l'absence de liste. Au clavier : Suppr sur l'ID.
      var x = document.createElement("button");
      x.type = "button"; x.className = "rdchip-x"; x.textContent = "×";
      x.setAttribute("tabindex", "-1"); x.setAttribute("aria-hidden", "true");
      x.title = T("Retirer de la liste");
      x.onclick = function(){ retirerRecent(e.id); };
      pastille.appendChild(b); pastille.appendChild(x);
      zone.appendChild(pastille);
    });
    if (liste.length){
      var eff = document.createElement("button");
      eff.type = "button"; eff.className = "rdchip-clear"; eff.textContent = T("Effacer");
      eff.title = T("Effacer toute la liste");
      eff.onclick = function(){ recents.clear(); rendreRecents(); };
      zone.appendChild(eff);
    }
  }
  // Le bundle n'enleve pas les espaces d'un ID : « 123 456 789 » ne serait pas
  // « 123456789 » pour le serveur. On remplit donc avec les chiffres seuls.
  function choisirRecent(id){
    var champ = document.getElementById("id");
    if (champ) champ.value = id;
    var go = document.querySelector('#connect button[onclick^="connect"]');
    if (go && go.focus) go.focus();
  }
  function retirerRecent(id){ recents.remove(id); rendreRecents(); }
  // La ligne des pastilles, sous celle du champ « Id » (le formulaire est un
  // tableau : Host / Key / Id / Connect). Une seule fois.
  function poserRecents(champId){
    if (document.getElementById("rd-recents")) return;
    var ligneId = champId.parentNode && champId.parentNode.parentNode;
    if (!ligneId || !ligneId.parentNode) return;
    var tr = document.createElement("tr"), vide = document.createElement("td"),
        cel = document.createElement("td"), zone = document.createElement("div");
    zone.id = "rd-recents";
    zone.setAttribute("role", "group");
    zone.setAttribute("aria-label", T("Dernières connexions"));
    cel.appendChild(zone); tr.appendChild(vide); tr.appendChild(cel);
    ligneId.parentNode.insertBefore(tr, ligneId.nextSibling);
    // Amorcage unique : les ID que le bundle connait deja (« peers », classes par
    // « tm » — la derniere ecriture d'option, PAS la derniere connexion, donc
    // approximatif) et le dernier ID saisi, hors ID par defaut du deploiement.
    try { recents.seedFrom(window.localStorage.getItem("peers"), window.localStorage.getItem("id"), DEFAUT_ID); }
    catch(e){ console.warn("[historique] amorcage :", e); }
    rendreRecents();
  }

  function majSelects(p){
    if (ui.qual) ui.qual.value = p.quality || "balanced";
    if (ui.fps && p.fps) ui.fps.value = String(p.fps);
    if (ui.cod) ui.cod.value = p.codec || "auto";
  }

  // Appelee de facon SYNCHRONE par le peer_info de chaque session (onGlobalEvent,
  // avant __rdNegotiate). Rien n'est envoye avant : rdSend refuse tant que
  // RD.ready est faux, et les compteurs secretbox seraient desynchronises.
  function sessionPrete(){
    var p = prefs.get();
    saisieBloquee = false;             // le blocage de saisie ne survit pas a la session
    if (window.__rdClavier) window.__rdClavier();
    if (window.__rdClipSync) window.__rdClipSync("debut de session");
    // Le codec d'abord : __rdNegotiate lit RD.forced juste apres.
    if (p.codec) RD.forced = p.codec;
    // La contrainte n'est pas la bande passante (le relais plafonne 30x au-dessus
    // du besoin) : qualite rehaussee a chaque session, pas une fois par page.
    // C'est la valeur PAR DEFAUT ; elle part EN PREMIER, car le pair applique les
    // options dans l'ordre d'arrivee : un preset choisi par l'utilisateur doit
    // venir apres et l'emporter (« Fluidite » ne peut pas tourner au ratio 1,5).
    if (rdSend({misc:{option:{custom_image_quality:150}}})) console.log("[qualite] ratio 1.5 applique");
    // Qualite. Preference absente : on ne pousse RIEN — le bundle renvoie deja
    // la qualite qu'il a memorisee pour ce pair, et l'on aligne simplement le
    // selecteur dessus (il affichait « Equilibre » quel que soit l'etat reel).
    try{
      if (p.quality){
        window.setByName("image_quality", p.quality);
      } else {
        var q = window.curConn && window.curConn.getOption && window.curConn.getOption("image-quality");
        if (ui.qual) ui.qual.value = (RDLib.prefs.OK.quality.indexOf(q) >= 0) ? q : "balanced";
      }
    }catch(e){ console.warn("[reglages] qualite :", e); }
    if (p.fps && rdSend({misc:{option:{custom_fps:p.fps}}}))
      console.log("[cadence] plafond a " + p.fps + " i/s (reglage memorise)");
    if (p.quality || p.fps || p.codec) majSelects(p);
    // Une session reussie : cet ID rejoint la liste de l'ecran de connexion.
    try{
      var idSession = window.curConn && window.curConn._id;
      // L'onglet porte le nom du poste : avec plusieurs sessions ouvertes, on
      // ne les distinguait pas. Le meme nom accompagne l'ID dans l'historique.
      var nomPoste = RDLib.nomPoste(window.curConn && window.curConn._peerInfo && window.curConn._peerInfo.hostname);
      if (idSession){ recents.add(idSession, nomPoste); rendreRecents(); }
      document.title = (nomPoste || RDLib.fmtId(String(idSession || "")) || T("Session")) + " — RustDesk";
    }catch(e){ console.warn("[historique]", e); }
    // La barre est repliee par defaut : on dit UNE fois ou elle est passee.
    if (!p.hint && ui.barre && ui.barre.classList.contains("replie")){
      notifier(T("Réglages de la session (résolution, qualité, fichiers…) : clique sur ⚙ en haut à droite."));
      prefs.set({ hint: true });
    }
    // Une session reussie efface la banniere d'echec d'une tentative precedente.
    try{ var b = document.getElementById("rderror"); if (b) b.remove(); }catch(_){}
  }
  window.__rdSessionReady = sessionPrete;

  // ------------------------------------------------- cablage global, 1 fois
  var globalWired = false;
  function wireGlobal(){
    if (globalWired) return; globalWired = true;
    zoneRetours();

    // --- Presse-papier sortant : navigateur -> Mac ---
    // Valeurs relevees dans l'enumeration ClipboardFormat du bundle, non
    // devinees : Text=0, Rtf=1, Html=2, ImageRgba=21, ImagePng=22,
    // ImageSvg=23, Special=31. Le porteur est « multi_clipboards », champ 28
    // du Message (tag 226 dans le bundle ; le champ 27 est auth_2fa), que le
    // pair ne comprend qu'a partir de RustDesk 1.3.0 — d'ou le rappel de sa
    // version dans le journal quand une image part.
    var FMT_TEXTE = 0, FMT_HTML = 2, FMT_PNG = 22;

    function versionPair(){
      try{
        var c = window.curConn;
        return (c && c._peerInfo && c._peerInfo.version) || "";
      }catch(_){ return ""; }
    }

    // multi_clipboards n'existe qu'a partir de RustDesk 1.3.0. L'envoyer a un
    // pair plus ancien ne provoque pas d'erreur : le champ est simplement
    // ignore, et le collage ne se fait pas du tout. Le texte fonctionnant
    // aujourd'hui, on ne bascule le format riche que si le pair sait le lire,
    // et l'on retombe sinon sur le message simple. Version inconnue : faux ici.
    function pairSupporteMulti(){
      return RDLib.clip.peerSupportsMulti(versionPair()) === true;
    }

    // Rejoue la frappe de collage sur le bon modificateur : Cmd+V si la
    // permutation est active, Ctrl+V sinon (terminal distant). Le delai croit
    // avec la taille envoyee : une image doit etre recue et posee par le poste
    // distant avant qu'on lui dise de coller.
    function rejouerCollage(octets, delai){
      var ms = RDLib.clip.pasteDelayMs(octets, delai);
      if (ms > 150) console.log("[presse-papier] collage distant dans " + ms + " ms (" + octets + " octets)");
      setTimeout(function(){
        var av=RDLib.clavier.collerAvec(clavierTraduit, LOCAL_MAC, plateformeDistante());
        var m={alt:"false",shift:"false",ctrl:String(av.ctrl),command:String(av.meta)};
        send("input_key",merge({name:"v",down:"true",press:"false"},m));
        send("input_key",merge({name:"v",down:"false",press:"false"},m));
      }, ms);
    }

    // Une image dessinee a la taille voulue, en PNG : le pair attend du PNG pour
    // le format 22, et un navigateur peut fournir du jpeg ou du webp — annoncer
    // PNG des octets jpeg produirait des donnees que le pair ne saurait pas lire.
    function encoderPng(bmp, w, h){
      var cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      var cx = cv.getContext("2d");
      cx.imageSmoothingQuality = "high";
      cx.drawImage(bmp, 0, 0, w, h);
      return new Promise(function(r){ cv.toBlob(r, "image/png"); }).then(function(b){
        if (!b) throw RDLib.clip.ClipError(RDLib.clip.ERR.ENCODE, "toBlob a rendu null (" + w + "x" + h + ")");
        return b;
      });
    }

    // Une image du presse-papier local vers celui du poste distant. Chaque
    // echec se dit : « rien ne se passe » etait la seule reponse, alors que la
    // cause etait une limite de taille, un format que le navigateur ne decode
    // pas ou un pair trop ancien.
    //
    // La limite porte sur ce qui PART — le PNG — et non sur la source : un jpeg
    // de quelques Mio gonfle de plusieurs fois en PNG. Trop gros, on reduit les
    // dimensions (trois fois au plus, en remesurant) plutot que de refuser.
    async function envoyerImagePressePapier(blob, o){
      var C = RDLib.clip, bmp = null, discret = !!(o && o.discret);
      try{
        var v = versionPair();
        if (C.peerSupportsMulti(v) === false)
          throw C.ClipError(C.ERR.VERSION, "pair en version " + v);
        C.precheck(blob.size);
        try { bmp = await createImageBitmap(blob); }
        catch(e){ throw C.ClipError(C.ERR.BITMAP, (blob.type || "type inconnu") + " — " + ((e && e.message) || e)); }

        var cur = { w: bmp.width, h: bmp.height }, png = blob.type === "image/png" ? blob : null, ok = false;
        // Un PNG plat de 6000 x 6000 pese moins de 1 Mo mais fait decoder 144 Mo de
        // pixels au poste distant : les DIMENSIONS sont plafonnees aussi.
        var borne = C.reduirePixels(cur.w, cur.h);
        if (borne.w !== cur.w || borne.h !== cur.h){ cur = borne; png = null; }
        for (var essai = 0; essai < 4; essai++){
          if (!png) png = await encoderPng(bmp, cur.w, cur.h);
          if (png.size <= C.LIM.OUT_PNG){ ok = true; break; }
          var n = C.nextScale(cur.w, cur.h, png.size, C.LIM.OUT_PNG);
          if (!n) break;
          cur = n; png = null;
        }
        if (!ok) throw C.ClipError(C.ERR.LIMIT, cur.w + "x" + cur.h);

        var octets = new Uint8Array(await png.arrayBuffer());
        if (!rdSend({ multi_clipboards: { clipboards: [{
              format: FMT_PNG, content: octets,
              width: cur.w, height: cur.h, compress: false }] } }))
          throw C.ClipError(C.ERR.NOSEND, "rdSend a refuse");
        console.log("[presse-papier] image " + cur.w + "x" + cur.h + ", "
                  + octets.length + " octets envoyes en PNG — pair en version "
                  + (v || "inconnue") + " (1.3.0 minimum requis)");
        if (!discret && (cur.w !== bmp.width || cur.h !== bmp.height))
          notifier(T("Image réduite de {0}×{1} à {2}×{3} pour tenir dans la limite d'envoi.", bmp.width, bmp.height, cur.w, cur.h));
        if (!discret) rejouerCollage(octets.length);
      }catch(e){
        console.warn("[presse-papier] image :", e);
        if (!discret) notifier(messageErreur(e), "erreur");
      }finally{
        if (bmp && bmp.close) bmp.close();
      }
    }

    // Ou est le focus ? Le collage ne se traite que sur le canvas, ou sur le
    // corps de la page pendant une session (voir RDLib.clip.pasteAccepte).
    function pasteCible(){
      var a = document.activeElement;
      if (a && (a === player() || a === document.getElementById("rdcanvas"))) return "canvas";
      if (!a || a === document.body) return "body";
      var tag = String(a.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || a.isContentEditable) return "champ";
      if (a.closest && a.closest("#rdfiles, #rdmodal")) return "champ";
      return "autre";
    }

    document.addEventListener("paste", function(ev){
      if (!RDLib.clip.pasteAccepte({ cible: pasteCible(), enSession: sessionVivante() })) return;
      ev.preventDefault();
      var cd = ev.clipboardData || window.clipboardData;
      if (!cd) return;

      // Une image d'abord, et avant le televersement : une capture d'ecran
      // arrive dans cd.files comme n'importe quel fichier, elle partait donc
      // en transfert au lieu d'atteindre le presse-papier du poste distant.
      var items = cd.items || [], img = null;
      for (var i = 0; i < items.length; i++){
        if (items[i].kind === "file" && items[i].type.indexOf("image/") === 0){
          img = items[i].getAsFile();
          if (img) break;
        }
      }
      if (img){ envoyerImagePressePapier(img); return; }

      // Un fichier copie dans le Finder arrive ici sous forme de File : le
      // presse-papier n'en porte qu'une POIGNEE, les octets n'etant lus qu'a
      // l'appel de arrayBuffer(). C'est le sens navigateur -> Mac, le seul que
      // le web autorise ; l'inverse est impossible, aucune API ne permet
      // d'ecrire un fichier dans le presse-papier du systeme.
      if (cd.files && cd.files.length && window.RDFT){
        console.log("[presse-papier] "+cd.files.length+" fichier(s) — televersement");
        window.RDFT.accepterDepot(cd);
        return;
      }
      var t="", h="";
      try{ t=cd.getData("text/plain")||""; }catch(_){}
      try{ h=cd.getData("text/html")||"";  }catch(_){}
      envoyerTexte(t, h, { rejouer: true });
    });

    // Le texte du presse-papier local vers celui du poste distant.
    //   rejouer : rejoue la frappe de collage une fois le contenu parti (Ctrl+V)
    //   discret : synchronisation spontanee — aucun retour a l'ecran, et rien
    //             n'est rejoue ; un echec se lit dans la console
    // Rend vrai si le contenu est (ou etait deja) sur le poste distant.
    function envoyerTexte(t, h, o){
      var rejouer = !!(o && o.rejouer), discret = !!(o && o.discret);
      function dire(texte){ if (!discret) notifier(texte, "erreur"); }
      if(!t && !h){
        console.log("[presse-papier] ignore (contenu non textuel)");
        dire(T("Ce contenu du presse-papier n'est ni du texte ni une image : rien à coller."));
        return false; }
      if(t.length>1048576 || h.length>1048576){
        console.warn("[presse-papier] trop volumineux, ignore");
        dire(T("Texte trop volumineux pour le presse-papier distant (limite : 1 Mio)."));
        return false; }

      // Deja la-bas : la synchronisation l'a envoye au retour sur la page, ou
      // c'est le poste distant qui vient de nous le donner. Coller n'a plus a
      // attendre un envoi — c'est ce qui rend Ctrl+V immediat.
      var sig = RDLib.clip.signature(t) + "|" + RDLib.clip.signature(h);
      if (sig === clipSync.dernier && RD.ready){
        if (rejouer) rejouerCollage(0, 30);
        return true;
      }

      // Texte enrichi : Word et Excel deposent du HTML a cote du texte brut.
      // MultiClipboards est fait pour cela — les deux entrees partent dans le
      // meme message et l'application distante choisit ce qu'elle sait poser.
      if (h && pairSupporteMulti()){
        // Le delai de rejeu se calcule en OCTETS : « h.length » compte des unites
        // UTF-16, un texte accentue ou asiatique pese 2 a 4 fois plus.
        var hb = new TextEncoder().encode(h), tb = t ? new TextEncoder().encode(t) : null;
        var lot = [{ format: FMT_HTML, content: hb,
                     width: 0, height: 0, compress: false }];
        if (t) lot.push({ format: FMT_TEXTE, content: tb,
                          width: 0, height: 0, compress: false });
        if (rdSend({ multi_clipboards: { clipboards: lot } })){
          console.log("[presse-papier] texte enrichi envoye — "
                    + h.length + " car. de HTML"
                    + (t ? " et " + t.length + " car. de texte brut" : ""));
          clipSync.dernier = sig;
          if (rejouer) rejouerCollage(hb.length + (tb ? tb.length : 0));
          return true;
        }
      }

      if(!t){
        console.log("[presse-papier] ignore (HTML seul, pair trop ancien)");
        dire(T("Le poste distant est trop ancien pour du texte enrichi, et aucun texte brut n'accompagne ce contenu."));
        return false; }
      var bytes=new TextEncoder().encode(t);
      if(rdSend({clipboard:{content:bytes,compress:false}})){
        console.log("[presse-papier] "+bytes.length+" octets envoyes");
        clipSync.dernier = sig;
        if (rejouer) rejouerCollage(bytes.length);
        return true;
      }
      dire(T(RDLib.messages.NOSEND));
      return false;
    }

    // ------------------------------------------- synchronisation SORTANTE
    // Coller par Ctrl+V a toujours marche : l'evenement « paste » porte le
    // contenu. Mais « Coller » dans un menu du poste distant, ou un clic du
    // milieu, n'en produisent aucun — le presse-papier distant n'avait alors
    // pas ce qu'on venait de copier ici.
    //
    // Avec l'accord de l'utilisateur (menu Actions) et la permission du
    // navigateur, le presse-papier local est lu a chaque retour sur la page et
    // envoye s'il a change. C'est ce que fait le client natif. Chromium
    // seulement : Firefox et Safari redemandent a chaque lecture.
    clipSync.actif = prefs.get().clip === "auto";
    function syncPossible(){
      var n = window.navigator || {};
      return !!(n.clipboard && typeof n.clipboard.read === "function" && n.permissions && n.permissions.query);
    }
    async function syncSortant(raison){
      if (!clipSync.actif || !syncPossible() || !RD.ready || !sessionVivante() || !ppFocus()) return false;
      try{
        var items = await window.navigator.clipboard.read();
        var png = null, t = "", h = "";
        for (var i = 0; i < items.length; i++){
          var ty = items[i].types || [];
          if (ty.indexOf("image/png") >= 0) png = await items[i].getType("image/png");
          if (ty.indexOf("text/plain") >= 0) t = await (await items[i].getType("text/plain")).text();
          if (ty.indexOf("text/html") >= 0)  h = await (await items[i].getType("text/html")).text();
        }
        if (png && !t && !h){
          var sigI = "img:" + png.size;
          if (sigI === clipSync.dernier) return false;
          clipSync.dernier = sigI;
          console.log("[presse-papier] synchronisation (" + raison + ") : image de " + png.size + " octets");
          await envoyerImagePressePapier(png, { discret: true });
          return true;
        }
        if (!t && !h) return false;
        if (RDLib.clip.signature(t) + "|" + RDLib.clip.signature(h) === clipSync.dernier) return false;
        console.log("[presse-papier] synchronisation (" + raison + ")");
        return envoyerTexte(t, h, { discret: true });
      }catch(e){
        // NotAllowedError : la permission a ete retiree, ou la page a perdu le
        // focus pendant la lecture. Ni l'un ni l'autre ne merite un retour.
        console.log("[presse-papier] synchronisation impossible (" + raison + ") : " + ((e && e.name) || e));
        return false;
      }
    }
    window.__rdClipSync = syncSortant;
    // Activer : la lecture se fait DANS le geste, c'est elle qui fait apparaitre
    // la demande de permission du navigateur.
    async function basculerSync(){
      if (clipSync.actif){
        clipSync.actif = false; prefs.set({ clip: "manuel" });
        notifier(T("Presse-papier automatique désactivé : Ctrl+V continue de coller."));
        return;
      }
      try{
        await window.navigator.clipboard.read();
        clipSync.actif = true; prefs.set({ clip: "auto" });
        notifier(T("Presse-papier automatique : ce que tu copies sur cet appareil est envoyé au poste distant dès que tu reviens sur cette page."));
        syncSortant("activation");
      }catch(e){
        notifier(T("Le navigateur a refusé la lecture du presse-papier : la synchronisation automatique reste désactivée."), "erreur");
      }
    }
    try{
      window.addEventListener("focus", function(){ syncSortant("retour sur la page"); });
      document.addEventListener("visibilitychange", function(){
        if (document.visibilityState === "visible") syncSortant("onglet affiche");
      });
    }catch(_){}

    // --- Barre flottante ---
    var bar=document.createElement("div"); bar.id="rdbar";
    var sel=document.createElement("select"); sel.title=T("Résolution de l'écran distant");
    var fit=document.createElement("button"); fit.textContent=T("Ajuster");
    fit.title=T("Choisir la résolution la plus proche de la fenêtre");
    var qual=document.createElement("select"); qual.title=T("Qualité d'image");
    [["balanced",T("Équilibre")],["best",T("Qualité")],["low",T("Fluidité")]].forEach(function(o){
      var x=document.createElement("option"); x.value=o[0]; x.textContent=o[1]; qual.appendChild(x); });
    qual.onchange=function(){
      try{ window.setByName("image_quality",qual.value); console.log("[qualite] "+qual.value); }
      catch(e){ console.warn(e); }
      prefs.set({ quality: qual.value });
      var c=active(); if(c) c.focus();
    };
    // custom_fps est un PLAFOND, pas une cible : le serveur calcule la cadence
    // reelle depuis la latence mesuree (ABR), puis la rabote a cette valeur.
    // Monter le plafond au-dessus de ce que l'ABR accorde ne change donc rien ;
    // le baisser, si.
    var fps=document.createElement("select");
    fps.title=T("Plafond de cadence. Le serveur décide la cadence réelle selon la latence ; ce réglage ne fait que la borner. Le baisser a un effet immédiat, le monter n'en a que si la liaison suit.");
    [30,60,15,10]
      .forEach(function(n){ var x=document.createElement("option");
        x.value=n; x.textContent=T("{0} i/s max", n); fps.appendChild(x); });
    fps.onchange=function(){
      if(rdSend({misc:{option:{custom_fps:+fps.value}}}))
        console.log("[cadence] plafond a "+fps.value+" i/s (cadence reelle decidee par l'ABR)");
      prefs.set({ fps: +fps.value });
      var c=active(); if(c) c.focus();
    };
    var cod=document.createElement("select"); cod.title=T("Codec vidéo");
    [["auto",T("Codec auto")],["h265","H265"],["h264","H264"],["av1","AV1"],["vp9","VP9"],["logiciel",T("Logiciel")]]
      .forEach(function(o){ var x=document.createElement("option");
        x.value=o[0]; x.textContent=o[1]; cod.appendChild(x); });
    cod.onchange=function(){
      RD.forced = cod.value;
      prefs.set({ codec: cod.value });
      if (RD.forced === "auto"){ probeCodecs().then(function(c){ RD.codec=c; window.__rdNegotiate(); }); }
      else { window.__rdNegotiate(); }
      var c=active(); if(c) c.focus();
    };
    // Les reglages memorises : les selecteurs demarrent sur ce que l'utilisateur
    // a choisi la derniere fois, plus sur les valeurs par defaut.
    ui.qual = qual; ui.fps = fps; ui.cod = cod;
    (function(p){
      if (p.codec) RD.forced = p.codec;
      majSelects(p);
    })(prefs.get());

    // Traduction des raccourcis : indispensable hors terminal, nuisible dedans.
    // Le bouton n'apparait que s'il y a quelque chose a traduire — un PC devant
    // un PC, ou un Mac devant un Mac, n'en ont pas besoin.
    var swp=document.createElement("button"); swp.className="rdclavmode";
    function majSwap(){
      var paire = RDLib.clavier.mode(PLATEFORME_LOCALE, plateformeDistante());
      swp.style.display = paire === "direct" ? "none" : "";
      swp.textContent = !clavierTraduit ? T("Clavier brut") : paire === "mac-pc" ? "Mac→PC" : "PC→Mac";
      swp.title = !clavierTraduit
        ? T("Les touches sont transmises telles quelles (Ctrl+C = SIGINT dans un terminal). Cliquer pour traduire les raccourcis.")
        : paire === "mac-pc"
          ? T("Raccourcis Mac traduits pour le poste distant : Cmd+C devient Ctrl+C, Cmd+← Début, Option+← mot précédent, Cmd+Q ferme. Cliquer pour tout transmettre tel quel.")
          : T("Raccourcis PC traduits pour macOS : Ctrl+C devient Cmd+C, Ctrl+← mot précédent, Début/Fin bord de ligne, Alt+F4 quitte, Ctrl+clic sélection multiple. Cliquer pour tout transmettre tel quel (terminal).");
      swp.setAttribute("aria-pressed", clavierTraduit ? "true" : "false");
      swp.style.background = clavierTraduit ? "#1f4d3a" : "#2a2f38";
    }
    swp.onclick=function(){
      clavierTraduit = !clavierTraduit;
      localStorage.setItem("rd-swap-ctrl", clavierTraduit ? "1" : "0");
      majSwap();
      console.log("[clavier] "+(clavierTraduit?"raccourcis traduits ("+modeClavier()+")":"touches transmises telles quelles"));
      var c=active(); if(c) c.focus();
    };
    majSwap();
    window.__rdClavier = majSwap;        // la plateforme du pair n'est connue qu'a peer_info

    // Ecran affiche : n'apparait que si le poste distant en a plusieurs.
    var ecr=document.createElement("select"); ecr.className="rdecrans";
    ecr.title=T("Écran du poste distant à afficher");
    ecr.setAttribute("aria-label", ecr.title);
    ecr.style.display="none";
    window.__rdEcrans=function(){
      var d=RD.displays||[];
      while (ecr.firstChild) ecr.removeChild(ecr.firstChild);
      d.forEach(function(e,i){ var x=document.createElement("option");
        x.value=String(i);
        x.textContent=T("Écran {0}", i+1)+((e.width>0&&e.height>0)?" ("+e.width+"×"+e.height+")":"");
        ecr.appendChild(x); });
      ecr.value=String(RD.display|0);
      ecr.style.display = d.length>1 ? "" : "none";
    };
    ecr.onchange=function(){
      var i=parseInt(ecr.value,10);
      if(!(i>=0) || i===RD.display) return;
      // Le pair repond par un message switch_display : c'est lui qui met a
      // jour RD.display, la taille du canvas et le decodeur (onGlobalEvent).
      try{ window.setByName("switch_display", i); console.log("[ecran] bascule vers l'ecran "+(i+1)); }
      catch(e){ console.warn("[ecran]", e); }
      var c=active(); if(c) c.focus();
    };

    // Actions sur le poste distant. Le bundle les sait toutes (ctrlAltDel,
    // lockScreen, toggleOption) sans qu'aucune interface ne les appelle. Un
    // <select> : un seul controle dans une barre deja pleine, natif au clavier.
    // La premiere option sert de libelle ; choisir une action l'execute et
    // ramene le selecteur dessus.
    var act=document.createElement("select"); act.className="rdactions";
    act.title=T("Actions sur le poste distant");
    act.setAttribute("aria-label", act.title);
    var BASCULES=[["disable-audio","Couper le son distant"],
                  ["disable-clipboard","Suspendre le presse-papier"],
                  ["lock-after-session-end","Verrouiller en quittant"],
                  ["privacy-mode","Mode confidentialité"],
                  ["block-input","Bloquer la saisie locale"]];
    function optionActive(nom){
      if (nom === "block-input") return saisieBloquee;
      try{ return !!(window.curConn && window.curConn.getOption && window.curConn.getOption(nom)); }
      catch(_){ return false; }
    }
    window.__rdActions=function(){
      while (act.firstChild) act.removeChild(act.firstChild);
      function opt(v,t){ var x=document.createElement("option"); x.value=v; x.textContent=t; act.appendChild(x); }
      opt("",T("Actions"));
      opt("cad",T("Ctrl+Alt+Suppr"));
      opt("lock",T("Verrouiller la session"));
      BASCULES.forEach(function(b){ opt("opt:"+b[0], (optionActive(b[0]) ? "✓ " : "") + T(b[1])); });
      if (syncPossible()) opt("sync", (clipSync.actif ? "✓ " : "") + T("Presse-papier automatique"));
      opt("restart",T("Redémarrer le poste…"));
      act.value="";
    };
    act.onchange=function(){
      var v=act.value; act.value="";
      try{
        if (v === "cad"){ window.setByName("ctrl_alt_del"); console.log("[action] Ctrl+Alt+Suppr"); }
        else if (v === "lock"){ window.setByName("lock_screen"); console.log("[action] verrouillage"); }
        else if (v === "sync"){ basculerSync().then(function(){ window.__rdActions(); }); }
        else if (v === "restart"){
          demander({ titre: T("Redémarrer le poste distant ?"), corps: T("La session sera coupée."),
                     okTexte: T("Redémarrer"), danger: true }).then(function(ok){
            if (!ok) return;
            if (rdSend({misc:{restart_remote_device:true}})) notifier(T("Redémarrage demandé au poste distant."));
            else notifier(T(RDLib.messages.NOSEND), "erreur");
          });
        }
        else if (v.indexOf("opt:") === 0){
          var nom=v.slice(4);
          // Le bundle n'a pas de bascule pour la saisie : deux ordres distincts,
          // et l'etat reel ne vient que de la reponse du pair (pairFiltrer).
          if (nom === "block-input") window.setByName("toggle_option", saisieBloquee ? "unblock-input" : "block-input");
          else window.setByName("toggle_option", nom);
          console.log("[action] option "+nom);
        }
      }catch(e){ console.warn("[action]", e); notifier(T("Action impossible : {0}", (e&&e.message)||e), "erreur"); }
      window.__rdActions();
      var c=active(); if(c) c.focus();
    };
    window.__rdActions();

    // Clavier virtuel : un telephone n'en montre un que si un champ de saisie
    // a le focus, et un canvas n'en est pas un. Ce champ invisible le fait
    // sortir ; ce qui y est tape part au poste distant. Il garde toujours UN
    // caractere : sans cela, « effacer » sur un champ vide n'emet aucun evenement.
    var saisie=document.createElement("textarea"); saisie.id="rdsaisie";
    saisie.setAttribute("aria-label",T("Saisie pour le poste distant"));
    ["autocomplete","autocorrect","autocapitalize"].forEach(function(a){ saisie.setAttribute(a,"off"); });
    saisie.setAttribute("spellcheck","false");
    saisie.value=" ";
    saisie.addEventListener("input",function(ev){
      var type=String((ev && ev.inputType) || ""), texte=(ev && typeof ev.data === "string") ? ev.data : "";
      try{
        if (type.indexOf("delete") === 0) send("input_key",{name:"Backspace",down:"true",press:"true",alt:"false",ctrl:"false",shift:"false",command:"false"});
        else if (type === "insertLineBreak" || type === "insertParagraph") send("input_key",{name:"Return",down:"true",press:"true",alt:"false",ctrl:"false",shift:"false",command:"false"});
        else {
          if (!texte && saisie.value.length > 1) texte = saisie.value.slice(1);
          if (texte) window.setByName("input_string", texte);
        }
      }catch(e){ console.warn("[clavier]", e); }
      saisie.value=" ";
    });
    document.body.appendChild(saisie);
    var clav=document.createElement("button"); clav.className="rdclavier"; clav.textContent=T("Clavier");
    clav.title=T("Afficher le clavier de l'appareil");
    var tactile=false;
    try{ tactile = !!(window.matchMedia && window.matchMedia("(pointer:coarse)").matches); }catch(_){}
    clav.style.display = tactile ? "" : "none";
    clav.addEventListener("click",function(ev){
      // Apres le gestionnaire de la barre, qui rend le focus au canvas.
      ev.stopPropagation();
      try{ saisie.focus(); }catch(_){}
    });

    // Plein ecran. Avec l'API Keyboard Lock (Chromium), les raccourcis que le
    // navigateur ou le systeme gardent pour eux — Echap, Alt+Tab, Cmd+W, Ctrl+T —
    // partent au poste distant. Echap ne sort alors du plein ecran que maintenu.
    var plein=document.createElement("button"); plein.className="rdplein";
    function enPlein(){ return !!document.fullscreenElement; }
    function majPlein(){
      plein.textContent = enPlein() ? T("Fenêtre") : T("Plein écran");
      plein.title = enPlein() ? T("Quitter le plein écran") : T("Plein écran : les raccourcis clavier partent au poste distant");
      plein.setAttribute("aria-pressed", enPlein() ? "true" : "false");
    }
    plein.style.display = (document.documentElement && document.documentElement.requestFullscreen) ? "" : "none";
    plein.onclick=function(){
      try{
        var pr = enPlein() ? document.exitFullscreen() : document.documentElement.requestFullscreen({navigationUI:"hide"});
        if (pr && pr.catch) pr.catch(function(e){ notifier(T("Plein écran refusé par le navigateur ({0}).", (e && e.name) || "erreur"), "erreur"); });
      }catch(e){ console.warn("[plein ecran]", e); }
    };
    document.addEventListener("fullscreenchange",function(){
      majPlein();
      var kb = navigator.keyboard;
      try{
        if (enPlein()){
          if (kb && kb.lock) kb.lock().then(function(){
            console.log("[plein ecran] clavier capture");
            notifier(T("Plein écran : les raccourcis partent au poste distant. Maintenir Échap pour sortir."));
          }).catch(function(e){ console.warn("[plein ecran] clavier non capture :", e && e.name); });
        } else if (kb && kb.unlock) kb.unlock();
      }catch(e){ console.warn("[plein ecran]", e); }
      fitCanvas();
    });
    majPlein();

    var quit=document.createElement("button"); quit.textContent=T("Quitter"); quit.className="quit";
    [sel,fit,qual,fps,cod,swp,ecr,act,clav,plein,quit].forEach(function(x){ bar.appendChild(x); });

    // La poignee replie / deplie la barre. Repliee, elle ne laisse a l'ecran
    // qu'un bouton de 28 px : le reste du coin haut-droit redevient cliquable
    // sur le poste distant (barre de menus, boutons de fenetre). On deplie au
    // CLIC, pas au survol : le survol se declencherait precisement en passant la
    // souris dans ce coin. Le canvas avale Tab : la barre reste a la souris.
    var handle=document.createElement("button");
    handle.className="rdhandle"; handle.type="button";
    handle.setAttribute("aria-controls","rdbar");
    function majPoignee(){
      var replie = bar.classList.contains("replie");
      handle.setAttribute("aria-expanded", replie ? "false" : "true");
      handle.textContent = replie ? "⚙" : "»";
      handle.title = replie ? T("Afficher les réglages de la session") : T("Replier les réglages");
      handle.setAttribute("aria-label", handle.title);
    }
    function fixerBarre(replie, memoriser){
      bar.classList.toggle("replie", replie);
      majPoignee();
      if (memoriser) prefs.set({ bar: replie ? "repliee" : "ouverte" });
    }
    handle.onclick=function(){ fixerBarre(!bar.classList.contains("replie"), true); };
    // Echap replie, MAIS sur la barre seulement : sur le document il se
    // combinerait avec l'envoi de la touche au poste distant (le canvas
    // transmet Echap). Un <select> l'utilise pour fermer sa liste : on l'y laisse.
    bar.addEventListener("keydown", function(ev){
      var tag = ev.target && String(ev.target.tagName || "").toUpperCase();
      if (ev.key !== "Escape" || tag === "SELECT" || bar.classList.contains("replie")) return;
      fixerBarre(true, true);
      // Le focus ne revient au canvas qu'APRES le keyup d'Echap : le lui rendre
      // tout de suite lui ferait recevoir un keyup sans keydown, que le canvas
      // enverrait au poste distant. (Le bouton replie disparait, le focus tombe
      // sur <body> : le keyup n'a plus de gestionnaire.) Delai de garde : si le
      // keyup ne vient jamais, l'ecouteur ne reste pas arme.
      var rendre = function(e2){
        if (e2.key !== "Escape") return;
        document.removeEventListener("keyup", rendre, true);
        setTimeout(function(){ var c=active(); if(c) c.focus(); }, 0);
      };
      document.addEventListener("keyup", rendre, true);
      setTimeout(function(){ document.removeEventListener("keyup", rendre, true); }, 1500);
    });
    bar.appendChild(handle);
    ui.barre = bar;
    fixerBarre(prefs.get().bar !== "ouverte", false);        // repliee par defaut : rien a migrer
    document.body.appendChild(bar);
    // Un bouton de la barre garde le clavier apres son clic : le focus tombait
    // sur <body>, et le collage restait ignore jusqu'au prochain clic dans
    // l'image. Le canvas le reprend — sauf pour un <select>, qui doit garder le
    // focus pour ouvrir sa liste.
    bar.addEventListener("click", function(ev){
      var tag = ev.target && String(ev.target.tagName || "").toUpperCase();
      if (tag === "SELECT" || tag === "OPTION") return;
      setTimeout(function(){ var c = active(); if (c && c.focus) c.focus(); }, 0);
    });

    var orig=document.querySelector("#canvas > button");
    if(orig) orig.style.display="none";
    quit.onclick=function(){
      reprise.voulue = true; repriseAnnuler(); repriseInfo("");
      if(orig) orig.click(); else if(window.cancel) window.cancel();
    };

    function apply(w,h){
      if(rdSend({misc:{change_resolution:{width:w|0,height:h|0}}}))
        console.log("[resolution] demande "+w+"x"+h);
      var c=active(); if(c) c.focus();
    }
    window.__rdMenu=function(){
      var r=RD.res||[]; sel.innerHTML="";
      var o=document.createElement("option");
      o.textContent=r.length?T("Résolution"):T("(indisponible)"); o.value="";
      sel.appendChild(o);
      r.forEach(function(m){ var x=document.createElement("option");
        x.value=m.width+"x"+m.height; x.textContent=m.width+"x"+m.height; sel.appendChild(x); });
    };
    sel.onchange=function(){ if(!sel.value) return; var v=sel.value.split("x"); apply(+v[0],+v[1]); };
    fit.onclick=function(){
      var r=RD.res||[]; if(!r.length){ console.warn("[resolution] aucune liste"); return; }
      var vw=window.innerWidth, vh=window.innerHeight, best=null, score=Infinity;
      r.forEach(function(m){
        var d=Math.abs(m.width-vw)+Math.abs(m.height-vh);
        if(Math.abs(m.width/m.height - vw/vh)<0.02) d*=0.5;
        if(d<score){ score=d; best=m; }
      });
      if(best) apply(best.width,best.height);
    };
    window.__rdBar=bar;
    window.__rdMenu();

    // --- Affichage des percentiles ---
    var hud=document.createElement("div"); hud.id="rdhud";
    hud.className="surimage";
    var hudTel=document.createElement("span");
    hudTel.setAttribute("aria-hidden","true");       // releve continu, jamais annonce
    var hudSta=document.createElement("span");
    hudSta.className="statut"; hudSta.setAttribute("role","status");
    hud.appendChild(hudTel); hud.appendChild(hudSta);
    hud.__statut=hudSta;
    document.body.appendChild(hud);
    window.__rdHud=hud;
    var lastFrames=0, lastT=performance.now();

    setInterval(function(){
      var S=RD.stats, P=window.__rdPct;
      var now=performance.now(), dt=(now-lastT)/1000;
      var ips = dt>0 ? (S.frames-lastFrames)/dt : 0;
      lastFrames=S.frames; lastT=now;

      function fmt(a,u){
        if(!a.length) return "—";
        return P(a,.50).toFixed(0)+" / "+P(a,.95).toFixed(0)+" / "+P(a,.99).toFixed(0)+" "+u;
      }
      hudTel.textContent =
        T("aller-retour  p50/p95/p99   ") + fmt(S.delay,"ms") + "\n" +
        T("décodage      p50/p95/p99   ") + fmt(S.decode,"ms") + "\n" +
        T("trames reçues {0}/s    débit cible {1} kbit/s    codec {2}", ips.toFixed(1), S.bitrate, RD.codec || T("logiciel"));
      placerHud();
    }, 1000);

    window.addEventListener("resize", fitCanvas);

    // Veilleur : taille, reglages initiaux, repatch apres reconnexion.
    var last=0;
    setInterval(function(){
      var c = active();
      if (c && c.width !== last){
        last = c.width;
        console.log("[ecran distant] "+c.width+"x"+c.height);
        fitCanvas();
      }
      // Memoriser le mot de passe du pair : ui.js ne l'active jamais. C'est un
      // choix de l'utilisateur (case de l'ecran de connexion), plus une
      // obligation : le bundle garde ce mot de passe en clair dans le navigateur.
      try{
        var veut = prefs.get().remember !== false, k0 = window.curConn;
        if (k0 && !!k0.getRemember() !== veut) k0.setRemember(veut);
      }catch(_){}
      // Reappliquer les substitutions : curConn est remplace a chaque
      // connexion, et reconnect() reutilise l'instance avec un _ws neuf.
      try{ patchConn(window.curConn); }catch(_){}
      var enSession = sessionVivante();
      if (enSession) veilleActiver(); else veilleLiberer();
      // Transition « en session » -> « plus en session » : tenter une reprise.
      if (window.__rdEtait && !enSession){ repriseplanifier(); try{ document.title = "RustDesk"; }catch(_){} }
      if (enSession){ repriseAnnuler(); repriseInfo(""); }
      window.__rdEtait = enSession;
      var vu = enSession ? "block" : "none";
      if (window.__rdBar) window.__rdBar.style.display = (vu==="block") ? "flex" : "none";
      if (window.__rdHud) window.__rdHud.style.display = vu;
    }, 800);
  }

  // ------------------------------------------------- preremplissage du formulaire
  // ui.js remplit les champs dans document.body.onload, qui peut ne jamais se
  // declencher (module differe). Et le gestionnaire de mots de passe du
  // navigateur ecrase le champ ID en le prenant pour un identifiant de compte
  // — il propose souvent l'identifiant du compte a la place de l'ID.
  // Valeurs faisant autorite : elles viennent du deploiement, jamais du formulaire.
  var RD_HOST = "__RD_DOMAIN__", RD_KEY = "__RD_PUBLIC_KEY__";
  var DEFAUT_ID = "__RD_DEFAULT_PEER_ID__";
  function prefillForm(){
    var host=document.getElementById("host"),
        id  =document.getElementById("id"),
        key =document.getElementById("key");
    if(!host||!id||!key) return false;
    if(host.dataset.prefilled) return true;
    host.dataset.prefilled="1";

    [host,id,key].forEach(function(el){
      el.setAttribute("autocomplete","off");
      el.setAttribute("autocorrect","off");
      el.setAttribute("spellcheck","false");
      el.setAttribute("data-1p-ignore","");      // 1Password
      el.setAttribute("data-lpignore","true");   // LastPass
    });
    id.setAttribute("inputmode","numeric");
    id.setAttribute("name","rd-target-id");      // nom neutre : pas "user"/"login"

    host.value = localStorage.getItem("custom-rendezvous-server") || "";
    key.value  = localStorage.getItem("key") || "";
    // L'ID reste modifiable : on ne le pose que s'il est vide ou si le
    // gestionnaire de mots de passe l'a rempli avec autre chose qu'un ID.
    var v = (id.value||"").trim();
    if(!v || !/^[0-9 ]{6,}$/.test(v)) id.value = localStorage.getItem("id") || DEFAUT_ID;

    // Corrige aussi un remplissage tardif par le navigateur.
    setTimeout(function(){
      var w=(id.value||"").trim();
      if(!w || !/^[0-9 ]{6,}$/.test(w)) id.value = localStorage.getItem("id") || DEFAUT_ID;
      if(key.value !== RD_KEY) key.value = RD_KEY;
      if(host.value !== RD_HOST) host.value = RD_HOST;
    }, 400);

    poserRecents(id);
    try { habillerFormulaire(host, id, key); }
    catch(e){ console.warn("[formulaire] habillage :", e); }
    console.log("[formulaire] prerempli — ID "+id.value+" (modifiable)");
    return true;
  }

  // ------------------------------------------------- habillage du formulaire
  // Le formulaire est celui du bundle : trois champs nus, des libelles en
  // anglais, aucun titre. On l'habille SANS le reconstruire — le bundle lit
  // #host, #key et #id par leur identifiant, et ses boutons appellent ses
  // propres fonctions. L'hote et la cle viennent du deploiement et sont
  // reaffirmes a chaque connexion : les montrer comme des champs a remplir
  // etait trompeur, leurs lignes sont masquees et le serveur est rappele en clair.
  function ligneDe(el){ return el && el.closest ? el.closest("tr") : null; }
  function habillerFormulaire(host, id, key){
    var boite = document.querySelector("div#connect");
    if (!boite || !boite.insertBefore || boite.dataset.habille) return;
    boite.dataset.habille = "1";
    var table = boite.querySelector("table");

    var entete = document.createElement("div"); entete.id = "rd-entete";
    var logo = document.createElement("img");
    logo.src = "favicon.svg"; logo.alt = ""; logo.width = 44; logo.height = 44;
    var h1 = document.createElement("h1"); h1.textContent = "RustDesk Web";
    var sous = document.createElement("p"); sous.textContent = T("Connexion à un poste distant");
    entete.appendChild(logo); entete.appendChild(h1); entete.appendChild(sous);
    boite.insertBefore(entete, boite.firstChild);

    [host, key].forEach(function(el){ var tr = ligneDe(el); if (tr) tr.hidden = true; });
    var trId = ligneDe(id);
    if (trId){
      var lib = trId.querySelector("span");
      if (lib){
        var lab = document.createElement("label");
        lab.setAttribute("for", "id"); lab.textContent = T("ID du poste");
        lib.parentNode.replaceChild(lab, lib);
      }
    }
    id.setAttribute("placeholder", "123 456 789");
    var go = boite.querySelector("button[onclick]");
    if (go) go.textContent = T("Connexion");
    // Entree dans le champ ID lance la connexion : le bundle ne le fait pas.
    id.addEventListener("keydown", function(ev){
      if (ev.key === "Enter" && go){ ev.preventDefault(); go.click(); }
    });

    var pied = document.createElement("div"); pied.id = "rd-pied";
    // Le bundle garde le mot de passe d'un poste EN CLAIR dans le stockage du
    // navigateur. C'est commode sur son propre ordinateur, a eviter ailleurs.
    var memo = document.createElement("label"); memo.id = "rd-memo";
    var coche = document.createElement("input"); coche.type = "checkbox";
    coche.checked = prefs.get().remember !== false;
    coche.onchange = function(){
      prefs.set({ remember: !!coche.checked });
      if (!coche.checked){
        var n = oublierMotsDePasse();
        notifier(n ? T("Mots de passe mémorisés effacés ({0}).", n) : T("Les mots de passe ne seront plus mémorisés."));
      }
    };
    memo.appendChild(coche);
    memo.appendChild(document.createTextNode(" " + T("Mémoriser les mots de passe sur cet appareil")));
    pied.appendChild(memo);

    var bas = document.createElement("p"); bas.id = "rd-serveur";
    bas.appendChild(document.createTextNode(T("Serveur") + " : "));
    var hb = document.createElement("b"); hb.textContent = RD_HOST; bas.appendChild(hb);
    var lg = document.createElement("select"); lg.id = "rd-langue";
    lg.setAttribute("aria-label", T("Langue de l'interface"));
    [["fr","Français"],["en","English"]].forEach(function(o){
      var x = document.createElement("option"); x.value = o[0]; x.textContent = o[1]; lg.appendChild(x); });
    lg.value = LANGUE;
    lg.onchange = function(){
      prefs.set({ lang: lg.value });
      try { window.location.reload(); } catch(_){}
    };
    bas.appendChild(lg);
    pied.appendChild(bas);
    if (table && table.parentNode) table.parentNode.insertBefore(pied, table.nextSibling);
    else boite.appendChild(pied);

    // --- Ecran du mot de passe.
    var mdp = document.querySelector("div#password");
    if (mdp){
      var champ = mdp.querySelector("input");
      var titre = document.createElement("p"); titre.id = "rd-mdp-titre";
      titre.textContent = T("Mot de passe du poste distant");
      mdp.insertBefore(titre, mdp.firstChild);
      if (champ){
        champ.setAttribute("placeholder", T("Mot de passe"));
        champ.setAttribute("aria-label", T("Mot de passe du poste distant"));
        champ.setAttribute("autocomplete", "off");
        // Entree valide : le bouton « Confirm » du bundle appelle sa fonction
        // confirm(), qui a remplace window.confirm.
        champ.addEventListener("keydown", function(ev){
          if (ev.key !== "Enter") return;
          ev.preventDefault();
          var ok = mdp.querySelector("button#confirm"); if (ok) ok.click();
        });
      }
      var bOk = mdp.querySelector("button#confirm"); if (bOk) bOk.textContent = T("Valider");
    }
    Array.prototype.forEach.call(document.querySelectorAll("#app button#cancel"), function(b){ b.textContent = T("Annuler"); });

    // --- Ecran d'attente : le bundle y ecrit en anglais.
    var texte = document.querySelector("div#text");
    if (texte && window.MutationObserver){
      new MutationObserver(function(){
        var brut = (texte.textContent || "").trim();
        var cle = Object.prototype.hasOwnProperty.call(RDLib.i18n.STATUTS, brut) ? RDLib.i18n.STATUTS[brut] : null;
        if (!cle) return;
        var cible = texte.firstElementChild || texte;
        cible.textContent = T(cle);
        // « Wrong Password » : le bundle propose de ressaisir… sans montrer le
        // champ. On le montre, vide, avec le focus.
        if (brut === "Do you want to enter again?" && mdp){
          var c2 = mdp.querySelector("input");
          var st = document.querySelector("div#status");
          if (st) st.style.display = "none";
          mdp.style.display = "block";
          if (titre) titre.textContent = T("Mot de passe incorrect.") + " " + T("Mot de passe du poste distant");
          if (c2){ c2.value = ""; c2.focus(); }
        } else if (titre) titre.textContent = T("Mot de passe du poste distant");
      }).observe(texte, { childList: true, subtree: true, characterData: true });
    }
    // Le champ du mot de passe prend le focus des qu'il apparait.
    if (mdp && window.MutationObserver){
      new MutationObserver(function(){
        if (mdp.style.display === "none") return;
        var c3 = mdp.querySelector("input");
        if (c3 && document.activeElement !== c3) c3.focus();
      }).observe(mdp, { attributes: true, attributeFilter: ["style"] });
    }
  }
  // Retire les mots de passe que le bundle a memorises, pour tous les postes.
  // Rend le nombre de fiches touchees.
  function oublierMotsDePasse(){
    var n = 0;
    try{
      var P = JSON.parse(window.localStorage.getItem("peers") || "{}");
      for (var k in P){ if (P[k] && P[k].password !== undefined){ delete P[k].password; n++; } }
      window.localStorage.setItem("peers", JSON.stringify(P));
    }catch(e){ console.warn("[memorisation]", e); }
    return n;
  }
  window.__rdOublier = oublierMotsDePasse;

  // Le bundle recopie le formulaire dans localStorage a CHAQUE connexion :
  //   window.connect = () => { … localStorage.setItem("key", $("#key").value) … }
  // Tout ce qui a rempli #key entre-temps devient donc la cle envoyee a hbbr.
  // Le gestionnaire de mots de passe du navigateur le fait volontiers : il voit
  // un trio hote / cle / identifiant et propose ses propres identifiants — on
  // l'avait deja vu s'emparer du champ ID. hbbr rejette alors la liaison relais
  // sans un mot au client (« invalid key » cote serveur, fermeture en moins
  // d'une seconde cote navigateur), et rien a l'ecran n'indique que c'est le
  // formulaire qui a ete altere.
  //
  // L'hote et la cle viennent du deploiement, jamais de l'utilisateur. On les
  // reaffirme donc juste avant que le bundle ne les lise. Seul l'ID reste libre.
  (function protegerConnect(){
    var mien = null;
    function proteger(orig){
      if (typeof orig !== "function" || orig === mien) return;  // deja protege
      mien = function(){
        var h = document.getElementById("host"), k = document.getElementById("key");
        if (h && h.value !== RD_HOST){
          console.warn("[formulaire] hote altere (\"" + h.value + "\") — corrige avant connexion");
          h.value = RD_HOST;
        }
        if (k && k.value !== RD_KEY){
          console.warn("[formulaire] cle alteree (" + (k.value ? k.value.length + " caracteres" : "champ vide")
                     + ") — corrigee avant connexion ; sans cela hbbr aurait repondu « invalid key »");
          k.value = RD_KEY;
        }
        // Une NOUVELLE session commence : elle n'est pas prete tant que son propre
        // peer_info n'est pas arrive. On le remet a faux ICI et non en fin de
        // session — le diagnostic des liaisons relais lit RD.ready, et une
        // fermeture normale ne doit pas passer pour « cle refusee ». Ce chemin est
        // celui du bouton Connect ET de la reprise auto (reconnect() du bundle le
        // contourne, mais rien ne l'appelle).
        RD.ready = false;
        RD.epoque = (RD.epoque | 0) + 1;
        // « Quitter » pose reprise.voulue et rien ne l'effacait : apres une
        // deconnexion voulue, la reprise auto restait coupee jusqu'au rechargement.
        // Une nouvelle connexion est, par definition, une nouvelle intention.
        reprise.voulue = false;
        return orig.apply(this, arguments);
      };
      console.log("[formulaire] connexion protegee : hote et cle reaffirmes a chaque essai");
    }
    // Le bundle pose window.connect a son chargement, plus tard que ce bloc.
    // On s'accroche a l'AFFECTATION : la protection est en place avant le
    // premier clic, sans attendre un minuteur. Si la propriete ne se laisse pas
    // redefinir, le minuteur d'origine reprend le role.
    var autre = window.connect;
    try{
      Object.defineProperty(window, "connect", { configurable: true, enumerable: true,
        get: function(){ return mien || autre; },
        set: function(f){ if (typeof f === "function"){ if (f !== mien) proteger(f); } else { mien = null; autre = f; } } });
      if (typeof autre === "function") proteger(autre);
    }catch(e){
      setInterval(function(){
        var o = window.connect;
        if (typeof o === "function" && o !== mien){ proteger(o); window.connect = mien; }
      }, 300);
    }
  })();

  // curConn est remplace a chaque connexion, et sa liaison (_ws) n'est creee
  // qu'ensuite, dans start(). Le veilleur (800 ms) reinstrumentait apres coup :
  // les premiers messages passaient donc par la connexion d'origine. On
  // s'accroche aux deux affectations ; le veilleur reste comme filet.
  (function accrocherConn(){
    function suivreWs(c){
      if (!c || typeof c !== "object" || c.__rdWsSuivi) return;
      try{
        var ws = c._ws;
        Object.defineProperty(c, "__rdWsSuivi", { value: true });
        Object.defineProperty(c, "_ws", { configurable: true, enumerable: true,
          get: function(){ return ws; },
          set: function(v){ ws = v; try{ patchConn(c); }catch(_){} } });
      }catch(_){}
    }
    var conn = window.curConn;
    try{
      Object.defineProperty(window, "curConn", { configurable: true, enumerable: true,
        get: function(){ return conn; },
        set: function(v){ conn = v; suivreWs(v); try{ patchConn(v); }catch(_){} } });
    }catch(_){}
  })();

  // ---------------------------------------------------------- amorcage
  probeCodecs().then(function(c){
    RD.codec = c;
    console.log("[codec] niveau retenu : " + (c ? c + " (WebCodecs)" : "logiciel (ogv.js)"));
  });

  setInterval(function(){
    prefillForm();
    var p = player();
    if (!p) return;
    wireGlobal();
    wireCanvas(p);
    var r = document.getElementById("rdcanvas");
    if (RD.codec && !r) { r = rdcanvas(); }
    if (r) wireCanvas(r);
    showActive();
  }, 400);
})();
