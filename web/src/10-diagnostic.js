// Traduction, pour tous les blocs : window.__rdT est pose par le bloc de
// session une fois la langue connue. Avant cela — et si ce bloc manquait — le
// texte francais, qui est la cle, s'affiche tel quel.
function T(){ return window.__rdT ? window.__rdT.apply(null, arguments) : arguments[0]; }

// Chemin de rendu Flutter : inutilise ici, le client autonome dessine via
// YUVCanvas. Le stub evite que chaque trame leve une ReferenceError.
window.onRgba = function(){};

// Le navigateur cree tout AudioContext en etat "suspended" tant qu'il n'y a
// pas eu de geste utilisateur. On les recense pour les reveiller au 1er clic.
window.__audioCtxs = [];
(function(){
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  function Wrapped(opts){
    var c = new AC(opts);
    window.__audioCtxs.push(c);
    console.log("[audio] contexte cree (" + c.state + ", " + c.sampleRate + " Hz)");
    return c;
  }
  Wrapped.prototype = AC.prototype;
  window.AudioContext = Wrapped;
  window.webkitAudioContext = Wrapped;
  function reveiller(){
    window.__audioCtxs.forEach(function(c){
      if (c.state !== "running") c.resume().then(function(){
        console.log("[audio] contexte relance -> " + c.state);
      }).catch(function(e){ console.warn("[audio]", e); });
    });
  }
  ["click","keydown","touchstart"].forEach(function(ev){
    document.addEventListener(ev, reveiller, true);
  });
})();

// Un service worker de l'epoque Flutter reste enregistre dans les navigateurs
// qui ont visite les versions precedentes. Il reclame des fichiers supprimes
// et peut servir une version en cache de la page et du bundle, ce qui produit
// des comportements incoherents entre rechargements. On le retire.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(rs){
    rs.forEach(function(r){
      r.unregister().then(function(ok){
        if (ok) console.log("[sw] service worker obsolete retire — recharge une fois");
      });
    });
  }).catch(function(){});
  if (window.caches && caches.keys) {
    caches.keys().then(function(ks){
      ks.forEach(function(k){ caches.delete(k).then(function(ok){
        if (ok) console.log("[sw] cache « " + k + " » purge"); }); });
    }).catch(function(){});
  }
}

