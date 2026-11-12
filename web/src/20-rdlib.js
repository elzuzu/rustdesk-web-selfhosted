// ===================================================================
// RDLib — la logique PURE de la page : aucun acces au DOM, aucune globale
// hormis window.RDLib. Le stockage, le decodeur zstd et l'horloge sont
// INJECTES : c'est ce qui permet de tester tout ceci sous Node, sans
// navigateur (scripts/test-template.mjs charge ce bloc dans un contexte vide).
//
// Le cablage — evenements, canvas, barre, WebSocket — reste dans le bloc
// suivant. Ici, seulement des fonctions qui prennent des valeurs et en rendent.
//
// Tout tient dans une IIFE : les scripts classiques partagent la portee
// lexicale globale, un « const » de premier niveau declare deux fois dans deux
// blocs leve au chargement.
// ===================================================================
(function(){
  var MIO = 1024 * 1024;

  // ------------------------------------------------------------ identifiants
  // Meme regle que prefillForm : un ID de poste distant est numerique, avec ou
  // sans espaces de presentation. Un champ qui contient autre chose a ete
  // rempli par un gestionnaire de mots de passe, pas par l'utilisateur.
  function isPeerId(s){
    return typeof s === "string" && /^[0-9 ]{6,}$/.test(s.trim());
  }
  // L'ID sans espaces, ou null. Au moins six chiffres : « 12 3 4 5 » passe
  // isPeerId (huit caracteres) mais n'est pas un ID.
  function normId(s){
    if (!isPeerId(s)) return null;
    var d = s.replace(/\s+/g, "");
    // Trente-deux chiffres au plus : un « ID » de 300 000 chiffres est un
    // contenu de stockage hostile, pas un identifiant.
    return /^[0-9]{6,32}$/.test(d) ? d : null;
  }
  // « 123456789 » -> « 123 456 789 » : la presentation de RustDesk.
  function fmtId(s){
    var d = normId(s);
    return d ? d.replace(/(\d{3})(?=\d)/g, "$1 ") : "";
  }

  // Un nom de poste venu du pair : du texte libre, donc borne et nettoye
  // (caracteres de controle retires) avant d'aller dans un titre ou une pastille.
  function nomPoste(s){
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  }

  // ---------------------------------------------------------------- presse-papier
  var FMT = { TEXT: 0, HTML: 2, RGBA: 21, PNG: 22 };
  var LIM = {
    OUT_PNG: 8 * MIO,      // image envoyee au poste distant, apres conversion
    RAW_MAX: 128 * MIO,    // taille decompressee maximale acceptee en entree
    SRC_MAX: 64 * MIO,     // image locale au-dela de laquelle on ne tente meme pas
    PIXELS_MAX: 32 * MIO   // pixels d'une image ENVOYEE : le poste distant la decode en RGBA (4 octets/pixel)
  };
  var ERR = { DECODE: "DECODE", TOO_BIG: "TOO_BIG", SHORT: "SHORT", DIMS: "DIMS",
              ENCODE: "ENCODE", LIMIT: "LIMIT", VERSION: "VERSION", NOSEND: "NOSEND",
              BITMAP: "BITMAP", DENIED: "DENIED" };

  // Un message par code : ce que l'utilisateur lit dans le bandeau. Le journal,
  // lui, garde le detail technique.
  var messages = {
    DECODE:  "Décompression de l'image impossible (données corrompues ou trop volumineuses).",
    TOO_BIG: "Image trop volumineuse pour être traitée.",
    SHORT:   "Image reçue incomplète.",
    DIMS:    "Dimensions d'image invalides.",
    ENCODE:  "Conversion de l'image impossible.",
    LIMIT:   "Image trop grande pour le presse-papier distant, même réduite.",
    VERSION: "Le poste distant (RustDesk antérieur à 1.3.0) ne sait pas recevoir une image par le presse-papier.",
    NOSEND:  "Envoi impossible : la session n'est pas prête.",
    BITMAP:  "Format d'image non pris en charge par ce navigateur.",
    DENIED:  "Le navigateur a refusé d'écrire dans le presse-papier."
  };

  function ClipError(code, detail){
    var e = new Error(code + (detail ? " : " + detail : ""));
    e.name = "ClipError"; e.code = code; e.detail = detail || "";
    return e;
  }

  // Ce que le poste distant annonce : une liste d'entrees, chacune avec son
  // format. On garde UNE entree par usage — image (PNG avant RGBA), HTML,
  // texte — sans rien decoder : le decodage coute, il se fait plus tard.
  function select(liste){
    var r = { image: null, html: null, text: null }, png = null, rgba = null;
    for (var i = 0; i < (liste || []).length; i++){
      var cb = liste[i];
      if (!cb) continue;
      if (cb.format === FMT.PNG  && !png)    png = cb;
      else if (cb.format === FMT.RGBA && !rgba) rgba = cb;
      else if (cb.format === FMT.HTML && !r.html) r.html = cb;
      else if (cb.format === FMT.TEXT && !r.text) r.text = cb;
    }
    if (png) r.image = { kind: "png", cb: png };
    else if (rgba) r.image = { kind: "rgba", cb: rgba };
    return r;
  }

  // La taille decompressee, lue dans l'en-tete de la trame zstd, sans wasm.
  // null si la trame ne la declare pas (ou n'est pas une trame zstd).
  //   magic(4) | descripteur(1) | [fenetre(1)] | [dictionnaire(0-4)] | [taille(0-8)]
  function zstdContentSize(u8){
    if (!u8 || u8.length < 6) return null;
    if (u8[0] !== 0x28 || u8[1] !== 0xb5 || u8[2] !== 0x2f || u8[3] !== 0xfd) return null;
    var d = u8[4], fcsFlag = d >> 6, single = (d >> 5) & 1, dict = d & 3;
    var pos = 5 + (single ? 0 : 1) + [0, 1, 2, 4][dict];
    var n = fcsFlag === 0 ? (single ? 1 : 0) : [1, 2, 4, 8][fcsFlag];
    if (!n || u8.length < pos + n) return null;
    var lo = 0, hi = 0, k;
    for (k = 0; k < Math.min(n, 4); k++) lo += u8[pos + k] * Math.pow(2, 8 * k);
    for (k = 4; k < n; k++) hi += u8[pos + k] * Math.pow(2, 8 * (k - 4));
    if (hi > 0x1fffff) return null;                 // au-dela de 2^53 : inexploitable
    var v = hi * 4294967296 + lo;
    return fcsFlag === 1 ? v + 256 : v;
  }

  // Decompresse, ou LEVE. Le decodeur du bundle ne leve jamais : quand la
  // destination est trop petite, ou la trame corrompue, il rend un tableau
  // VIDE — truthy, donc invisible pour un « if(!x) » — et le bundle dimensionne
  // sa destination a 30 x la taille compressee, ce qui ne suffit pas pour une
  // image a fonds unis (taux > 30). Regle ici : une sortie vide pour une
  // entree non vide est une erreur, jamais un contenu.
  //
  // Ordre des tailles essayees : celle de l'en-tete de trame (exacte), sinon
  // l'indication de l'appelant (largeur x hauteur x 4 pour du RGBA), sinon un
  // doublement a partir de 30 x l'entree, plafonne a opts.max.
  // « dec » est { decode(u8, taille) } ; le retour peut etre synchrone ou une
  // promesse (le repli sur __rdUnzstd, ancien bundle, en rend une).
  async function decompress(dec, u8, opts){
    opts = opts || {};
    var max = opts.max > 0 ? opts.max : LIM.RAW_MAX;
    if (!u8 || !u8.length) throw ClipError(ERR.DECODE, "entree vide");
    // Pas de magic zstd : inutile de demander au decodeur d'allouer jusqu'a
    // 128 Mio, huit fois de suite, pour apprendre que ce n'est pas une trame.
    if (u8.length < 4 || u8[0] !== 0x28 || u8[1] !== 0xb5 || u8[2] !== 0x2f || u8[3] !== 0xfd)
      throw ClipError(ERR.DECODE, "ce n'est pas une trame zstd");
    var fcs = zstdContentSize(u8), tailles = [];
    if (fcs !== null){
      if (fcs > max) throw ClipError(ERR.TOO_BIG, fcs + " octets declares, limite " + max);
      tailles.push(fcs);
    } else {
      var t = opts.hint > 0 ? opts.hint : Math.max(MIO, 30 * u8.length);
      if (t > max) t = max;
      tailles.push(t);
      while (t < max){ t = Math.min(t * 2, max); tailles.push(t); }
    }
    // Le repli sur l'ancien __rdUnzstd (S3 ignore la taille demandee) n'a
    // aucune raison d'etre rejoue huit fois avec le meme resultat.
    if (dec && dec.unique) tailles = tailles.slice(0, 1);
    var derniere = "";
    for (var i = 0; i < tailles.length; i++){
      var out;
      try { out = await dec.decode(u8, tailles[i]); }
      catch (e){ derniere = String(e && e.message || e); continue; }
      if (out && out.length) return out;
    }
    throw ClipError(ERR.DECODE, "aucune taille de sortie ne convient (jusqu'a "
                    + tailles[tailles.length - 1] + " octets)" + (derniere ? " — " + derniere : ""));
  }

  // Une sortie VIDE est-elle un echec du decodeur, ou le vrai contenu d'une
  // trame vide ? Seule la taille declaree dans l'en-tete le dit : 0 -> legitime ;
  // autre chose, ou rien de declare -> le decodeur a echoue sans le dire.
  function sortieVideSuspecte(entree, sortie){
    if (sortie && sortie.length) return false;
    return zstdContentSize(entree) !== 0;
  }

  // Les pixels d'une image RGBA brute, ou une erreur : dimensions plausibles,
  // et assez d'octets. Un tampon trop court laissait jusqu'ici des pixels a
  // zero — une image transparente, collee sans un mot.
  function rgbaPixels(raw, w, h){
    if (!(w > 0 && h > 0) || w !== Math.floor(w) || h !== Math.floor(h) || w > 16384 || h > 16384)
      throw ClipError(ERR.DIMS, w + "x" + h);
    var n = w * h * 4;
    if (n > LIM.RAW_MAX) throw ClipError(ERR.TOO_BIG, w + "x" + h);
    if (!raw || raw.length < n) throw ClipError(ERR.SHORT, (raw ? raw.length : 0) + " octets pour " + n);
    return new Uint8ClampedArray(raw.buffer, raw.byteOffset, n);
  }

  // Une ligne de journal : sans elle, « image/png 1920x1080 » s'ecrivait dans
  // les deux cas — PNG deja compresse ou RGBA brut compresse en zstd — et on ne
  // pouvait pas dire lequel le poste distant envoyait.
  function describe(cb, rawLen){
    if (!cb) return "(aucune entree)";
    var noms = { 0: "texte", 1: "rtf", 2: "html", 21: "rgba", 22: "png", 23: "svg", 31: "special" };
    var reseau = cb.content ? cb.content.length : 0;
    return "format " + cb.format + " (" + (noms[cb.format] || "?") + ")"
         + ", compress=" + (cb.compress ? "oui" : "non")
         + ", " + reseau + " o recus"
         + (rawLen != null ? " -> " + rawLen + " o bruts" : "")
         + (cb.width && cb.height ? ", " + cb.width + "x" + cb.height : "");
  }

  // Un emplacement par usage. Un texte arrivant apres une image ne l'efface
  // plus : chacun garde le sien, et chacun a son bouton.
  function slots(){
    var m = {}, ordre = [];
    return {
      put: function(kind, e){ if (!(kind in m)) ordre.push(kind); m[kind] = e; },
      get: function(kind){ return kind in m ? m[kind] : null; },
      take: function(kind){
        if (!(kind in m)) return null;
        var e = m[kind]; delete m[kind];
        ordre = ordre.filter(function(k){ return k !== kind; });
        return e;
      },
      kinds: function(){ return ordre.slice(); }
    };
  }

  // Signature d'un PNG : 89 50 4E 47 0D 0A 1A 0A.
  function estPng(u8){
    if (!u8 || u8.length < 8) return false;
    var sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (var i = 0; i < 8; i++) if (u8[i] !== sig[i]) return false;
    return true;
  }

  // Dimensions ramenees sous PIXELS_MAX, rapport conserve. Inchangees si elles y sont deja.
  function reduirePixels(w, h){
    if (!(w > 0 && h > 0) || w * h <= LIM.PIXELS_MAX) return { w: w, h: h };
    var f = Math.sqrt(LIM.PIXELS_MAX / (w * h));
    return { w: Math.max(1, Math.floor(w * f)), h: Math.max(1, Math.floor(h * f)) };
  }

  // Une image locale de plus de SRC_MAX n'est meme pas decodee.
  function precheck(octetsSource){
    if (octetsSource > LIM.SRC_MAX)
      throw ClipError(ERR.TOO_BIG, octetsSource + " octets, limite " + LIM.SRC_MAX);
    return true;
  }

  // Dimensions pour tenir sous la limite. Le PNG grossit a peu pres avec la
  // surface : facteur = racine(limite / octets), avec une marge de 10 %. Rend
  // les memes dimensions si l'image passe deja, null si l'on descendrait sous
  // 64 px. L'appelant reessaie au plus trois fois, en remesurant.
  function nextScale(w, h, octets, limite){
    if (octets <= limite) return { w: w, h: h };
    var f = Math.sqrt(limite / octets) * 0.9;
    f = Math.min(0.95, Math.max(0.35, f));
    var nw = Math.floor(w * f), nh = Math.floor(h * f);
    if (nw < 64 || nh < 64) return null;
    return { w: nw, h: nh };
  }

  // Le collage distant est rejoue APRES l'envoi. Un texte tient dans un
  // paquet ; une image de plusieurs Mio doit etre recue, decodee et posee par
  // le poste distant avant qu'on lui dise de coller. C'est une HEURISTIQUE —
  // rien ne dit, cote pair, que l'ecriture est terminee — d'ou le plancher a
  // 150 ms (l'ancienne valeur fixe) et la possibilite de la forcer.
  function pasteDelayMs(octets, override){
    if (typeof override === "number" && isFinite(override) && override >= 0)
      return Math.min(10000, Math.floor(override));
    var ms = 150 + Math.floor((octets > 0 ? octets : 0) / MIO) * 250;
    return Math.min(2500, Math.max(150, ms));
  }

  // multi_clipboards n'existe qu'a partir de RustDesk 1.3.0. true / false, ou
  // null quand la version est inconnue ou illisible.
  function peerSupportsMulti(ver){
    var m = /^\s*(\d+)\.(\d+)/.exec(String(ver == null ? "" : ver));
    if (!m) return null;
    var maj = parseInt(m[1], 10), min = parseInt(m[2], 10);
    return maj > 1 || (maj === 1 && min >= 3);
  }

  // Faut-il traiter un « paste » ? Sur le canvas, oui. Sur le corps de la page
  // pendant une session vivante aussi : apres un clic sur un bouton de la barre
  // le focus tombe sur <body>, et le collage restait ignore jusqu'au prochain
  // clic dans l'image. Dans un champ (fenetre modale, panneau de fichiers), ou
  // sur un autre controle, jamais : le collage y appartient a l'utilisateur.
  function pasteAccepte(cx){
    return !!cx && (cx.cible === "canvas" || (cx.cible === "body" && !!cx.enSession));
  }

  // Est-ce un « coller » ? La lettre saisie fait foi (Dvorak : le v est ailleurs
  // sur le clavier). Sous une disposition d'un alphabet non latin — cyrillique,
  // grec, arabe, hebreu — la lettre n'est pas un v, mais le navigateur declenche
  // quand meme « paste » sur la touche physique : on la reconnait a son code, et
  // SEULEMENT si le caractere saisi est une lettre de cet alphabet. Une
  // ponctuation ou un chiffre sur cette touche n'est pas un collage : l'avaler
  // ferait disparaitre le raccourci de la session distante.
  function isPasteChord(e){
    if (!e || !(e.ctrlKey || e.metaKey) || e.altKey) return false;
    var key = typeof e.key === "string" ? e.key : "";
    if (key.toLowerCase() === "v") return true;
    return e.code === "KeyV" && /^\p{L}$/u.test(key) && !/^\p{Script=Latin}$/u.test(key);
  }

  // ------------------------------------------------- stockage : deux pieges
  // Storage.prototype.setItem est surcharge plus haut et AVALE toute erreur
  // (quota compris) : une ecriture perdue ne se voit qu'en relisant. Toute
  // ecriture d'ici est donc relue et comparee ; si elle n'a pas tenu, la page
  // garde sa copie en memoire et continue de fonctionner. Et jamais de cache
  // entre deux mutations : lire, modifier, ecrire — deux onglets ne s'ecrasent
  // ainsi qu'au sens du dernier ecrivain.
  function lire(storage, key){
    try { return storage.getItem(key); } catch (e) { return null; }
  }
  function ecrire(storage, key, texte){
    try {
      storage.setItem(key, texte);
      return storage.getItem(key) === texte;
    } catch (e) { return false; }
  }
  function json(texte){
    if (typeof texte !== "string") return null;
    try { var v = JSON.parse(texte); return v && typeof v === "object" ? v : null; }
    catch (e) { return null; }
  }

  // ---------------------------------------------------------------- reglages
  // Liste blanche : une valeur inconnue (ancienne version, stockage corrompu,
  // cle « __proto__ ») est ignoree, jamais recopiee.
  var PREFS_OK = {
    quality: ["balanced", "best", "low"],
    fps:     [10, 15, 30, 60],
    codec:   ["auto", "h265", "h264", "av1", "vp9", "logiciel"],
    bar:     ["ouverte", "repliee"],
    remember:[true, false],
    lang:    ["fr", "en"]
  };
  function prefsFiltrees(src){
    var r = {};
    if (!src || typeof src !== "object") return r;
    Object.keys(PREFS_OK).forEach(function(k){
      if (!Object.prototype.hasOwnProperty.call(src, k)) return;
      var v = src[k];
      if (k === "fps") v = Number(v);
      if (PREFS_OK[k].indexOf(v) >= 0) r[k] = v;
    });
    if (src.hint === true) r.hint = true;              // l'indice de la barre a ete montre
    return r;
  }
  function creerPrefs(storage, opts){
    var key = (opts && opts.key) || "rd-prefs", mem = null;
    function get(){
      if (mem) return prefsFiltrees(mem);
      var j = json(lire(storage, key));
      return j && j.v === 1 ? prefsFiltrees(j) : {};
    }
    return {
      get: get,
      // patch : { quality, fps, codec, bar, hint, remember, lang } ; null retire une valeur.
      // Rend vrai si l'ecriture a tenu (relue).
      set: function(patch){
        var cur = get(), p = patch || {};
        Object.keys(p).forEach(function(k){
          if (p[k] === null){ delete cur[k]; return; }
          var un = {}, f;
          un[k] = p[k];
          f = prefsFiltrees(un);
          if (Object.prototype.hasOwnProperty.call(f, k)) cur[k] = f[k];
        });
        var texte = JSON.stringify({ v: 1, quality: cur.quality, fps: cur.fps, codec: cur.codec,
                                     bar: cur.bar, hint: cur.hint, remember: cur.remember, lang: cur.lang });
        var ok = ecrire(storage, key, texte);
        mem = ok ? null : cur;
        return ok;
      },
      reset: function(){
        mem = null;
        try { storage.removeItem(key); } catch (e) { return false; }
        return true;
      }
    };
  }

  // ---------------------------------------------------- dernieres connexions
  // Des chiffres et des horodatages, rien d'autre : jamais d'hote, jamais de
  // mot de passe (« peers » les porte en clair, on n'y touche pas).
  function creerRecent(storage, opts){
    opts = opts || {};
    var key = opts.key || "rd-recent", max = opts.max || 10,
        maintenant = opts.now || function(){ return Date.now(); }, mem = null;

    // Un horodatage venu du stockage est borne a « maintenant + un jour » : « 9e99 »
    // se classerait sinon en tete pour toujours.
    function horodatage(v){
      var n = Number(v);
      if (!isFinite(n) || n < 0) return 0;
      return Math.min(n, maintenant() + 86400000);
    }
    function propre(liste){
      var vus = {}, r = [];
      (Array.isArray(liste) ? liste : []).forEach(function(e){
        var id = e && normId(e.id);
        if (!id || vus[id]) return;
        vus[id] = true;
        var o = { id: id, t: horodatage(e.t) }, n = nomPoste(e.n);
        if (n) o.n = n;                                 // le nom du poste, s'il est connu
        r.push(o);
      });
      r.sort(function(a, b){ return b.t - a.t; });      // tri stable : le plus recent d'abord
      return r.slice(0, max);
    }
    // null = la cle n'existe pas (jamais amorcee) ; [] = elle existe, vide.
    function charger(){
      if (mem) return propre(mem);
      var brut = lire(storage, key);
      if (brut === null) return null;
      var j = json(brut);
      return j && j.v === 1 ? propre(j.ids) : [];
    }
    function sauver(liste){
      var l = propre(liste), ok = ecrire(storage, key, JSON.stringify({ v: 1, ids: l }));
      mem = ok ? null : l;
      return ok;
    }
    return {
      list: function(){ return charger() || []; },
      // nom : le nom du poste annonce par le pair, facultatif. Sans lui, celui
      // deja connu pour cet ID est garde.
      add: function(id, nom){
        var n = normId(id);
        if (!n) return false;
        var tous = charger() || [], ancien = tous.filter(function(e){ return e.id === n; })[0];
        var l = tous.filter(function(e){ return e.id !== n; });
        l.unshift({ id: n, t: maintenant(), n: nomPoste(nom) || (ancien && ancien.n) || "" });
        return sauver(l);
      },
      remove: function(id){
        var n = normId(id);
        if (!n) return false;
        return sauver((charger() || []).filter(function(e){ return e.id !== n; }));
      },
      // On ecrit une liste VIDE plutot que de retirer la cle : la cle absente
      // declenche l'amorcage, et un historique efface reviendrait tout seul.
      clear: function(){ return sauver([]); },
      // Une seule fois, quand la cle n'existe pas encore : les IDs deja connus
      // du bundle (« peers », classes par « tm » — la derniere ecriture d'option,
      // pas la derniere connexion, donc approximatif) et le dernier ID saisi.
      // On ecrit meme si la liste est vide, pour qu'un retrait ne soit pas
      // annule au chargement suivant. Rend le nombre d'entrees amorcees.
      seedFrom: function(peersJson, dernierId, idDefaut){
        if (charger() !== null) return 0;
        var p = typeof peersJson === "string" ? json(peersJson) : peersJson, liste = [];
        if (p && typeof p === "object"){
          Object.keys(p).forEach(function(id){
            var n = normId(id), tm = p[id] && Number(p[id].tm);
            if (n && tm > 0) liste.push({ id: n, t: horodatage(tm) });
          });
        }
        var dernier = normId(dernierId), defaut = normId(idDefaut);
        if (dernier && dernier !== defaut){
          var t = liste.reduce(function(m, e){ return Math.max(m, e.t); }, 0);
          liste.push({ id: dernier, t: Math.max(t + 1, maintenant()) });
        }
        sauver(liste);
        return charger().length;
      }
    };
  }

  // ------------------------------------------------------------------ codecs
  // L'ordre est celui du mode « auto » du pair (scrap/common/codec.rs) :
  // h265 > h264 > av1 > vp9. H265 et H264 n'existent cote pair qu'avec un
  // encodeur materiel ; AV1 et VP9 y sont logiciels, donc toujours disponibles.
  // « prefer » est l'enumeration SupportedDecoding.PreferCodec du protocole.
  var CODEC_ORDRE = ["h265", "h264", "av1", "vp9"];
  var CODEC_PREFER = { vp9: 1, h264: 2, h265: 3, av1: 5 };
  // Niveaux volontairement hauts : un ecran Retina depasse les niveaux courants,
  // et certains navigateurs refusent une configuration au-dessous du flux reel.
  // H264 et H265 arrivent en Annex B : aucune « description » n'est fournie.
  var CODEC_CHAINES = {
    h265: "hev1.1.6.L153.b0",
    h264: "avc1.640033",
    av1:  "av01.0.13M.08",
    vp9:  "vp09.00.50.08"
  };
  var CODEC_CHAMPS = { h265: "h265s", h264: "h264s", av1: "av1s", vp9: "vp9s" };

  // Le meilleur codec que ce navigateur decode, hors ceux qui ont echoue sur
  // cette page. null : aucun, donc decodage logiciel.
  function codecMeilleur(caps, rates){
    for (var i = 0; i < CODEC_ORDRE.length; i++){
      var n = CODEC_ORDRE[i];
      if (caps && caps[n] && !(rates && rates[n])) return n;
    }
    return null;
  }
  // Ce que la page declare au pair. VP9 est TOUJOURS annonce : le pair le tient
  // pour acquis, et c'est le seul flux que le decodeur logiciel sait lire.
  //   codec  : celui que la page veut (null = logiciel)
  //   force  : vrai si l'utilisateur l'a choisi — on n'annonce alors que lui,
  //            sinon le pair pourrait en preferer un autre parmi ceux annonces.
  function codecCapacites(codec, force, caps, rates){
    if (!codec || !CODEC_PREFER[codec]) return { ability_h265: 0, ability_vp9: 1, prefer: 1 };
    function a(n){
      if (force) return n === codec ? 1 : 0;
      return (n === codec || (caps && caps[n] && !(rates && rates[n]))) ? 1 : 0;
    }
    return { ability_h265: a("h265"), ability_h264: a("h264"), ability_av1: a("av1"),
             ability_vp9: 1, prefer: CODEC_PREFER[codec] };
  }
  // Le flux que le pair emet REELLEMENT dans ce VideoFrame : il decide seul, et
  // ce n'est pas toujours le codec prefere (pas d'encodeur materiel chez lui,
  // autre session ouverte en parallele). { nom, lot } ou null.
  function codecFlux(vf){
    if (!vf) return null;
    for (var i = 0; i < CODEC_ORDRE.length; i++){
      var n = CODEC_ORDRE[i], lot = vf[CODEC_CHAMPS[n]];
      if (lot) return { nom: n, lot: lot };
    }
    return null;
  }

  // ---------------------------------------------------------------- molette
  // Le pair compte en CRANS. Un evenement « wheel » n'en est pas un : une
  // souris en emet un par cran (100 ou 120 px, ou 3 lignes), un trackpad une
  // soixantaine par seconde de quelques pixels chacun. Envoyer un cran par
  // evenement faisait defiler un trackpad dix fois trop vite. On cumule donc
  // les pixels et l'on n'emet un cran que tous les « pas » pixels.
  function creerMolette(pas){
    pas = pas > 0 ? pas : 100;
    var ax = 0, ay = 0;
    function axe(acc, d){
      if (!d) return [acc, 0];
      if (acc !== 0 && (acc > 0) !== (d > 0)) acc = 0;   // demi-tour : le reste ne compte plus
      acc += d;
      var n = acc > 0 ? Math.floor(acc / pas) : -Math.floor(-acc / pas);
      return [acc - n * pas, n];
    }
    function borne(n){ return n ? Math.max(-10, Math.min(10, -n)) : 0; }
    return {
      // mode : WheelEvent.deltaMode — 0 pixels, 1 lignes, 2 pages.
      // Rend { x, y } en crans, dans le sens du protocole : defiler vers le
      // bas (delta positif) est un cran NEGATIF.
      pousser: function(dx, dy, mode){
        var k = mode === 1 ? 40 : mode === 2 ? 800 : 1;
        var rx = axe(ax, (Number(dx) || 0) * k), ry = axe(ay, (Number(dy) || 0) * k);
        ax = rx[0]; ay = ry[0];
        return { x: borne(rx[1]), y: borne(ry[1]) };
      },
      raz: function(){ ax = 0; ay = 0; }
    };
  }

  // ---------------------------------------------------------------- tactile
  // Un doigt pilote la souris du poste distant, sans intermediaire :
  //   toucher bref            clic gauche a l'endroit touche
  //   toucher puis glisser    glisser-deposer (bouton gauche tenu)
  //   appui long immobile     clic droit
  //   deux doigts qui glissent  molette, dans le sens « naturel » (le contenu
  //                             suit les doigts)
  // La machine ne connait ni le DOM ni l'horloge : elle recoit des positions
  // et rend des actions { a: "move"|"down"|"up"|"clic-droit"|"wheel", … } en
  // coordonnees de fenetre. Le cablage arme le minuteur de l'appui long et
  // appelle long().
  function creerTactile(opts){
    var seuil = (opts && opts.glisse) || 10;
    var pts = {}, n = 0, etat = "repos", depart = null, centre0 = null;
    function centre(){
      var x = 0, y = 0, k = 0;
      for (var id in pts){ x += pts[id].x; y += pts[id].y; k++; }
      return k ? { x: x / k, y: y / k } : null;
    }
    return {
      etat: function(){ return etat; },
      down: function(id, x, y){
        if (pts[id]) return [];
        pts[id] = { x: x, y: y }; n++;
        if (n === 1){ etat = "un"; depart = { x: x, y: y }; return [{ a: "move", x: x, y: y }]; }
        if (n === 2){
          var out = etat === "glisse" ? [{ a: "up", x: depart.x, y: depart.y }] : [];
          etat = "deux"; centre0 = centre();
          return out;
        }
        return [];
      },
      move: function(id, x, y){
        if (!pts[id]) return [];
        pts[id] = { x: x, y: y };
        if (etat === "un"){
          if (Math.abs(x - depart.x) <= seuil && Math.abs(y - depart.y) <= seuil) return [];
          etat = "glisse";
          var d = depart; depart = { x: x, y: y };
          return [{ a: "down", x: d.x, y: d.y }, { a: "move", x: x, y: y }];
        }
        if (etat === "glisse"){ depart = { x: x, y: y }; return [{ a: "move", x: x, y: y }]; }
        if (etat === "deux"){
          var c = centre(), dx = c.x - centre0.x, dy = c.y - centre0.y;
          centre0 = c;
          return (dx || dy) ? [{ a: "wheel", dx: -dx, dy: -dy }] : [];
        }
        return [];
      },
      up: function(id){
        if (!pts[id]) return [];
        var p = pts[id]; delete pts[id]; n--;
        var avant = etat;
        etat = n === 0 ? "repos" : (avant === "deux" || avant === "fin") ? "fin" : avant;
        if (avant === "un")     return [{ a: "down", x: depart.x, y: depart.y }, { a: "up", x: depart.x, y: depart.y }];
        if (avant === "glisse") return [{ a: "up", x: p.x, y: p.y }];
        return [];
      },
      // L'appui long : seulement si le doigt n'a ni bouge ni ete rejoint.
      long: function(){
        if (etat !== "un") return [];
        etat = "long";
        return [{ a: "clic-droit", x: depart.x, y: depart.y }];
      },
      // Le navigateur reprend le geste (pointercancel) : on relache ce qui est tenu.
      cancel: function(){
        var out = etat === "glisse" ? [{ a: "up", x: depart.x, y: depart.y }] : [];
        pts = {}; n = 0; etat = "repos";
        return out;
      }
    };
  }

  // ------------------------------------------------------ retours du pair
  // BackNotification : la reponse du pair a « bloquer la saisie » et au mode
  // confidentialite. Le bundle la decode et n'en fait rien : l'option semblait
  // prise alors que le pair l'avait refusee. Valeurs de message.proto.
  //   { option, actif, ok, texte } ; option null si rien a en dire.
  var RETOURS_SAISIE = {
    2: [true,  true,  "Saisie locale bloquée sur le poste distant."],
    3: [false, false, "Le poste distant a refusé de bloquer la saisie."],
    4: [false, true,  "Saisie locale débloquée sur le poste distant."],
    5: [true,  false, "Le poste distant n'a pas pu débloquer la saisie."]
  };
  var RETOURS_CONFID = {
    2:  [false, false, "Mode confidentialité déjà pris par une autre session."],
    3:  [false, false, "Le poste distant ne propose pas le mode confidentialité."],
    4:  [true,  true,  "Mode confidentialité activé."],
    5:  [false, false, "Mode confidentialité refusé par le poste distant."],
    6:  [false, false, "Mode confidentialité indisponible (composant absent sur le poste distant)."],
    7:  [false, false, "Le mode confidentialité n'a pas pu être activé."],
    8:  [false, true,  "Mode confidentialité désactivé."],
    9:  [false, true,  "Mode confidentialité désactivé par le poste distant."],
    10: [true,  false, "Le mode confidentialité n'a pas pu être désactivé."],
    11: [false, true,  "Mode confidentialité désactivé."]
  };
  function retourPair(bn){
    var rien = { option: null };
    if (!bn || typeof bn !== "object") return rien;
    function lire(table, v, option){
      var t = Object.prototype.hasOwnProperty.call(table, v) ? table[v] : null;
      if (!t) return null;
      var d = typeof bn.details === "string" ? bn.details.trim().slice(0, 200) : "";
      return { option: option, actif: t[0], ok: t[1], texte: t[2], details: t[1] ? "" : d };
    }
    return (bn.block_input_state != null && lire(RETOURS_SAISIE, Number(bn.block_input_state), "block-input"))
        || (bn.privacy_mode_state != null && lire(RETOURS_CONFID, Number(bn.privacy_mode_state), "privacy-mode"))
        || rien;
  }
  // Le pair demande-t-il un code a usage unique ? (client.rs : REQUIRE_2FA,
  // LOGIN_MSG_2FA_WRONG.) "demande" | "faux" | null.
  function demande2fa(erreur){
    if (erreur === "2FA Required") return "demande";
    if (erreur === "Wrong 2FA Code") return "faux";
    return null;
  }
  // Un code TOTP : six chiffres, espaces de presentation toleres.
  function code2fa(s){
    var d = typeof s === "string" ? s.replace(/\s+/g, "") : "";
    return /^[0-9]{6}$/.test(d) ? d : null;
  }

  // ------------------------------------------------------------------ langue
  // Le francais est la langue d'ecriture : la CLE d'un texte est sa version
  // francaise, EN en donne la traduction. Un texte absent du dictionnaire
  // s'affiche en francais plutot que de disparaitre. {0}, {1}… sont remplaces
  // par les arguments suivants.
  var EN = {
    "Codec {0} indisponible ({1}) : retour en automatique.": "{0} codec unavailable ({1}): back to automatic.",
    "Presse-papier : opération impossible ({0}).": "Clipboard: operation failed ({0}).",
    "Déposer ce contenu dans le presse-papier de ce navigateur. Un clic est nécessaire : le navigateur n'écrit pas dans le presse-papier sans geste de ta part.": "Put this content on this browser's clipboard. A click is required: the browser does not write to the clipboard without a gesture from you.",
    "Image reçue ⇩": "Image received ⇩",
    "Texte reçu ⇩": "Text received ⇩",
    "reprise abandonnée — recharge la page": "reconnection abandoned — reload the page",
    "reconnexion {0}/6 dans {1} s": "reconnecting {0}/6 in {1} s",
    "reconnexion en cours…": "reconnecting…",
    "Image réduite de {0}×{1} à {2}×{3} pour tenir dans la limite d'envoi.": "Image reduced from {0}×{1} to {2}×{3} to fit the sending limit.",
    "Plafond de cadence. Le serveur décide la cadence réelle selon la latence ; ce réglage ne fait que la borner. Le baisser a un effet immédiat, le monter n'en a que si la liaison suit.": "Frame-rate cap. The server decides the actual rate from the measured latency; this setting only bounds it. Lowering it takes effect at once, raising it only helps if the link keeps up.",
    "{0} i/s max": "{0} fps max",
    "Ctrl brut": "Raw Ctrl",
    "Écran {0}": "Display {0}",
    "Couper le son distant": "Mute remote audio",
    "Suspendre le presse-papier": "Suspend clipboard",
    "Verrouiller en quittant": "Lock on exit",
    "Mode confidentialité": "Privacy mode",
    "Bloquer la saisie locale": "Block local input",
    "Action impossible : {0}": "Action failed: {0}",
    "Plein écran refusé par le navigateur ({0}).": "Full screen refused by the browser ({0}).",
    "Résolution": "Resolution",
    "(indisponible)": "(unavailable)",
    "aller-retour  p50/p95/p99   ": "round trip    p50/p95/p99   ",
    "décodage      p50/p95/p99   ": "decode        p50/p95/p99   ",
    "trames reçues {0}/s    débit cible {1} kbit/s    codec {2}": "frames received {0}/s    target bitrate {1} kbit/s    codec {2}",
    "logiciel": "software",
    "hbbr a refusé la clé. Envoyée par ce navigateur : {0}. ": "hbbr refused the key. Sent by this browser: {0}. ",
    "Aucune clé n'a été transmise : le bundle lit licence_key dans localStorage et omet le champ s'il est vide — hbbr rejette de la même façon qu'une clé fausse. Recharge la page pour la réécrire. ": "No key was sent: the bundle reads licence_key from localStorage and omits the field when it is empty — hbbr rejects that exactly like a wrong key. Reload the page to rewrite it. ",
    "Elle diffère de celle configurée dans cette page ({0}) : ton localStorage est périmé. Lance rdRelayReset() puis reconnecte-toi. ": "It differs from the one configured in this page ({0}): your localStorage is stale. Run rdRelayReset() and reconnect. ",
    "Elle est bien celle configurée dans cette page, donc c'est le SERVEUR qui n'applique pas cette clé. Cause n° 1 : hbbs et hbbr ne partagent pas leur répertoire de clés, et chacun a généré la sienne. Compare les deux : docker logs hbbs 2>&1 | grep 'Key:' et docker logs hbbr 2>&1 | grep 'Key:' ": "It is the one configured in this page, so it is the SERVER that does not apply this key. Cause no. 1: hbbs and hbbr do not share their key directory, and each generated its own. Compare the two: docker logs hbbs 2>&1 | grep 'Key:' and docker logs hbbr 2>&1 | grep 'Key:' ",
    "— rdRelayTest() en console rejoue le test en 3 s.": "— rdRelayTest() in the console replays the test in 3 s.",
    "Le poste distant n'a pas rejoint le relais dans les 30 s. Soit il est hors ligne ou ne pointe pas vers ce serveur, soit sa propre clé est fausse : hbbr l'a rejeté de son côté, et nous avons attendu un pair qui ne viendrait jamais. Vérifie la clé dans ses réglages réseau, et que le port 21117/tcp est ouvert.": "The remote machine did not join the relay within 30 s. Either it is offline or not pointed at this server, or its own key is wrong: hbbr rejected it on its side, and we waited for a peer that would never come. Check the key in its network settings, and that port 21117/tcp is open.",
    "déconnecté": "disconnected",
    "connexion…": "connecting…",
    "connecté": "connected",
    "session vidéo absente": "no video session",
    "aucune session en cours": "no session in progress",
    "délai dépassé à l'ouverture": "timed out while opening",
    "nom non confirmé": "name not confirmed",
    "terminé": "done",
    "rien à transférer": "nothing to transfer",
    "annulé": "cancelled",
    "o": "B",
    "Ko": "KB",
    "Mo": "MB",
    "Go": "GB",
    "To": "TB",
    "Nouveau dossier": "New folder",
    "Créé dans {0}": "Created in {0}",
    "nouveau dossier": "new folder",
    "Taper le nom du dossier pour confirmer : {0}": "Type the folder name to confirm: {0}",
    "Échec d'authentification par clé (invalid key)": "Key authentication failed (invalid key)",
    "Échec de connexion au poste distant (Timeout)": "Could not reach the remote machine (Timeout)",
    "Session": "Session",
    "Image déposée dans le presse-papier local.": "Image placed on the local clipboard.",
    "Texte déposé dans le presse-papier local.": "Text placed on the local clipboard.",
    "Code refusé": "Code refused",
    "Vérification en deux étapes": "Two-step verification",
    "Code à 6 chiffres de l'application d'authentification du poste distant.": "6-digit code from the remote machine's authenticator app.",
    "Valider": "Confirm",
    "Utiliser cet ID (Suppr ou Retour arrière pour le retirer de la liste)": "Use this ID (Delete or Backspace removes it from the list)",
    "Retirer de la liste": "Remove from the list",
    "Effacer": "Clear",
    "Effacer toute la liste": "Clear the whole list",
    "Dernières connexions": "Recent connections",
    "Réglages de la session (résolution, qualité, fichiers…) : clique sur ⚙ en haut à droite.": "Session settings (resolution, quality, files…): click ⚙ at the top right.",
    "Ce contenu du presse-papier n'est ni du texte ni une image : rien à coller.": "This clipboard content is neither text nor an image: nothing to paste.",
    "Texte trop volumineux pour le presse-papier distant (limite : 1 Mio).": "Text too large for the remote clipboard (limit: 1 MiB).",
    "Le poste distant est trop ancien pour du texte enrichi, et aucun texte brut n'accompagne ce contenu.": "The remote machine is too old for rich text, and no plain text accompanies this content.",
    "Résolution de l'écran distant": "Remote display resolution",
    "Ajuster": "Fit",
    "Choisir la résolution la plus proche de la fenêtre": "Pick the resolution closest to the window",
    "Qualité d'image": "Image quality",
    "Équilibre": "Balanced",
    "Qualité": "Quality",
    "Fluidité": "Smoothness",
    "Codec vidéo": "Video codec",
    "Codec auto": "Auto codec",
    "Logiciel": "Software",
    "Ctrl est converti en Cmd (copier/coller macOS). Cliquer pour le mode terminal.": "Ctrl is converted to Cmd (macOS copy/paste). Click for terminal mode.",
    "Ctrl est transmis tel quel (Ctrl+C = SIGINT). Cliquer pour le mode macOS.": "Ctrl is sent as is (Ctrl+C = SIGINT). Click for macOS mode.",
    "Écran du poste distant à afficher": "Remote display to show",
    "Actions sur le poste distant": "Actions on the remote machine",
    "Actions": "Actions",
    "Ctrl+Alt+Suppr": "Ctrl+Alt+Del",
    "Verrouiller la session": "Lock the session",
    "Redémarrer le poste…": "Restart the machine…",
    "Redémarrer le poste distant ?": "Restart the remote machine?",
    "La session sera coupée.": "The session will be dropped.",
    "Redémarrer": "Restart",
    "Redémarrage demandé au poste distant.": "Restart requested from the remote machine.",
    "Saisie pour le poste distant": "Input for the remote machine",
    "Clavier": "Keyboard",
    "Afficher le clavier de l'appareil": "Show the device keyboard",
    "Fenêtre": "Window",
    "Plein écran": "Full screen",
    "Quitter le plein écran": "Exit full screen",
    "Plein écran : les raccourcis clavier partent au poste distant": "Full screen: keyboard shortcuts go to the remote machine",
    "Plein écran : les raccourcis partent au poste distant. Maintenir Échap pour sortir.": "Full screen: shortcuts go to the remote machine. Hold Esc to exit.",
    "Quitter": "Quit",
    "Afficher les réglages de la session": "Show session settings",
    "Replier les réglages": "Collapse settings",
    "aucune clé envoyée": "no key sent",
    "Fichiers distants": "Remote files",
    "Fermer le panneau": "Close the panel",
    "Dossier parent": "Parent folder",
    "Rafraîchir": "Refresh",
    "Téléverser": "Upload",
    "Envoyer des fichiers ou un dossier vers ce répertoire": "Send files or a folder to this directory",
    "+ Dossier": "+ Folder",
    "Déposer ici pour téléverser dans ce dossier": "Drop here to upload into this folder",
    "Que téléverser ?": "Upload what?",
    "Le sélecteur du navigateur ne peut pas proposer les deux à la fois.": "The browser picker cannot offer both at once.",
    "Des fichiers": "Files",
    "Un dossier": "A folder",
    "Dossier vide": "Empty folder",
    "Ouvrir": "Open",
    "Télécharger": "Download",
    "Télécharger le dossier": "Download the folder",
    "Renommer": "Rename",
    "Supprimer": "Delete",
    "Annuler": "Cancel",
    "Glisser vers le bureau (Chromium), ou cliquer pour retélécharger": "Drag to the desktop (Chromium), or click to download again",
    "Confirmer": "Confirm",
    "Supprimer le dossier": "Delete the folder",
    "Supprimer le fichier": "Delete the file",
    "Le dossier ET tout son contenu seront effacés sur le poste distant. Il n'y a pas de corbeille : c'est irréversible.": "The folder AND everything in it will be erased on the remote machine. There is no trash: this cannot be undone.",
    "Le fichier sera effacé sur le poste distant. Il n'y a pas de corbeille : c'est irréversible.": "The file will be erased on the remote machine. There is no trash: this cannot be undone.",
    "Confirmer la suppression": "Confirm deletion",
    "Supprimer définitivement": "Delete permanently",
    "Fichiers": "Files",
    "Parcourir, téléverser et télécharger sur le poste distant": "Browse, upload and download on the remote machine",
    "Décompression de l'image impossible (données corrompues ou trop volumineuses).": "Could not decompress the image (corrupt or too large).",
    "Image trop volumineuse pour être traitée.": "Image too large to process.",
    "Image reçue incomplète.": "Received image is incomplete.",
    "Dimensions d'image invalides.": "Invalid image dimensions.",
    "Conversion de l'image impossible.": "Could not convert the image.",
    "Image trop grande pour le presse-papier distant, même réduite.": "Image too large for the remote clipboard, even reduced.",
    "Le poste distant (RustDesk antérieur à 1.3.0) ne sait pas recevoir une image par le presse-papier.": "The remote machine (RustDesk older than 1.3.0) cannot receive an image through the clipboard.",
    "Envoi impossible : la session n'est pas prête.": "Cannot send: the session is not ready.",
    "Format d'image non pris en charge par ce navigateur.": "Image format not supported by this browser.",
    "Le navigateur a refusé d'écrire dans le presse-papier.": "The browser refused to write to the clipboard.",
    "Saisie locale bloquée sur le poste distant.": "Local input blocked on the remote machine.",
    "Le poste distant a refusé de bloquer la saisie.": "The remote machine refused to block input.",
    "Saisie locale débloquée sur le poste distant.": "Local input unblocked on the remote machine.",
    "Le poste distant n'a pas pu débloquer la saisie.": "The remote machine could not unblock input.",
    "Mode confidentialité déjà pris par une autre session.": "Privacy mode is already held by another session.",
    "Le poste distant ne propose pas le mode confidentialité.": "The remote machine does not offer privacy mode.",
    "Mode confidentialité activé.": "Privacy mode on.",
    "Mode confidentialité refusé par le poste distant.": "Privacy mode refused by the remote machine.",
    "Mode confidentialité indisponible (composant absent sur le poste distant).": "Privacy mode unavailable (component missing on the remote machine).",
    "Le mode confidentialité n'a pas pu être activé.": "Privacy mode could not be turned on.",
    "Mode confidentialité désactivé.": "Privacy mode off.",
    "Mode confidentialité désactivé par le poste distant.": "Privacy mode turned off by the remote machine.",
    "Le mode confidentialité n'a pas pu être désactivé.": "Privacy mode could not be turned off.",
    "Connexion…": "Connecting…",
    "Authentification…": "Logging in…",
    "Connecté, en attente de l'image…": "Connected, waiting for image…",
    "Cet ID n'existe pas.": "This ID does not exist.",
    "Le poste distant est hors ligne.": "The remote machine is offline.",
    "La clé du serveur ne correspond pas.": "Server key mismatch.",
    "Clé du serveur trop sollicitée.": "Server key overused.",
    "Le poste distant n'a pas d'écran.": "The remote machine has no display.",
    "Mot de passe incorrect.": "Wrong password.",
    "Mot de passe vide.": "Empty password.",
    "Ce poste n'accepte pas la connexion par mot de passe.": "This machine does not accept password access.",
    "Code de vérification requis.": "Verification code required.",
    "Code de vérification refusé.": "Verification code refused.",
    "Connexion à un poste distant": "Connect to a remote machine",
    "ID du poste": "Machine ID",
    "Connexion": "Connect",
    "Mots de passe mémorisés effacés ({0}).": "Remembered passwords erased ({0}).",
    "Les mots de passe ne seront plus mémorisés.": "Passwords will no longer be remembered.",
    "Mémoriser les mots de passe sur cet appareil": "Remember passwords on this device",
    "Serveur": "Server",
    "Langue de l'interface": "Interface language",
    "Mot de passe du poste distant": "Remote machine password",
    "Mot de passe": "Password"
  };
  function creerI18n(langue){
    var en = langue === "en";
    return function(cle){
      var a = arguments;
      var t = (en && Object.prototype.hasOwnProperty.call(EN, cle)) ? EN[cle] : cle;
      return String(t).replace(/\{(\d)\}/g, function(_, i){ var v = a[+i + 1]; return v == null ? "" : String(v); });
    };
  }
  // Le choix memorise l'emporte ; sinon la langue du navigateur — francais si
  // elle commence par « fr », anglais pour toute autre, francais si inconnue.
  function langueDe(pref, nav){
    if (pref === "fr" || pref === "en") return pref;
    if (typeof nav !== "string" || !nav) return "fr";
    return nav.toLowerCase().indexOf("fr") === 0 ? "fr" : "en";
  }
  // Ce que le bundle affiche en anglais dans l'ecran d'attente, vers la cle
  // francaise correspondante.
  var STATUTS = {
    "Connecting ...": "Connexion…",
    "Logging in...": "Authentification…",
    "Connected, waiting for image...": "Connecté, en attente de l'image…",
    "ID does not exist": "Cet ID n'existe pas.",
    "Remote desktop is offline": "Le poste distant est hors ligne.",
    "Key mismatch": "La clé du serveur ne correspond pas.",
    "Key overuse": "Clé du serveur trop sollicitée.",
    "No Display": "Le poste distant n'a pas d'écran.",
    "Wrong Password": "Mot de passe incorrect.",
    "Do you want to enter again?": "Mot de passe incorrect.",
    "Offline": "Le poste distant est hors ligne.",
    "Empty Password": "Mot de passe vide.",
    "No Password Access": "Ce poste n'accepte pas la connexion par mot de passe.",
    "2FA Required": "Code de vérification requis.",
    "Wrong 2FA Code": "Code de vérification refusé."
  };

  window.RDLib = {
    v: 1,
    i18n: { creer: creerI18n, langue: langueDe, EN: EN, STATUTS: STATUTS },
    codec: { ORDRE: CODEC_ORDRE, PREFER: CODEC_PREFER, CHAINES: CODEC_CHAINES,
             meilleur: codecMeilleur, capacites: codecCapacites, flux: codecFlux },
    pair:  { retour: retourPair, demande2fa: demande2fa, code2fa: code2fa },
    molette: { creer: creerMolette },
    tactile: { creer: creerTactile },
    isPeerId: isPeerId, normId: normId, fmtId: fmtId, nomPoste: nomPoste,
    messages: messages,
    clip: {
      FMT: FMT, LIM: LIM, ERR: ERR, ClipError: ClipError,
      select: select, zstdContentSize: zstdContentSize, decompress: decompress,
      sortieVideSuspecte: sortieVideSuspecte, estPng: estPng, reduirePixels: reduirePixels,
      rgbaPixels: rgbaPixels, describe: describe, slots: slots,
      precheck: precheck, nextScale: nextScale, pasteDelayMs: pasteDelayMs,
      peerSupportsMulti: peerSupportsMulti, isPasteChord: isPasteChord, pasteAccepte: pasteAccepte
    },
    prefs:  { create: creerPrefs, OK: PREFS_OK },
    recent: { create: creerRecent }
  };
})();
