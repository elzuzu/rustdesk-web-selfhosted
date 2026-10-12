// Logique PURE de l'entree et des fonctions du poste : aucune lecture du DOM, aucune globale hormis
// window.RDConsole. Testable sous Node (scripts/test-template.mjs).
(function(){
  var C = window.RDConsole = window.RDConsole || {};

  // ------------------------------------------------------------ versions
  // « 1.4.2 » >= « 1.4.5 » ? Vrai / faux, ou null quand la version du pair est inconnue (on ne bloque alors rien :
  // une fonction que le pair ne comprend pas est ignoree par lui, un refus a tort prive l'utilisateur).
  function versionAu(v, min){
    if (typeof v !== "string" || !/^\d+(\.\d+){0,3}/.test(v)) return null;
    var a = v.split("."), b = String(min).split("."), n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) {
      var x = parseInt(a[i] || "0", 10), y = parseInt(b[i] || "0", 10);
      if (x !== y) return x > y;
    }
    return true;
  }

  // Ce qu'exige chaque fonction. « cle » est une cle i18n expliquant le refus (jamais une fonction cachee).
  var EXIGENCES = {
    relatif:         { min: "1.4.5", cle: "indispo.version" },
    confidentialite: { plateformes: ["Windows"], cle: "indispo.plateforme" },
    // Ctrl+Alt+Suppr : message dedie sous Windows, combinaison de touches sous Linux ; sans objet sous macOS.
    ctrlAltSuppr:    { plateformes: ["Windows", "Linux"], cle: "indispo.plateforme" }
  };
  var NOMS_PLATEFORME = { Windows: "Windows", Linux: "Linux", "Mac OS": "macOS" };

  // { ok: true } ou { ok: false, cle, params }. Version ou plateforme inconnue : autorise.
  function supporte(fonction, version, plateforme){
    var e = EXIGENCES[fonction];
    if (!e) return { ok: true };
    if (e.min && versionAu(version, e.min) === false) return { ok: false, cle: e.cle, params: { min: e.min } };
    if (e.plateformes && plateforme && e.plateformes.indexOf(plateforme) < 0) {
      return { ok: false, cle: e.cle, params: { os: e.plateformes.map(function(p){ return NOMS_PLATEFORME[p] || p; }).join(", ") } };
    }
    return { ok: true };
  }

  // ------------------------------------------------------------ souris
  var TYPES = { move: 0, down: 1, up: 2, wheel: 3, trackpad: 4, relatif: 5 };
  var BOUTONS = { left: 1, right: 2, wheel: 4, back: 8, forward: 16 };
  // Masque envoye au pair : type | (bouton << 3) — le meme que le pont du bundle (setByName « send_mouse »).
  function masque(type, bouton){ return (TYPES[type] | 0) | ((BOUTONS[bouton] | 0) << 3); }

  // Bouton principal : « droit » echange gauche et droit (gaucher). Les autres boutons ne bougent pas.
  function bouton(b, primaire){
    if (primaire !== "droit") return b;
    return b === "left" ? "right" : b === "right" ? "left" : b;
  }

  // Sens de defilement : « standard », « vertical » (inverse haut/bas), « horizontal », « les-deux ».
  var SENS = ["standard", "vertical", "horizontal", "les-deux"];
  function sensDefilement(s){
    return { vertical: s === "vertical" || s === "les-deux", horizontal: s === "horizontal" || s === "les-deux" };
  }
  // La molette part du gabarit sous forme de crans (-1, 0, 1 par axe). Taux de 1 a 10 : multiplicateur.
  function molette(msg, cfg){
    cfg = cfg || {};
    var k = Math.max(1, Math.min(10, Math.round(+cfg.taux || 1)));
    var sy = cfg.vertical ? -1 : 1, sx = cfg.horizontal ? -1 : 1;
    return { x: (msg.x | 0) * k * sx + 0, y: (msg.y | 0) * k * sy + 0 };     // « + 0 » : jamais -0
  }

  // Souris relative : les deplacements fractionnaires (sensibilite < 1) ne sont pas perdus, ils s'accumulent.
  //   etat = { rx: 0, ry: 0 } ; rend les entiers a envoyer et garde le reste.
  function accumulerRelatif(etat, dx, dy, k){
    k = k > 0 ? k : 1;
    etat.rx += dx * k; etat.ry += dy * k;
    var x = etat.rx < 0 ? Math.ceil(etat.rx) : Math.floor(etat.rx);
    var y = etat.ry < 0 ? Math.ceil(etat.ry) : Math.floor(etat.ry);
    etat.rx -= x; etat.ry -= y;
    return { x: x + 0, y: y + 0 };
  }
  // Anti-veille : un battement d'un pixel, alterne pour ne pas deriver.
  function battement(n){ return (n & 1) ? -1 : 1; }

  // ------------------------------------------------------------ clavier
  var ALIAS = { ctrl: "ctrl", control: "ctrl", alt: "alt", option: "alt", opt: "alt", shift: "shift", maj: "shift",
                cmd: "command", command: "command", meta: "command", win: "command", windows: "command", super: "command" };
  var NOMS = { enter: "Return", return: "Return", esc: "Escape", echap: "Escape", escape: "Escape", tab: "Tab", space: "Space", espace: "Space",
               del: "Delete", delete: "Delete", suppr: "Delete", backspace: "Backspace", insert: "Insert", ins: "Insert",
               home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown", up: "UpArrow", down: "DownArrow",
               left: "LeftArrow", right: "RightArrow", printscreen: "Snapshot", imprecran: "Snapshot", snapshot: "Snapshot",
               menu: "Apps", apps: "Apps", pause: "Pause", scrolllock: "Scroll", numlock: "NumLock", capslock: "CapsLock" };
  // « ctrl+alt+Delete » → { name: "Delete", ctrl: true, alt: true, shift: false, command: false } ; null si illisible.
  // Une touche de modificateur seule (« Win ») devient la touche « Meta » elle-meme.
  function parseCombo(texte){
    if (typeof texte !== "string") return null;
    var morceaux = texte.split("+").map(function(s){ return s.trim(); });
    if (!morceaux.length || morceaux.some(function(s){ return !s; })) return null;
    var r = { name: "", alt: false, ctrl: false, shift: false, command: false }, touche = null;
    for (var i = 0; i < morceaux.length; i++) {
      var m = morceaux[i], bas = m.toLowerCase();
      if (ALIAS[bas] && i < morceaux.length - 1) { r[ALIAS[bas]] = true; continue; }
      if (i !== morceaux.length - 1) return null;                  // une touche normale est forcement la derniere
      touche = m;
    }
    if (touche == null) return null;
    var b = touche.toLowerCase();
    if (NOMS[b]) r.name = NOMS[b];
    else if (/^f([1-9]|1[0-2])$/.test(b)) r.name = b.toUpperCase();
    else if (ALIAS[b]) r.name = "Meta";                              // « Win » seule
    else if (touche.length === 1) r.name = touche.toLowerCase();
    else return null;
    return r;
  }
  // Representation canonique, relisible : « Ctrl+Alt+Delete ».
  function libelleCombo(c){
    var p = [];
    if (c.ctrl) p.push("Ctrl"); if (c.alt) p.push("Alt"); if (c.shift) p.push("Maj"); if (c.command) p.push("Cmd/Win");
    p.push(c.name === "Meta" ? "Win/Cmd" : c.name.length === 1 ? c.name.toUpperCase() : c.name);
    return p.join("+");
  }

  // Raccourcis proposes selon le systeme du poste distant. « special » : passe par le message dedie du bundle.
  function presets(plateforme){
    var sans = [{ id: "esc", combo: "Escape" }, { id: "tab", combo: "Tab" }];
    if (plateforme === "Windows") return [
      { id: "cad", combo: "ctrl+alt+Delete", special: "ctrl_alt_del" }, { id: "win", combo: "Win" }, { id: "alttab", combo: "alt+Tab" },
      { id: "gestionnaire", combo: "ctrl+shift+Escape" }, { id: "bureau", combo: "win+d" }, { id: "verrou", combo: "win+l" },
      { id: "altf4", combo: "alt+F4" }, { id: "impr", combo: "PrintScreen" }].concat(sans);
    if (plateforme === "Mac OS") return [
      { id: "spotlight", combo: "cmd+Space" }, { id: "cmdtab", combo: "cmd+Tab" }, { id: "capture", combo: "cmd+shift+3" },
      { id: "zone", combo: "cmd+shift+4" }, { id: "forcer", combo: "cmd+alt+Escape" }, { id: "verroumac", combo: "ctrl+cmd+q" }].concat(sans);
    if (plateforme === "Linux") return [
      { id: "cad", combo: "ctrl+alt+Delete", special: "ctrl_alt_del" }, { id: "super", combo: "Win" }, { id: "alttab", combo: "alt+Tab" },
      { id: "terminal", combo: "ctrl+alt+t" }, { id: "impr", combo: "PrintScreen" }].concat(sans);
    return [{ id: "win", combo: "Win" }, { id: "alttab", combo: "alt+Tab" }, { id: "impr", combo: "PrintScreen" }].concat(sans);
  }
  // Touches physiques que le gabarit n'envoie pas : e.code -> nom de touche du bundle.
  var CODES = { PrintScreen: "Snapshot", ContextMenu: "Apps", Pause: "Pause", ScrollLock: "Scroll", NumLock: "NumLock" };
  function toucheDepuisCode(code){ return CODES[code] || null; }

  // Raccourcis personnalises, sous « rd-raccourcis » : jamais plus de douze, chacun relu par parseCombo (un stockage
  // corrompu ou une entree illisible est ecarte, jamais recopie). Repli en memoire si le stockage refuse l'ecriture.
  function creerRaccourcis(storage, opts){
    var cle = (opts && opts.key) || "rd-raccourcis", MAX = 12, mem = null;
    function valide(x){ return typeof x === "string" && x.length <= 40 && parseCombo(x) !== null; }
    function lire(){
      var j = null;
      try { j = JSON.parse(storage.getItem(cle)); } catch (e) { j = null; }
      var l = Array.isArray(j) ? j : (mem || []);
      return l.filter(valide).slice(0, MAX);
    }
    function ecrire(l){ try { storage.setItem(cle, JSON.stringify(l)); mem = null; } catch (e) { mem = l; } }
    return {
      MAX: MAX,
      liste: lire,
      ajouter: function(texte){
        var c = parseCombo(texte);
        if (!c || String(texte).length > 40) return { ok: false, cle: "rac.invalide" };
        var l = lire(), lib = libelleCombo(c);
        if (l.some(function(x){ return libelleCombo(parseCombo(x)) === lib; })) return { ok: false, cle: "rac.doublon" };
        if (l.length >= MAX) return { ok: false, cle: "rac.plein" };
        l.push(String(texte).trim()); ecrire(l);
        return { ok: true };
      },
      retirer: function(i){ var l = lire(); if (i >= 0 && i < l.length) { l.splice(i, 1); ecrire(l); } }
    };
  }

  C.input = {
    creerRaccourcis: creerRaccourcis,
    versionAu: versionAu, supporte: supporte, EXIGENCES: EXIGENCES,
    TYPES: TYPES, BOUTONS: BOUTONS, masque: masque, bouton: bouton,
    SENS: SENS, sensDefilement: sensDefilement, molette: molette,
    accumulerRelatif: accumulerRelatif, battement: battement,
    parseCombo: parseCombo, libelleCombo: libelleCombo, presets: presets, toucheDepuisCode: toucheDepuisCode
  };
})();