// Diagnostic des coupures. Le Mac sonde toutes les secondes et abandonne apres
// 30 s de silence : un « Timeout » signifie donc que CE navigateur s'est tu.
// On trace ce qui peut le faire taire — gel de l'onglet, veille, perte reseau —
// et le code de fermeture du websocket, qui distingue une fermeture propre
// (1000/1001) d'une disparition brutale de la connexion (1006).
(function(){
  var dernier = Date.now();
  window.__rdVu = function(){ dernier = Date.now(); };

  function tracer(ev){
    var s = Math.round((Date.now() - dernier)/1000);
    console.warn("[diag] " + ev + " — " + s + " s depuis le dernier message recu"
               + " | onglet " + document.visibilityState);
  }
  ["freeze","resume","pagehide","pageshow"].forEach(function(e){
    document.addEventListener(e, function(){ tracer(e); }, true);
  });
  document.addEventListener("visibilitychange", function(){
    tracer("visibilite -> " + document.visibilityState);
  });
  window.addEventListener("offline", function(){ tracer("reseau perdu"); });
  window.addEventListener("online",  function(){ tracer("reseau retrouve"); });

  // ----------------------------------------------- battement de diagnostic
  // Le tarissement du flux en onglet cache EST explique, et corrige : le bundle
  // lisait ses messages par setTimeout, que le navigateur ralentit dans un
  // onglet cache — la page ne repondait plus, le poste distant coupait apres
  // 30 s (voir RDLib.liaison et liaisonReactive). Ce releve reste : il separe
  // les causes qui subsistent, quand une coupure survient quand meme :
  //   veille systeme ou onglet gele -> un battement tarde de plusieurs minutes
  //   reseau perdu                  -> navigator.onLine passe a faux
  //   emetteur distant tari         -> le silence croit, tout le reste tient
  // Le journal vit en memoire — rien dans la console tant que rien n'est
  // anormal — et se relit par rdTrace() une fois revenu sur l'onglet.
  var PAS = 2000, battuA = Date.now(), journal = [];
  function etatWs(){
    try{
      var k = window.curConn;
      return (k && k._ws && k._ws._websocket) ? k._ws._websocket.readyState : -1;
    }catch(_){ return -1; }
  }
  setInterval(function(){
    var now = Date.now();
    var retard = Math.round((now - battuA - PAS)/1000);   // 0 quand tout va bien
    battuA = now;
    journal.push({
      heure:   new Date(now).toTimeString().slice(0,8),
      retard:  retard,                          // secondes de plus que prevu
      onglet:  document.visibilityState.charAt(0),   // v(isible) ou h(idden)
      ligne:   navigator.onLine ? 1 : 0,
      silence: Math.round((now - dernier)/1000),
      ws:      etatWs(),                        // 1 = ouvert
      trames:  (window.RD && window.RD.stats) ? window.RD.stats.frames : -1,
      // Un onglet cache voit son decodeur materiel ralenti par le navigateur :
      // si la file enfle pendant que « trames » stagne, l'engorgement est ici,
      // et non sur la liaison.
      file:    (window.RD && window.RD.dec && window.RD.dec.state !== "closed")
                 ? window.RD.dec.decodeQueueSize : -1
    });
    if (journal.length > 500) journal.shift();
    // Un onglet cache est ralenti par le navigateur : quelques secondes de
    // retard sont attendues, et restent muettes. Au-dela de deux minutes ce
    // n'est plus du ralentissement mais une interruption — on la nomme.
    if (retard > 120)
      console.warn("[battement] le temps a saute de " + retard
                 + " s (veille de la machine ou onglet gele) | onglet "
                 + document.visibilityState);
  }, PAS);

  // Relit le battement. La derniere ligne portant « ws:1 » situe la mort de la
  // liaison ; « retard » dit si le navigateur tournait encore a ce moment-la,
  // et « silence » depuis combien de temps plus rien n'arrivait.
  window.rdTrace = function(n){
    var l = journal.slice(-(n || 60));
    console.group("Battement — " + l.length + " releves sur " + journal.length + " gardes");
    console.table(l);
    console.groupEnd();
    return l.length;
  };

  function resumeCle(k){
    if (!k) return T("aucune clé envoyée");
    if (k.length <= 16) return k + " (" + k.length + " car.)";
    return k.slice(0, 8) + "…" + k.slice(-6) + " (" + k.length + " car.)";
  }

  function messageCleRefusee(){
    var envoyee = "";
    try { envoyee = localStorage.getItem("key") || ""; } catch(e){}
    var attendue = window.__rdCleConfig || "";
    var m = T("hbbr a refusé la clé. Envoyée par ce navigateur : {0}. ", resumeCle(envoyee));
    if (!envoyee) {
      m += T("Aucune clé n'a été transmise : le bundle lit licence_key dans localStorage et omet le champ s'il est vide — hbbr rejette de la même façon qu'une clé fausse. Recharge la page pour la réécrire. ");
    } else if (attendue && envoyee !== attendue) {
      m += T("Elle diffère de celle configurée dans cette page ({0}) : ton localStorage est périmé. Lance rdRelayReset() puis reconnecte-toi. ", resumeCle(attendue));
    } else {
      m += T("Elle est bien celle configurée dans cette page, donc c'est le SERVEUR qui n'applique pas cette clé. Cause n° 1 : hbbs et hbbr ne partagent pas leur répertoire de clés, et chacun a généré la sienne. Compare les deux : docker logs hbbs 2>&1 | grep 'Key:' et docker logs hbbr 2>&1 | grep 'Key:' ");
    }
    m += T("— rdRelayTest() en console rejoue le test en 3 s.");
    return m;
  }

  function showBannerError(msg, type){
    var el = document.getElementById("rderror");
    if (!el) {
      el = document.createElement("div");
      el.id = "rderror";
      el.style.cssText = "position:fixed;top:1.2rem;left:50%;transform:translateX(-50%);z-index:99999;padding:1rem 1.5rem;border-radius:8px;background:#2a1215;border:1px solid #991b1b;color:#f87171;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:0.9rem;max-width:90vw;box-shadow:0 10px 30px rgba(0,0,0,0.6);display:flex;align-items:center;gap:0.75rem;";
      document.body.appendChild(el);
    }
    var title = type === "key" ? T("Échec d'authentification par clé (invalid key)") : T("Échec de connexion au poste distant (Timeout)");
    el.innerHTML = '<span style="font-size:1.5rem">⚠️</span> <div><strong style="color:#fee2e2">' + title + '</strong><br><span style="font-size:0.85rem;color:#fca5a5">' + msg + '</span></div><button onclick="this.parentElement.remove()" style="background:transparent;border:0;color:#fca5a5;font-size:1.2rem;cursor:pointer;margin-left:auto;padding:0 0.4rem">✕</button>';
  }

  // Le constructeur WebSocket est enveloppe pour tracer les fermetures et la
  // progression des poignées de main WebSockets.
  var W = window.WebSocket;
  var sockets = [];
  function Trace(url, proto){
    var ws = proto === undefined ? new W(url) : new W(url, proto);
    var path = String(url).replace(/^wss?:\/\/[^/]+/, "");
    var wsStartTime = Date.now();
    // L'epoque de session a l'ouverture de CETTE liaison. Une liaison plus
    // ancienne — celle de la connexion « fichiers » d'une session deja finie —
    // peut se fermer apres qu'un connect() a remis RD.ready a faux : sans cette
    // comparaison, sa fermeture passait pour un echec d'etablissement de la
    // nouvelle session (bannieres « cle refusee » / « pair absent », reprise
    // parasite).
    var epoque = window.RD ? window.RD.epoque : 0;
    console.log("[diag] websocket ouverture -> " + path);
    // Borne : une session longue enchaine les reconnexions, et chaque entree
    // retient une reference vers le WebSocket ferme.
    sockets.push({ url: url, path: path, ws: ws, created: wsStartTime });
    while (sockets.length > 10) sockets.shift();

    ws.addEventListener("open", function(){
      console.log("[diag] websocket connecte -> " + path);
    });

    var msgCount = 0;
    ws.addEventListener("message", function(e){
      dernier = Date.now();
      msgCount++;
      if (msgCount === 1) {
        console.log("[diag] premier message recu -> " + path);
      }
    });

    ws.addEventListener("close", function(e){
      var s = Math.round((Date.now() - dernier)/1000);
      var dur = Math.round((Date.now() - wsStartTime)/1000);
      console.warn("[diag] websocket ferme  code=" + e.code
                 + "  propre=" + e.wasClean
                 + "  raison=\"" + (e.reason || "") + "\""
                 + "  silence=" + s + " s"
                 + "  onglet=" + document.visibilityState
                 + "  " + path);

      // hbbr ne repond jamais au client sur ces deux echecs : il se contente de
      // fermer. Seule la duree de vie de la liaison les distingue, et elle
      // suffit, car les deux chemins sont explicites dans relay_server.rs :
      //   licence_key invalide  -> « return » immediat, fermeture en < 1 s
      //   pair jamais arrive    -> sleep(30) puis retrait, fermeture vers 30 s
      // On se base sur la duree de vie de CETTE liaison, pas sur le silence
      // global : « dernier » est partage entre toutes les liaisons ouvertes.
      var courante = !window.RD || window.RD.epoque === epoque;
      if (courante && path.indexOf("/ws/relay") !== -1 && window.RD && !window.RD.ready) {
        if (dur <= 5) {
          showBannerError(messageCleRefusee(), "key");
        } else if (dur >= 20) {
          // L'autre jambe du relais. Une cle fausse cote POSTE ne tombe pas en
          // moins d'une seconde : elle nous laisse attendre le pair pendant les
          // 30 s de hbbr. Les deux pannes se ressemblent a l'ecran.
          showBannerError(T("Le poste distant n'a pas rejoint le relais dans les 30 s. Soit il est hors ligne ou ne pointe pas vers ce serveur, soit sa propre clé est fausse : hbbr l'a rejeté de son côté, et nous avons attendu un pair qui ne viendrait jamais. Vérifie la clé dans ses réglages réseau, et que le port 21117/tcp est ouvert."), "timeout");
        }
      }

      // Fin de la liaison de session. L'attendre par sondage la rendait
      // tributaire des minuteurs, que le navigateur ralentit a un passage par
      // minute dans un onglet cache : la session restait morte jusqu'au retour
      // de l'utilisateur. La fermeture est un evenement — on s'en sert.
      // repriseplanifier() vit dans un autre bloc <script>, d'ou le passage
      // par window ; elle est idempotente, le veilleur peut la rappeler.
      //
      // Le critere est « cette liaison a-t-elle recu quelque chose », et non
      // l'etat « __rdEtait » du veilleur : celui-ci est justement pose par le
      // sondage que l'on contourne, et il reste faux quand la session meurt
      // avant le tour suivant — mesure le 2026-08-20, deux reprises perdues
      // puis 55 minutes de silence. Un relais qui n'a jamais rien recu est un
      // echec d'etablissement (cle refusee, pair absent) : la banniere s'en
      // charge, une reprise n'y changerait rien.
      if (courante && path.indexOf("/ws/relay") !== -1 && msgCount > 0 && window.__rdReprise) {
        window.__rdReprise();
      }
    });
    return ws;
  }
  Trace.prototype = W.prototype;
  ["CONNECTING","OPEN","CLOSING","CLOSED"].forEach(function(k,i){ Trace[k] = i; });
  window.WebSocket = Trace;

  // La meme sonde que scripts/relay-probe.py, rejouee depuis le navigateur.
  // Le script teste le SERVEUR ; celle-ci est le seul verdict qui prouve ce que
  // CE navigateur-la envoie reellement — localStorage compris.
  //
  // hbbr n'a que deux comportements, separes par deux ordres de grandeur :
  //   cle refusee  -> relay_server.rs fait « return » sans repondre, la liaison
  //                   tombe en quelques dizaines de ms ;
  //   cle acceptee -> le flux est range dans PEERS et hbbr dort 30 s en
  //                   attendant le pair, donc la liaison reste ouverte.
  // La cle temoin, volontairement fausse, valide la sonde elle-meme : si elle
  // passe aussi, ce n'est pas hbbr qui repond, ou il tourne sans -k _.
  function trameRelay(uuid, cle){
    var enc = new TextEncoder();
    function champ(tag, valeur){                 // tags releves dans le bundle :
      var b = enc.encode(valeur);                // uuid = 2, licence_key = 6
      var t = tag < 128 ? [tag] : [tag & 127 | 128, tag >> 7];
      return t.concat([b.length], Array.prototype.slice.call(b));
    }
    var interne = champ(18, uuid).concat(champ(50, cle));
    return new Uint8Array([0x92, 0x01, interne.length].concat(interne));
  }

  window.rdRelayTest = function(cleForcee){
    var envoyee = cleForcee;
    if (envoyee === undefined){ try{ envoyee = localStorage.getItem("key") || ""; }catch(e){ envoyee = ""; } }
    var essais = [["clé de ce navigateur", envoyee],
                  ["clé témoin (fausse)", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="],
                  ["clé vide", ""]];
    function une(nom, k){
      return new Promise(function(res){
        var t0 = Date.now(), fini = false;
        // W est le constructeur d'origine : passer par le WebSocket instrumente
        // ferait surgir la banniere de diagnostic pendant le test lui-meme.
        var ws = new W((location.protocol === "https:" ? "wss://" : "ws://")
                       + location.host + "/ws/relay");
        ws.binaryType = "arraybuffer";
        function fin(v){
          if (fini) return; fini = true;
          try{ ws.close(); }catch(e){}
          res({ essai: nom, verdict: v, ms: Date.now() - t0 });
        }
        ws.onopen  = function(){ ws.send(trameRelay("00000000-0000-4000-8000-0000000000ff", k)); };
        ws.onclose = function(){ fin("REFUSEE"); };
        ws.onerror = function(){ fin("INTESTABLE"); };
        setTimeout(function(){ fin("ACCEPTEE"); }, 3000);
      });
    }
    return essais.reduce(function(chaine, e){
      return chaine.then(function(acc){
        return une(e[0], e[1]).then(function(r){ acc.push(r); return acc; });
      });
    }, Promise.resolve([])).then(function(r){
      console.table(r);
      var conf = r[0].verdict, temoin = r[1].verdict;
      if (conf === "ACCEPTEE" && temoin === "REFUSEE")
        console.log("%c✓ hbbr accepte la clé de ce navigateur. Si une session échoue "
                    + "encore, ce n'est pas la clé.", "color:#4ade80");
      else if (temoin === "ACCEPTEE")
        console.warn("⚠ hbbr accepte AUSSI une clé fausse : il tourne sans -k _, "
                     + "donc en relais ouvert à Internet.");
      else if (conf === "REFUSEE")
        console.warn("✗ hbbr REFUSE la clé de ce navigateur (" + resumeCle(envoyee) + "). "
                     + (envoyee && envoyee !== (window.__rdCleConfig || "")
                        ? "Elle diffère de celle de la page : rdRelayReset()."
                        : "Compare les clés de hbbs et de hbbr côté serveur."));
      else
        console.warn("⚠ intestable : la liaison n'a pas atteint hbbr. Vérifie que "
                     + "/ws/relay est proxifié et que hbbr écoute sur 21119.");
      return r;
    });
  };

  // Un localStorage perime survit aux rechargements et se voit nulle part :
  // il suffit d'avoir ouvert la page une fois avant un changement de cle.
  window.rdRelayReset = function(){
    try {
      localStorage.setItem("key", window.__rdCleConfig || "");
      localStorage.setItem("custom-rendezvous-server", window.__rdHoteConfig || "");
      localStorage.setItem("rendezvous-server", window.__rdHoteConfig || "");
      console.log("Clé et hôte réécrits depuis la page. Rechargement…");
      setTimeout(function(){ location.reload(); }, 400);
    } catch(e){ console.warn("localStorage inaccessible", e); }
  };

  window.rdDiag = function(){
    console.group("=== DIAGNOSTIC RUSTDESK WEB ===");
    console.log("Hôte configuré :", localStorage.getItem("custom-rendezvous-server") || "(non défini)");
    var k = localStorage.getItem("key") || "";
    console.log("Clé publique :", k ? (k.substring(0, 12) + "..." + k.substring(k.length - 6) + " (longueur " + k.length + ")") : "(vide)");
    console.log("ID cible :", localStorage.getItem("id") || "(vide)");
    console.log("Codecs retenus :", window.RD ? window.RD.codec : "non initialisé");
    if (window.RD){
      var S = window.RD.stats, dt = (Date.now() - (S.movesT0 || Date.now())) / 1000;
      console.log("Souris — evenements coalesces :", window.RD.coalesce ? "actives" : "desactives",
                  "| messages envoyes :", S.moves,
                  dt > 1 ? "(" + (S.moves / dt).toFixed(1) + "/s)" : "");
    }
    console.log("Sockets récents :", sockets.map(function(s){
      var st = ["CONNECTING","OPEN","CLOSING","CLOSED"][s.ws.readyState] || s.ws.readyState;
      return s.path + " [" + st + "] ouvert depuis " + Math.round((Date.now() - s.created)/1000) + " s";
    }));
    console.groupEnd();
  };

  // Retire : un module dit « TimeWarp » appliquait ici un translate3d de +/-10 px
  // sur #canvas pendant les glissements. #canvas est le CONTENEUR, et pos() derive
  // les coordonnees de getBoundingClientRect(), qui inclut les transformations CSS :
  // le pointeur distant partait donc decale d'autant, precisement pendant les
  // gestes ou la precision compte. Aucune reprojection n'etait faite non plus,
  // l'image etait seulement secouee puis remise a zero au bout de 35 ms.
})();

// Etat partage entre les deux blocs de script.
window.RD = {
  ready:false,        // vrai apres peer_info : rien ne doit partir avant
  epoque:0,           // +1 a chaque connect() : une liaison n'est « de la session » que si elle est nee dans l'epoque courante
  res:[],             // modes supportes par l'ecran distant
  orig:null,          // resolution d'origine
  codec:null,         // "h265" | "h264" | "av1" | "vp9" | null (= logiciel ogv)
  caps:{},            // ce que WebCodecs decode dans CE navigateur, par codec
  rates:{},           // codecs qui ont echoue sur cette page : plus proposes
  displays:[],        // ecrans du poste distant (peer_info)
  display:0,          // celui qui est affiche
  forced:"auto",      // choix utilisateur dans la barre
  dec:null,           // VideoDecoder unique, reutilise entre connexions
  wantKey:true,       // garde image-cle : jeter les deltas avant la 1ere cle
  errors:0,           // echecs consecutifs avant repli
  lastPurge:0,        // horodatage de la derniere purge de file de decodage
  sawAnnexB:false,
  W:0, H:0,           // dimensions de l'ecran distant
  cursors:{},         // cache des curseurs distants, par id
  cursorN:0,
  // Evenements pointeur coalesces : plus fideles, mais ils multiplient le debit
  // sortant. Desactives par defaut, cf. rdCoalesce().
  coalesce: (function(){ try{ return localStorage.getItem("rd-coalesce") === "1"; }catch(e){ return false; } })(),
  // Une latence se lit en distribution, pas en moyenne : c'est la queue qui
  // rend une session desagreable. On garde des fenetres glissantes.
  stats:{ delay:[], decode:[], bitrate:0, frames:0, pend:[], moves:0, movesT0:0 }
};

// Bascule les evenements pointeur coalesces et rend la comparaison mesurable :
// rdCoalesce(false) puis un glissement, rdDiag(), rdCoalesce(true), on refait.
window.rdCoalesce = function(on){
  window.RD.coalesce = !!on;
  try{ localStorage.setItem("rd-coalesce", on ? "1" : "0"); }catch(e){}
  window.RD.stats.moves = 0; window.RD.stats.movesT0 = Date.now();
  console.log("[souris] evenements coalesces " + (on ? "actives" : "desactives")
            + " — compteur remis a zero");
  return window.RD.coalesce;
};

// Le bundle journalise l'objet TestDelay brut a chaque sonde, une fois par
// seconde : ces lignes noyaient la console. On les absorbe, sans rien en lire —
// la mesure est prise dans le message lui-meme (pairFiltrer).
(function(){
  var orig = console.log;
  console.log = function(){
    try{
      var a = arguments[0];
      if (a && typeof a === "object" && typeof a.last_delay === "number") return;
    }catch(_){}
    return orig.apply(console, arguments);
  };
})();

window.__rdPct = function(arr, p){
  if (!arr.length) return null;
  var s = arr.slice().sort(function(x,y){ return x-y; });
  return s[Math.min(s.length-1, Math.floor(s.length*p))];
};

// Le curseur distant est transmis (cursor_data / cursor_id) mais le code qui
// devait le dessiner est commente dans connection.ts. On le reimplemente :
// bitmap RGBA -> canvas -> data URL -> propriete CSS cursor avec son point
// chaud. Sans ca, on garde le pointeur local, qui ne reflete jamais l'etat
// de macOS (redimensionnement, texte, main, attente...).
window.__rdApplyCursor = function(css){
  ["player","rdcanvas"].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.style.cursor = css;
  });
};
window.__rdCursorFromData = function(cd, val){
  try{
    var w = parseInt(val(cd.width),10), h = parseInt(val(cd.height),10);
    var hx = parseInt(val(cd.hotx),10)||0, hy = parseInt(val(cd.hoty),10)||0;
    if (!(w>0 && h>0) || w>128 || h>128) return null;   // limite navigateur
    var raw = cd.colors;
    var arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!arr || arr.length < w*h*4) return null;
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(arr), w, h), 0, 0);
    return "url(" + cv.toDataURL() + ") " + hx + " " + hy + ", auto";
  }catch(e){ console.warn("[curseur]", e); return null; }
};

