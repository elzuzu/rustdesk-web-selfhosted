// Entrees : souris (absolue ou relative), boutons Retour/Avance, molette (vitesse, sens), bouton principal, anti-veille,
// touches physiques que le gabarit n'envoie pas.
//
// NE TOUCHE PAS au gabarit : le pont du bundle (window.setByName) est enveloppe pour transformer les messages de souris
// (molette, bouton principal) ; les cas qu'il ne sait pas encoder (Retour/Avance, mouvement relatif) sont captures au niveau
// du document, avant les ecouteurs du gabarit, et envoyes par curConn.inputMouse. Avec les reglages par defaut, rien ne change.
//
// Fait verifie dans le source du pair (RustDesk, input_service.rs) : un clic (type 1/2) agit la ou est DEJA le curseur, sans
// lire x ni y ; un mouvement absolu (type 0) coupe le mode relatif ; le mouvement relatif (type 5) est borne a ±10000 ;
// la molette applique son amplitude (d'ou une vitesse reglable).
(function(){
  var C = window.RDConsole = window.RDConsole || {};
  var ui = C.ui, t = C.i18n.t, noeud = ui.noeud, pur = C.input, actif = ui.actif;

  C.i18n.ajouter({
    fr: {
      "souris.mode": "Mode de la souris", "souris.mode.aide": "Absolu suit le curseur ; Relatif capture la souris (BIOS, jeux, bureaux virtuels).",
      "souris.absolu": "Absolu", "souris.relatif": "Relatif",
      "souris.sensib": "Sensibilité relative", "souris.sensib.aide": "Vitesse du curseur en mode relatif.",
      "souris.bouton": "Bouton principal", "souris.bouton.aide": "Droit : inverse les boutons gauche et droit.",
      "bouton.gauche": "Gauche", "bouton.droit": "Droit",
      "souris.defil": "Vitesse de défilement", "souris.defil.aide": "Multiplie chaque cran de molette.",
      "souris.sens": "Sens de défilement", "souris.sens.aide": "Inverse la molette sur un axe ou sur les deux.",
      "sens.standard": "Standard", "sens.vertical": "Vertical inversé", "sens.horizontal": "Horizontal inversé", "sens.les-deux": "Les deux inversés",
      "souris.jiggle": "Anti-veille", "souris.jiggle.aide": "Déplace le curseur d'un pixel après 45 s d'inactivité, pour que le poste ne se mette pas en veille.",
      "souris.capture": "Cliquez dans l'image pour capturer la souris. Échap la libère."
    },
    en: {
      "souris.mode": "Mouse mode", "souris.mode.aide": "Absolute follows the cursor; Relative captures the mouse (BIOS, games, virtual desktops).",
      "souris.absolu": "Absolute", "souris.relatif": "Relative",
      "souris.sensib": "Relative sensitivity", "souris.sensib.aide": "Cursor speed in relative mode.",
      "souris.bouton": "Primary button", "souris.bouton.aide": "Right: swaps the left and right buttons.",
      "bouton.gauche": "Left", "bouton.droit": "Right",
      "souris.defil": "Scroll speed", "souris.defil.aide": "Multiplies each wheel notch.",
      "souris.sens": "Scroll direction", "souris.sens.aide": "Inverts the wheel on one axis or both.",
      "sens.standard": "Standard", "sens.vertical": "Vertical inverted", "sens.horizontal": "Horizontal inverted", "sens.les-deux": "Both inverted",
      "souris.jiggle": "Mouse jiggle", "souris.jiggle.aide": "Nudges the cursor one pixel after 45 s idle, so the machine does not go to sleep.",
      "souris.capture": "Click the image to capture the mouse. Esc releases it."
    }
  });

  function reglages(){ return C.shell.etat(); }
  function toast(cle){ if (typeof window.__rdToast === "function") { try { window.__rdToast(t(cle), "info"); } catch (e) {} } }
  function relatifPossible(){ var i = C.poste.info(); return pur.supporte("relatif", i.version, i.plateforme).ok; }
  function relatifActif(){ return reglages().souris === "relatif" && relatifPossible(); }
  function conn(){ var c = window.curConn; return c && typeof c.inputMouse === "function" ? c : null; }
  function mods(ev){ return [!!ev.altKey, !!ev.ctrlKey, !!ev.shiftKey, !!ev.metaKey]; }
  function envoyerSouris(masque, x, y, ev){
    var c = conn(); if (!c) return false;
    var m = mods(ev || {});
    try { c.inputMouse(masque, x | 0, y | 0, m[0], m[1], m[2], m[3]); return true; } catch (e) { console.warn("[souris]", e); return false; }
  }
  function surImage(ev){ var c = actif(); return !!c && ev.target === c; }

  // ------------------------------------------------ 1. le pont : molette et bouton principal
  function transformer(arg){
    var e = reglages();
    var neutre = e.taux === 1 && e.sens === "standard" && e.bouton === "gauche";
    if (neutre) return arg;                         // reglages par defaut : le message part tel quel, octet pour octet
    var m = JSON.parse(arg);
    if (m.type === "wheel") {
      var s = pur.sensDefilement(e.sens);
      var r = pur.molette({ x: parseInt(m.x || "0", 10), y: parseInt(m.y || "0", 10) }, { taux: e.taux, vertical: s.vertical, horizontal: s.horizontal });
      m.x = r.x; m.y = r.y;
    } else if (m.type === "down" || m.type === "up") {
      m.buttons = pur.bouton(m.buttons, e.bouton);
    }
    return JSON.stringify(m);
  }
  function installerPont(){
    var o = window.setByName;
    if (typeof o !== "function" || o.__rdPont) return;
    var w = function(nom, arg){
      if (nom === "send_mouse") { try { arg = transformer(arg); } catch (e) { /* le message part tel quel */ } }
      return o.call(this, nom, arg);
    };
    w.__rdPont = true; w.__orig = o;
    window.setByName = w;
  }

  // ------------------------------------------------ 2. boutons Retour / Avance et souris relative
  var rel = { rx: 0, ry: 0 }, derniereActivite = Date.now(), dernierePos = { x: 0, y: 0 };
  function noter(){ derniereActivite = Date.now(); }

  function surBouton(type, ev){
    noter();
    if (!surImage(ev)) return;
    if (ev.button === 3 || ev.button === 4) {                     // Retour / Avance : le gabarit les enverrait comme un clic gauche
      ev.preventDefault(); ev.stopImmediatePropagation();
      envoyerSouris(pur.masque(type, ev.button === 3 ? "back" : "forward"), 0, 0, ev);
      return;
    }
    if (type === "down" && relatifActif() && document.pointerLockElement !== ev.target) {
      try { ev.target.requestPointerLock(); } catch (e) { /* refuse hors geste utilisateur */ }
    }
  }
  function surMouvement(ev){
    noter();
    if (!surImage(ev) && document.pointerLockElement !== actif()) return;
    var c = actif();
    if (c && !relatifActif()) {                                    // position distante pour l'anti-veille
      var r = c.getBoundingClientRect();
      if (r.width && r.height) dernierePos = { x: Math.round((ev.clientX - r.left) * (c.width / r.width)), y: Math.round((ev.clientY - r.top) * (c.height / r.height)) };
      return;
    }
    if (!relatifActif()) return;
    // En mode relatif le gabarit ne doit RIEN envoyer : un mouvement absolu couperait le mode relatif chez le pair.
    ev.stopImmediatePropagation();
    if (document.pointerLockElement !== actif()) return;
    var d = pur.accumulerRelatif(rel, ev.movementX || 0, ev.movementY || 0, reglages().sensib / 10);
    if (d.x || d.y) envoyerSouris(pur.masque("relatif"), d.x, d.y, ev);
  }
  function relacher(){ try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {} rel.rx = rel.ry = 0; }

  // ------------------------------------------------ 3. anti-veille
  var battements = 0;
  function jiggle(){
    if (reglages().jiggle !== "actif") return;
    if (Date.now() - derniereActivite < 45000) return;
    var c = conn(); if (!c) return;
    battements++;
    var i = C.poste.info(), d = pur.battement(battements);
    // Mouvement relatif (invisible) quand le pair le comprend ; sinon un mouvement absolu d'un pixel autour du dernier point connu.
    if (pur.versionAu(i.version, "1.4.5") === true) envoyerSouris(pur.masque("relatif"), d, 0);
    else {
      var RD = window.RD || {}, x = dernierePos.x || ((RD.W || 2) >> 1), y = dernierePos.y || ((RD.H || 2) >> 1);
      envoyerSouris(pur.masque("move"), x + d, y);
    }
    noter();
  }

  // ------------------------------------------------ 4. touches physiques absentes du gabarit
  var enfoncees = {};
  function surTouche(down, ev){
    noter();
    var nom = pur.toucheDepuisCode(ev.code);
    if (!nom || !surImage(ev)) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    var m = { alt: String(ev.altKey), ctrl: String(ev.ctrlKey), shift: String(ev.shiftKey), command: String(ev.metaKey) };
    var msg = { name: nom, down: String(down), press: "false", alt: m.alt, ctrl: m.ctrl, shift: m.shift, command: m.command };
    if (down) enfoncees[ev.code] = true;
    else if (!enfoncees[ev.code]) { msg.down = "false"; msg.press = "true"; }       // Impr. ecran : seul keyup arrive sous Windows
    else delete enfoncees[ev.code];
    try { window.setByName("input_key", JSON.stringify(msg)); } catch (e) { console.warn("[entree]", e); }
  }

  function brancher(){
    if (brancher.fait) return; brancher.fait = true;
    document.addEventListener("mousedown", function(ev){ surBouton("down", ev); }, true);
    document.addEventListener("mouseup", function(ev){ surBouton("up", ev); }, true);
    document.addEventListener("auxclick", function(ev){ if (surImage(ev) && (ev.button === 3 || ev.button === 4)) ev.preventDefault(); }, true);
    document.addEventListener("mousemove", surMouvement, true);
    document.addEventListener("wheel", noter, true);
    document.addEventListener("keydown", function(ev){ surTouche(true, ev); }, true);
    document.addEventListener("keyup", function(ev){ surTouche(false, ev); }, true);
    document.addEventListener("pointerlockchange", function(){ if (!document.pointerLockElement) { rel.rx = rel.ry = 0; } });
    setInterval(jiggle, 15000);
  }

  // ------------------------------------------------ 5. reglages (section « Souris »)
  var m = function(_nom, ordre, f){ C.shell.ajouterLigne("souris", ordre, f); };
  m("souris.mode", 20, function(){
    var i = C.poste.info(), sup = pur.supporte("relatif", i.version, i.plateforme);
    var g = ui.segmente([["absolu", t("souris.absolu")], ["relatif", t("souris.relatif")]], reglages().souris, function(v){
      C.shell.memoriser({ souris: v });
      if (v === "relatif") toast("souris.capture"); else relacher();
    });
    var l = ui.ligne(t("souris.mode"), g, t("souris.mode.aide"));
    if (!sup.ok) { ui.grise(l, t(sup.cle, sup.params)); }
    return l;
  });
  m("souris.sensib", 30, function(){
    return ui.ligne(t("souris.sensib"), ui.curseur(reglages().sensib, 1, 20, 1, function(v, fin){ if (fin) C.shell.memoriser({ sensib: v }); },
      function(v){ return (v / 10).toFixed(1) + "×"; }, "sensib"), t("souris.sensib.aide"));
  });
  m("souris.bouton", 40, function(){
    return ui.ligne(t("souris.bouton"), ui.segmente([["gauche", t("bouton.gauche")], ["droit", t("bouton.droit")]], reglages().bouton, function(v){
      C.shell.memoriser({ bouton: v });
    }), t("souris.bouton.aide"));
  });
  m("souris.defil", 50, function(){
    return ui.ligne(t("souris.defil"), ui.curseur(reglages().taux, 1, 10, 1, function(v, fin){ if (fin) C.shell.memoriser({ taux: v }); },
      function(v){ return v + "×"; }, "taux"), t("souris.defil.aide"));
  });
  m("souris.sens", 60, function(){
    return ui.ligne(t("souris.sens"), ui.liste(pur.SENS.map(function(s){ return [s, t("sens." + s)]; }), reglages().sens, function(v){
      C.shell.memoriser({ sens: v });
    }, "sens"), t("souris.sens.aide"));
  });
  m("souris.jiggle", 70, function(){
    return ui.ligne(t("souris.jiggle"), ui.interrupteur(reglages().jiggle === "actif", function(on){
      C.shell.memoriser({ jiggle: on ? "actif" : "inactif" }); noter();
    }, "jiggle"), t("souris.jiggle.aide"));
  });

  C.shell.surMontage(function(){ installerPont(); brancher(); });
  C.entree = { transformer: transformer, installerPont: installerPont, relatifActif: relatifActif, jiggle: jiggle, _noter: noter,
               _inactiver: function(ms){ derniereActivite = Date.now() - ms; } };
})();
