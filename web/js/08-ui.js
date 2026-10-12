// Composants d'interface partages par la console : icones, lignes de reglage, interrupteurs, curseurs,
// choix exclusifs, fenetres flottantes (popover). Aucun ne connait la session : ils ne font que du DOM.
(function(){
  var C = window.RDConsole = window.RDConsole || {};
  var t = C.i18n.t, compteur = 0;

  // ------------------------------------------------------------- icones
  // Traits de 1,75 px, 24x24, couleur heritee : un jeu coherent, sans police d'icones ni requete reseau.
  // L'espace de noms SVG n'est pas une reference externe.
  var NS = "http://www.w3.org/2000/svg";
  var ICONES = {
    reglages:  [["path", "M21 4h-7"], ["path", "M10 4H3"], ["path", "M21 12h-9"], ["path", "M8 12H3"], ["path", "M21 20h-5"],
                ["path", "M12 20H3"], ["path", "M14 2v4"], ["path", "M8 10v4"], ["path", "M16 18v4"]],
    dossier:   [["path", "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"]],
    quitter:   [["path", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"], ["path", "m16 17 5-5-5-5"], ["path", "M21 12H9"]],
    video:     [["path", "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"],
                ["rect", { x: 2, y: 6, width: 14, height: 12, rx: 2 }]],
    audio:     [["path", "M11 5 6 9H2v6h4l5 4V5Z"], ["path", "M15.5 8.5a5 5 0 0 1 0 7"], ["path", "M19 5a10 10 0 0 1 0 14"]],
    clavier:   [["path", "M10 8h.01"], ["path", "M12 12h.01"], ["path", "M14 8h.01"], ["path", "M16 12h.01"], ["path", "M18 8h.01"],
                ["path", "M6 8h.01"], ["path", "M7 16h10"], ["path", "M8 12h.01"], ["rect", { x: 2, y: 4, width: 20, height: 16, rx: 2 }]],
    souris:    [["path", "M12 2a7 7 0 0 0-7 7v6a7 7 0 0 0 14 0V9a7 7 0 0 0-7-7Z"], ["path", "M12 6v4"]],
    affichage: [["rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }], ["path", "M3 15h18"]],
    poste:     [["rect", { x: 2, y: 3, width: 20, height: 14, rx: 2 }], ["path", "M8 21h8"], ["path", "M12 17v4"]],
    outils:    [["path", "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"]],
    alimentation: [["path", "M12 2v10"], ["path", "M18.4 6.6a9 9 0 1 1-12.77.04"]],
    stats:     [["path", "M3 3v16a2 2 0 0 0 2 2h16"], ["path", "M18 17V9"], ["path", "M13 17V5"], ["path", "M8 17v-3"]],
    pleinecran:[["path", "M8 3H5a2 2 0 0 0-2 2v3"], ["path", "M21 8V5a2 2 0 0 0-2-2h-3"], ["path", "M3 16v3a2 2 0 0 0 2 2h3"], ["path", "M16 21h3a2 2 0 0 0 2-2v-3"]],
    reduire:   [["path", "M8 3v3a2 2 0 0 1-2 2H3"], ["path", "M21 8h-3a2 2 0 0 1-2-2V3"], ["path", "M3 16h3a2 2 0 0 1 2 2v3"], ["path", "M16 21v-3a2 2 0 0 1 2-2h3"]],
    cadenas:   [["rect", { x: 3, y: 11, width: 18, height: 11, rx: 2 }], ["path", "M7 11V7a5 5 0 0 1 10 0v4"]],
    ecran:     [["rect", { x: 2, y: 3, width: 20, height: 14, rx: 2 }], ["path", "M8 21h8"], ["path", "M12 17v4"]],
    camera:    [["path", "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"], ["circle", { cx: 12, cy: 13, r: 3 }]],
    enregistrer:[["circle", { cx: 12, cy: 12, r: 9 }], ["circle", { cx: 12, cy: 12, r: 3, fill: "currentColor" }]],
    clavierv:  [["rect", { x: 2, y: 6, width: 20, height: 12, rx: 2 }], ["path", "M6 10h.01"], ["path", "M10 10h.01"], ["path", "M14 10h.01"], ["path", "M18 10h.01"], ["path", "M8 14h8"]],
    aide:      [["circle", { cx: 12, cy: 12, r: 10 }], ["path", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"], ["path", "M12 17h.01"]],
    fermer:    [["path", "M18 6 6 18"], ["path", "m6 6 12 12"]]
  };
  function icone(nom){
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "rdico");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    (ICONES[nom] || []).forEach(function(f){
      var n = document.createElementNS(NS, f[0]);
      if (typeof f[1] === "string") n.setAttribute("d", f[1]);
      else Object.keys(f[1]).forEach(function(k){ n.setAttribute(k, f[1][k]); });
      svg.appendChild(n);
    });
    return svg;
  }

  function noeud(tag, cls, texte){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texte != null) n.textContent = texte;
    return n;
  }
  function actif(){ return typeof window.__rdActive === "function" ? window.__rdActive() : null; }
  // Le canvas reprend le clavier APRES le clic : un bouton qui garderait le focus ferait perdre le collage
  // et la frappe (cf. gestionnaire de #rdbar).
  function rendreFocus(){
    setTimeout(function(){ var c = actif(); if (c && c.focus) c.focus(); }, 0);
  }

  // Une ligne de reglage : libelle, texte d'aide (relie au controle par aria-describedby), controle.
  function ligne(libelle, controle, aide){
    var l = noeud("div", "rdrow"), txt = noeud("div", "rdtxt");
    var lib = noeud("span", "rdlib", libelle);
    lib.id = "rdlib-" + (++compteur);
    txt.appendChild(lib);
    var idAide = null;
    if (aide) {
      var a = noeud("span", "rdaide", aide);
      idAide = a.id = "rdaide-" + compteur;
      txt.appendChild(a);
    }
    // Le champ nomme : le controle lui-meme, ou celui qu'il contient (interrupteur + bouton d'origine).
    var tag = String(controle.tagName || "").toUpperCase();
    var cible = (tag === "SELECT" || tag === "INPUT" || controle.getAttribute("role") === "radiogroup") ? controle :
                (controle.querySelector ? controle.querySelector("input,select") : null);
    if (cible) {
      cible.setAttribute("aria-labelledby", lib.id);
      if (idAide) cible.setAttribute("aria-describedby", idAide);
    } else if (idAide) {
      controle.setAttribute("aria-describedby", idAide);
    }
    l.appendChild(txt); l.appendChild(controle);
    return l;
  }
  // Une fonction qui n'existe pas pour ce poste : la ligne reste, grisee, avec la raison (jamais cachee ni muette).
  function grise(l, raison){
    l.setAttribute("data-indisponible", "1");
    l.title = raison;
    var a = l.querySelector(".rdaide");
    if (a) a.textContent = raison; else { a = noeud("span", "rdaide", raison); l.querySelector(".rdtxt").appendChild(a); }
    l.querySelectorAll("input,select,button").forEach(function(c){ c.disabled = true; });
    return l;
  }

  // Interrupteur : une case native (clavier, lecteurs d'ecran) habillee en commutateur.
  function interrupteur(coche, auChangement, pour){
    var cb = noeud("input", "rdsw");
    cb.type = "checkbox";
    cb.setAttribute("role", "switch");
    if (pour) cb.setAttribute("data-pour", pour);
    cb.checked = !!coche;
    cb.addEventListener("change", function(){ auChangement(cb.checked); rendreFocus(); });
    return cb;
  }
  // Curseur : une plage native + sa valeur lisible.
  function curseur(valeur, min, max, pas, auChangement, format, pour){
    var g = noeud("span", "rdrange");
    var r = noeud("input", "rdslider");
    r.type = "range"; r.min = min; r.max = max; r.step = pas; r.value = valeur;
    if (pour) r.setAttribute("data-pour", pour);
    var o = noeud("output", "rdval");
    function maj(){ o.textContent = format ? format(+r.value) : r.value; r.setAttribute("aria-valuetext", o.textContent); }
    r.addEventListener("input", function(){ maj(); auChangement(+r.value, false); });
    r.addEventListener("change", function(){ auChangement(+r.value, true); rendreFocus(); });
    maj();
    g.appendChild(r); g.appendChild(o);
    return g;
  }
  // Choix exclusif (WAI-ARIA radiogroup) : fleches, un seul bouton dans l'ordre de tabulation.
  function segmente(options, valeur, auChangement){
    var g = noeud("div", "rdsegmented"), boutons = [];
    g.setAttribute("role", "radiogroup");
    function choisir(v, focus){
      boutons.forEach(function(b){
        var on = b.getAttribute("data-valeur") === v;
        b.setAttribute("aria-checked", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
      });
      auChangement(v);
    }
    options.forEach(function(o){
      var b = noeud("button", null, o[1]);
      b.type = "button"; b.setAttribute("role", "radio");
      b.setAttribute("data-valeur", o[0]);
      b.setAttribute("aria-checked", o[0] === valeur ? "true" : "false");
      b.tabIndex = o[0] === valeur ? 0 : -1;
      b.addEventListener("click", function(){ choisir(o[0], false); });
      b.addEventListener("keydown", function(ev){
        var i = boutons.indexOf(b), d = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 :
                                        ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        ev.preventDefault();
        choisir(options[(i + d + options.length) % options.length][0], true);
      });
      boutons.push(b); g.appendChild(b);
    });
    g.choisir = function(v){ boutons.forEach(function(b){
      var on = b.getAttribute("data-valeur") === v; b.setAttribute("aria-checked", on ? "true" : "false"); b.tabIndex = on ? 0 : -1; }); };
    return g;
  }
  // Liste deroulante native (clavier, lecteurs d'ecran, ecrans tactiles : gratuits) ; options = [[valeur, libelle], …].
  function liste(options, valeur, auChangement, pour){
    var s = noeud("select");
    if (pour) s.setAttribute("data-pour", pour);
    options.forEach(function(o){
      var e = noeud("option", null, o[1]); e.value = o[0]; if (o[0] === valeur) e.selected = true; s.appendChild(e);
    });
    s.addEventListener("change", function(){ auChangement(s.value); });
    return s;
  }
  function bouton(libelle, auClic, icoNom, cls){
    var b = noeud("button", cls || "rdbtn");
    b.type = "button";
    if (icoNom) b.appendChild(icone(icoNom));
    b.appendChild(noeud("span", "rdlbl", libelle));
    b.addEventListener("click", function(ev){ auClic(ev, b); });
    return b;
  }

  // ------------------------------------------------------------ fenetre flottante
  // Popover natif (couche superieure, fermeture au clic exterieur et a Echap, focus gere par le navigateur) ;
  // repli sur un simple « hidden » + clic exterieur quand l'API manque.
  var NATIF = typeof HTMLElement !== "undefined" && HTMLElement.prototype && typeof HTMLElement.prototype.showPopover === "function";
  function popover(id, titre, classe){
    var el = noeud("div", "rdpop" + (classe ? " " + classe : ""));
    el.id = id;
    if (NATIF) el.setAttribute("popover", "auto");     // masque par le navigateur tant qu'il n'est pas ouvert
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", titre);
    var ouvert = false, auxFermetures = [], invocateur = null;
    function placer(inv){
      if (!inv || !inv.getBoundingClientRect) return;
      var r = inv.getBoundingClientRect(), w = Math.min(el.offsetWidth || 320, window.innerWidth - 16);
      var gauche = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      el.style.insetInlineStart = gauche + "px";
      el.style.insetBlockStart = Math.round(r.bottom + 6) + "px";
    }
    var api = {
      el: el,
      estOuvert: function(){ return ouvert; },
      surFermeture: function(f){ auxFermetures.push(f); },
      ouvrir: function(inv){
        invocateur = inv || invocateur;
        if (ouvert) return;
        if (NATIF) { try { el.showPopover(); } catch (e) { el.hidden = false; } }
        else el.hidden = false;
        ouvert = true; placer(invocateur);
        if (invocateur) invocateur.setAttribute("aria-expanded", "true");
      },
      fermer: function(){
        if (!ouvert) return;
        if (NATIF) { try { el.hidePopover(); } catch (e) { el.hidden = true; } } else el.hidden = true;
        suiteFermeture();
      },
      basculer: function(inv){ if (ouvert) api.fermer(); else api.ouvrir(inv); }
    };
    function suiteFermeture(){
      if (!ouvert) return;
      ouvert = false;
      if (invocateur) invocateur.setAttribute("aria-expanded", "false");
      auxFermetures.forEach(function(f){ try { f(); } catch (e) {} });
      rendreFocus();
    }
    if (NATIF) {
      el.addEventListener("toggle", function(ev){ if (ev.newState === "closed") suiteFermeture(); });
    } else {
      el.hidden = true;
      document.addEventListener("mousedown", function(ev){ if (ouvert && !el.contains(ev.target) && !(invocateur && invocateur.contains(ev.target))) api.fermer(); });
      el.addEventListener("keydown", function(ev){ if (ev.key === "Escape") { ev.stopPropagation(); api.fermer(); } });
    }
    return api;
  }

  C.ui = { NS: NS, icone: icone, noeud: noeud, actif: actif, rendreFocus: rendreFocus, ligne: ligne, grise: grise,
           interrupteur: interrupteur, curseur: curseur, segmente: segmente, liste: liste, bouton: bouton, popover: popover, NATIF: NATIF,
           ICONES: ICONES };
})();