window.onGlobalEvent = function(payload){
  var e;
  try { e = JSON.parse(payload); } catch(_) { return; }

  // jsonfyForDart serialise CHAQUE valeur : il faut les reparser une a une.
  function val(x){ if (typeof x !== "string") return x;
                   try { return JSON.parse(x); } catch(_) { return x; } }

  try {
    if (e.name === "peer_info") {
      var r = val(e.resolutions);
      if (r && r.resolutions) window.RD.res = r.resolutions;
      var d = val(e.displays);
      if (d && d.length) {
        var cur = parseInt(val(e.current_display) || 0, 10) || 0;
        if (d[cur]) {
          if (d[cur].original_resolution) window.RD.orig = d[cur].original_resolution;
          window.RD.W = d[cur].width|0; window.RD.H = d[cur].height|0;
        }
        window.RD.displays = d; window.RD.display = cur;
      } else { window.RD.displays = []; window.RD.display = 0; }
      window.RD.ready = true;
      console.log("[session] prete — " + window.RD.res.length + " resolutions disponibles");
      // Les reglages memorises et le ratio de qualite s'appliquent a CHAQUE
      // session, ici, et avant la negociation du codec (elle lit RD.forced).
      // Un echec ici ne doit priver la session ni de son menu de resolutions ni
      // de la negociation du codec, qui suivent dans le meme bloc.
      try { if (window.__rdSessionReady) window.__rdSessionReady(); }
      catch (err) { console.warn("[session] reglages non appliques :", err); }
      // Apres le crochet de session : il remet a zero le blocage de saisie,
      // que le menu Actions affiche.
      if (window.__rdEcrans) window.__rdEcrans();
      if (window.__rdActions) window.__rdActions();
      if (window.__rdMenu) window.__rdMenu();
      if (window.__rdNegotiate) window.__rdNegotiate();
    }
    if (e.name === "switch_display") {
      var nd = parseInt(val(e.display), 10);
      if (nd >= 0) { window.RD.display = nd; if (window.__rdEcrans) window.__rdEcrans(); }
      var r2 = val(e.resolutions);
      if (r2 && r2.resolutions) { window.RD.res = r2.resolutions;
        if (window.__rdMenu) window.__rdMenu(); }
      var w = parseInt(val(e.width) || 0, 10), h = parseInt(val(e.height) || 0, 10);
      if (w > 0 && h > 0) {
        window.RD.W = w; window.RD.H = h;
        // Redimensionner le canvas ACTIF, pas #player en dur.
        var c = window.__rdActive ? window.__rdActive() : document.getElementById("player");
        if (c) { c.width = w; c.height = h; console.log("[ecran] " + w + "x" + h); }
        if (window.__rdFit) window.__rdFit();
      }
      // Nouveau flux : reinitialiser le decodeur et redemander une image-cle.
      if (window.__rdResetDecoder) window.__rdResetDecoder();
    }
    if (e.name === "cursor_data") {
      var cid = String(val(e.id));
      var css = window.__rdCursorFromData(e, val);
      if (css) {
        // Cache borne : les curseurs systeme sont peu nombreux et recurrents.
        if (window.RD.cursorN > 64) { window.RD.cursors = {}; window.RD.cursorN = 0; }
        if (!window.RD.cursors[cid]) window.RD.cursorN++;
        window.RD.cursors[cid] = css;
        window.__rdApplyCursor(css);
      }
    }
    if (e.name === "cursor_id") {
      var known = window.RD.cursors[String(val(e.id))];
      window.__rdApplyCursor(known || "default");
    }
  } catch(err) { console.warn("[onGlobalEvent]", err); }
};
