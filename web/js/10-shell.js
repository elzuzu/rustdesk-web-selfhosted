// Console de session : habille la barre #rdbar, ajoute le tiroir « Reglages de
// session » et la barre de statut.
//
// PRINCIPE — on ne recree aucun controle. Les six controles tenus par closure
// dans le gabarit (reperes data-rd=…) sont DEPLACES dans le tiroir : leurs
// gestionnaires, les reglages memorises (rd-prefs) et les references ui.*
// restent intacts, aucune logique n'est dupliquee. #rdbar reste la barre haute :
// le bouton vert du presse-papier (.rdppbtn), .rdfilesbtn, .quit et .rdhandle
// en restent des enfants DIRECTS (le gabarit les insere avec insertBefore).
//
// ISOLATION — si quoi que ce soit echoue au montage, tout est remis en place et
// la barre d'origine reste en service : la classe body.rd-console, qui active
// tout l'habillage, n'est posee qu'a la FIN d'un montage reussi. L'habillage
// purement cosmetique (icones des boutons du gabarit) vient APRES et ne peut
// jamais faire echouer le montage.
(function(){
  var C = window.RDConsole = window.RDConsole || {};

  // ------------------------------------------------------------- icones
  // Traits de 1,75 px, 24×24, couleur heritee : un jeu coherent, sans police d'icones
  // ni requete reseau. L'espace de noms SVG n'est pas une reference externe.
  var NS = "http://www.w3.org/2000/svg";
  var ICONES = {
    reglages:  [["path", "M21 4h-7"], ["path", "M10 4H3"], ["path", "M21 12h-9"], ["path", "M8 12H3"], ["path", "M21 20h-5"],
                ["path", "M12 20H3"], ["path", "M14 2v4"], ["path", "M8 10v4"], ["path", "M16 18v4"]],
    dossier:   [["path", "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"]],
    quitter:   [["path", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"], ["path", "m16 17 5-5-5-5"], ["path", "M21 12H9"]],
    video:     [["path", "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"],
                ["rect", { x: 2, y: 6, width: 14, height: 12, rx: 2 }]],
    clavier:   [["path", "M10 8h.01"], ["path", "M12 12h.01"], ["path", "M14 8h.01"], ["path", "M16 12h.01"], ["path", "M18 8h.01"],
                ["path", "M6 8h.01"], ["path", "M7 16h10"], ["path", "M8 12h.01"], ["rect", { x: 2, y: 4, width: 20, height: 16, rx: 2 }]],
    souris:    [["path", "M12 2a7 7 0 0 0-7 7v6a7 7 0 0 0 14 0V9a7 7 0 0 0-7-7Z"], ["path", "M12 6v4"]],
    affichage: [["rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }], ["path", "M3 15h18"]],
    poste:     [["rect", { x: 2, y: 3, width: 20, height: 14, rx: 2 }], ["path", "M8 21h8"], ["path", "M12 17v4"]],
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

  var stockage = (function(){
    try { return C.store.create(window.localStorage); }
    catch (e) {
      return C.store.create({ getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} });
    }
  })();
  var etat = stockage.get();

  var monte = false, renonce = false, essais = 0, compteur = 0;
  var barre = null, tiroir = null, statut = null, btnSession = null, pairEl = null, observateur = null;
  var deplaces = [], resynchros = [];
  var ligneEl = null, etatEl = null, lienEl = null, rttEl = null, pairIdEl = null;
  var mesure = { frames: 0, t: 0 }, derniere = "";

  function ctl(nom){ return document.querySelector('[data-rd="' + nom + '"]'); }
  function noeud(tag, cls, texte){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texte != null) n.textContent = texte;
    return n;
  }
  function actif(){ return typeof window.__rdActive === "function" ? window.__rdActive() : null; }
  // Le canvas reprend le clavier APRES le clic : un bouton qui garderait le
  // focus ferait perdre le collage et la frappe (cf. gestionnaire de #rdbar).
  function rendreFocus(){
    setTimeout(function(){ var c = actif(); if (c && c.focus) c.focus(); }, 0);
  }
  function memoriser(patch){ stockage.set(patch); etat = stockage.get(); }

  // On NOTE d'ou vient un controle avant de le deplacer : si le montage echoue,
  // demonter() le remet dans la barre.
  function prendre(nom){
    var n = ctl(nom);
    if (!n) throw new Error("controle introuvable : data-rd=" + nom);
    deplaces.push({ n: n, parent: n.parentNode });
    return n;
  }

  // Une ligne de reglage : libelle, texte d'aide (relie au controle par aria-describedby), controle.
  function ligne(libelle, controle, aide){
    var l = noeud("div", "rdrow"), txt = noeud("div", "rdtxt");
    var lib = noeud("span", "rdlib", libelle);
    lib.id = "rdlib-" + (++compteur);
    txt.appendChild(lib);
    if (aide) {
      var a = noeud("span", "rdaide", aide);
      a.id = "rdaide-" + compteur;
      txt.appendChild(a);
      if (!controle.querySelector || !controle.querySelector("input,select")) controle.setAttribute("aria-describedby", a.id);
    }
    // Le champ nomme : le controle lui-meme, ou celui qu'il contient (interrupteur + bouton d'origine).
    var tag = String(controle.tagName || "").toUpperCase();
    var cible = (tag === "SELECT" || tag === "INPUT" || controle.getAttribute("role") === "radiogroup") ? controle :
                (controle.querySelector ? controle.querySelector("input,select") : null);
    if (cible) {
      cible.setAttribute("aria-labelledby", lib.id);
      if (aide) cible.setAttribute("aria-describedby", "rdaide-" + compteur);
    }
    l.appendChild(txt); l.appendChild(controle);
    return l;
  }
  function section(cle, titre, icoNom, lignes){
    var d = noeud("details", "rdsec");
    d.setAttribute("data-sec", cle);
    d.open = etat[cle] === "ouverte";
    var sm = noeud("summary");
    sm.appendChild(icone(icoNom));
    sm.appendChild(noeud("span", "rdsec-titre", titre));
    d.appendChild(sm);
    var corps = noeud("div", "rdsec-corps");
    lignes.forEach(function(l){ corps.appendChild(l); });
    d.appendChild(corps);
    d.addEventListener("toggle", function(){
      var p = {}; p[cle] = d.open ? "ouverte" : "fermee";
      memoriser(p);
    });
    return d;
  }
  // Interrupteur : une case a cocher native (clavier, lecteur d'ecran) habillee en commutateur.
  function interrupteur(coche, auChangement, pour){
    var cb = noeud("input", "rdsw");
    cb.type = "checkbox";
    cb.setAttribute("role", "switch");
    if (pour) cb.setAttribute("data-pour", pour);
    cb.checked = !!coche;
    cb.addEventListener("change", function(){ auChangement(cb.checked); rendreFocus(); });
    return cb;
  }
  // Un interrupteur qui PILOTE un bouton existant du gabarit : le bouton garde son gestionnaire
  // (et sa memorisation), l'interrupteur n'en est que la vue. L'etat se relit a la source, jamais
  // d'apres le texte du bouton.
  function interrupteurSur(original, lire, pour){
    var cb = interrupteur(lire(), function(){
      original.click();
      cb.checked = lire();
    }, pour);
    // Le bouton d'origine loge dans le tiroir, cache, a cote de son interrupteur : il y est
    // « deplace » comme les autres, et demonter() sait le remettre dans la barre.
    original.setAttribute("hidden", "");
    var enveloppe = noeud("span", "rdsw-wrap");
    enveloppe.appendChild(original); enveloppe.appendChild(cb);
    resynchros.push(function(){ cb.checked = lire(); });
    return enveloppe;
  }
  // Choix exclusif (WAI-ARIA radiogroup) : fleches gauche/droite, un seul bouton dans l'ordre de tabulation.
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
    return g;
  }

  // ---------------------------------------------------------- mise en page
  // Variables CSS lues par console.css (conteneur #canvas, HUD, panneau de
  // fichiers) : l'image se cale entre les barres, comme sur GLKVM.
  function appliquer(){
    if (!monte) return;
    var d = barre.style.display;                    // le veilleur du gabarit pose flex / none
    var enSession = d !== "" && d !== "none";
    var ins = C.layout.insets({
      enSession: enSession,
      barre: barre.classList.contains("replie") ? "repliee" : "ouverte",
      drawer: etat.drawer, statut: etat.statut, largeur: window.innerWidth
    });
    tiroir.hidden = !(enSession && etat.drawer === "ouvert");
    statut.hidden = !(enSession && etat.statut === "visible");
    btnSession.setAttribute("aria-expanded", etat.drawer === "ouvert" ? "true" : "false");
    document.body.setAttribute("data-rd-theme", etat.theme);
    if (enSession) majPair();
    var cle = [enSession, ins.top, ins.left, ins.bottom, etat.drawer, etat.statut].join("|");
    if (cle === derniere) return;                   // le veilleur reecrit style 1 fois / 800 ms : rien a refaire
    derniere = cle;
    var st = document.documentElement.style;
    st.setProperty("--rd-top", ins.top + "px");
    st.setProperty("--rd-left", ins.left + "px");
    st.setProperty("--rd-bottom", ins.bottom + "px");
    var cl = document.body.classList;
    cl.toggle("rd-en-session", enSession);
    cl.toggle("rd-tiroir", etat.drawer === "ouvert");
    // Le conteneur de l'image vient de changer de taille : on la recale.
    if (typeof window.__rdFit === "function") window.__rdFit();
  }

  function reglerTiroir(ouvert, rendre){
    memoriser({ drawer: ouvert ? "ouvert" : "ferme" });
    if (ouvert) resynchros.forEach(function(f){ try { f(); } catch (e) {} });
    appliquer();
    if (rendre) rendreFocus();
  }

  // Le poste distant, dans la barre haute (la place du futur « changer d'appareil »). Appele des que la
  // barre devient visible (appliquer) et a chaque tick : la pastille n'attend jamais le tick suivant.
  function majPair(){
    if (!monte) return;
    var id = window.curConn && window.curConn._id;
    var fmt = window.RDLib && window.RDLib.fmtId ? window.RDLib.fmtId(id) : String(id || "");
    if (pairIdEl.textContent !== fmt) pairIdEl.textContent = fmt;
    pairEl.hidden = !fmt;
  }

  // Resume en une ligne ; le detail (percentiles) reste dans le HUD, qui est conserve.
  function majStatut(){
    if (!monte) return;
    var RD = window.RD || {}, S = RD.stats || {}, c = actif(), t = Date.now(), ips = -1;
    majPair();
    if (statut.hidden){ mesure.t = 0; return; }
    if (mesure.t){
      var dt = (t - mesure.t) / 1000;
      if (dt > 0.2) ips = ((S.frames || 0) - mesure.frames) / dt;
    }
    mesure.frames = S.frames || 0; mesure.t = t;
    var segs = C.statut.segments({ codec: RD.codec, w: c && c.width, h: c && c.height, kbit: S.bitrate, fps: ips });
    var texte = segs.join(" / ");
    if (ligneEl.getAttribute("data-ligne") !== texte){
      ligneEl.setAttribute("data-ligne", texte);
      while (ligneEl.firstChild) ligneEl.removeChild(ligneEl.firstChild);
      segs.forEach(function(s){ ligneEl.appendChild(noeud("span", "rdseg", s)); });
    }
    // Sante de la liaison : mediane de l'aller-retour (la queue de la distribution reste dans le HUD).
    var P = window.__rdPct, rtt = (S.delay && S.delay.length && typeof P === "function") ? P(S.delay, 0.5) : NaN;
    var sante = C.statut.sante(rtt);
    lienEl.setAttribute("data-sante", sante);
    rttEl.textContent = isFinite(rtt) ? Math.round(rtt) + " ms" : "—";
    lienEl.title = (isFinite(rtt) ? "Aller-retour (médiane) : " + Math.round(rtt) + " ms — " : "") + C.statut.LIBELLE_SANTE[sante];
    var h = window.__rdHud;                         // message de reprise automatique, s'il y en a un
    etatEl.textContent = (h && h.__statut && h.__statut.textContent) || "";
  }

  // ------------------------------------------------------------- montage
  function pret(){
    return !!(document.body && document.getElementById("rdbar") &&
      ctl("resolution") && ctl("ajuster") && ctl("qualite") && ctl("cadence") && ctl("codec") && ctl("swap"));
  }

  function demonter(){
    try { if (observateur) observateur.disconnect(); } catch (e) {}
    try {
      var cl = document.body.classList;
      ["rd-console", "rd-en-session", "rd-tiroir"].forEach(function(c){ cl.remove(c); });
      document.body.removeAttribute("data-rd-theme");
      var st = document.documentElement.style;
      ["--rd-top", "--rd-left", "--rd-bottom"].forEach(function(p){ st.removeProperty(p); });
    } catch (e) {}
    // Remettre les controles dans la barre, dans leur ordre d'origine, avant le
    // premier enfant qui n'est pas le bouton vert du presse-papier.
    if (barre) {
      var ancre = barre.firstChild;
      while (ancre && ancre.className && String(ancre.className).indexOf("rdppbtn") >= 0) ancre = ancre.nextSibling;
      deplaces.forEach(function(d){
        try { d.n.removeAttribute("hidden"); d.parent.insertBefore(d.n, ancre); } catch (e) {}
      });
    }
    [tiroir, statut, btnSession, pairEl].forEach(function(n){ try { if (n && n.parentNode) n.parentNode.removeChild(n); } catch (e) {} });
    deplaces = []; resynchros = []; monte = false;
  }

  // Icone + libelle pour les boutons que cree le gabarit (Fichiers, Quitter). Purement cosmetique :
  // idempotent, et une erreur ici ne touche jamais au montage. Le libelle reste du texte (il est
  // masque a l'ecran sur un petit ecran, jamais retire de l'arbre d'accessibilite).
  function habiller(){
    try {
      [[".rdfilesbtn", "dossier"], [".quit", "quitter"]].forEach(function(p){
        var b = barre.querySelector(p[0]);
        if (!b || b.getAttribute("data-rdico")) return;
        var texte = b.textContent;
        b.textContent = "";
        b.appendChild(icone(p[1]));
        b.appendChild(noeud("span", "rdlbl", texte));
        b.setAttribute("data-rdico", "1");
      });
    } catch (e) { /* cosmetique */ }
  }

  function monter(){
    barre = document.getElementById("rdbar");
    try {
      // --- tiroir « Reglages de session »
      var sel = prendre("resolution"), fit = prendre("ajuster"), qual = prendre("qualite"),
          fps = prendre("cadence"), cod = prendre("codec"), swp = prendre("swap");
      var rd = window.RD || {};

      tiroir = noeud("aside"); tiroir.id = "rddrawer"; tiroir.hidden = true;
      tiroir.setAttribute("aria-label", "Réglages de session");
      var tete = noeud("div", "rdtete");
      tete.appendChild(noeud("b", null, "Réglages de session"));
      var fermer = noeud("button", "rdfermer");
      fermer.type = "button"; fermer.title = "Fermer les réglages";
      fermer.setAttribute("aria-label", "Fermer les réglages");
      fermer.appendChild(icone("fermer"));
      fermer.addEventListener("click", function(){ reglerTiroir(false, true); });
      tete.appendChild(fermer);
      tiroir.appendChild(tete);

      var corps = noeud("div", "rdcorps");
      corps.appendChild(section("secVideo", "Vidéo", "video", [
        ligne("Résolution distante", sel, "Mode d'affichage demandé au poste distant."),
        ligne("Ajuster à la fenêtre", fit, "Choisit la résolution la plus proche de la fenêtre."),
        ligne("Qualité", qual, "Équilibre netteté et débit."),
        ligne("Cadence max", fps, "Un plafond : le serveur décide de la cadence réelle."),
        ligne("Codec", cod, "Auto retient le décodage matériel quand il existe.")
      ]));
      corps.appendChild(section("secClavier", "Clavier", "clavier", [
        ligne("Ctrl devient Cmd", interrupteurSur(swp, function(){
          try { return window.localStorage.getItem("rd-swap-ctrl") !== "0"; } catch (e) { return true; }
        }, "swap"), "Actif : copier/coller comme sur macOS. Désactivé : Ctrl reste Ctrl (terminal).")
      ]));
      corps.appendChild(section("secSouris", "Souris", "souris", [
        ligne("Souris haute fréquence", interrupteur(rd.coalesce, function(on){
          if (typeof window.rdCoalesce === "function") window.rdCoalesce(on);
        }, "coalesce"), "Plus fidèle, mais consomme plus de débit sortant.")
      ]));
      corps.appendChild(section("secAffichage", "Affichage", "affichage", [
        ligne("Thème", segmente([["auto", "Auto"], ["clair", "Clair"], ["sombre", "Sombre"]], etat.theme, function(v){
          memoriser({ theme: v }); appliquer();
        }), "Auto suit le thème de votre système."),
        ligne("Barre de statut", interrupteur(etat.statut === "visible", function(on){
          memoriser({ statut: on ? "visible" : "masquee" }); appliquer();
        }, "statut"), "Résumé du flux en bas de l'écran.")
      ]));
      tiroir.appendChild(corps);

      // Echap ferme le tiroir SANS atteindre le poste distant (le canvas transmet
      // Echap) : le canvas ne reprend le clavier qu'apres le keyup (meme logique
      // que la barre). Un <select> garde Echap pour fermer sa liste.
      tiroir.addEventListener("keydown", function(ev){
        var tag = ev.target && String(ev.target.tagName || "").toUpperCase();
        if (ev.key !== "Escape" || tag === "SELECT") return;
        reglerTiroir(false, false);
        var rendre = function(e2){
          if (e2.key !== "Escape") return;
          document.removeEventListener("keyup", rendre, true);
          rendreFocus();
        };
        document.addEventListener("keyup", rendre, true);
        setTimeout(function(){ document.removeEventListener("keyup", rendre, true); }, 1600);
      });
      tiroir.addEventListener("click", function(ev){
        var tag = ev.target && String(ev.target.tagName || "").toUpperCase();
        if (tag === "SELECT" || tag === "OPTION" || tag === "INPUT" || tag === "SUMMARY") return;
        if (ev.target.closest && ev.target.closest(".rdsegmented")) return;   // un radiogroup garde le clavier
        rendreFocus();
      });

      // --- barre de statut
      statut = noeud("div"); statut.id = "rdstatut"; statut.hidden = true;
      lienEl = noeud("span", "rdlien");
      lienEl.setAttribute("data-sante", "inconnue");
      lienEl.appendChild(noeud("i", "rddot"));
      lienEl.lastChild.setAttribute("aria-hidden", "true");
      rttEl = noeud("span", "rdrtt", "—");
      lienEl.appendChild(rttEl);
      ligneEl = noeud("span", "rdst-ligne");
      ligneEl.setAttribute("aria-hidden", "true");     // releve continu : jamais annonce
      etatEl = noeud("span", "rdst-etat");
      etatEl.setAttribute("role", "status");
      statut.appendChild(lienEl); statut.appendChild(ligneEl); statut.appendChild(etatEl);

      // --- barre haute : bouton « Session » puis le poste distant
      btnSession = noeud("button", "rdsession");
      btnSession.type = "button";
      btnSession.setAttribute("data-rd", "session");
      btnSession.setAttribute("aria-controls", "rddrawer");
      btnSession.setAttribute("aria-expanded", "false");
      btnSession.title = "Réglages de la session";
      btnSession.appendChild(icone("reglages"));
      btnSession.appendChild(noeud("span", "rdlbl", "Session"));
      btnSession.addEventListener("click", function(){ reglerTiroir(etat.drawer !== "ouvert", true); });
      barre.insertBefore(btnSession, barre.firstChild);

      pairEl = noeud("span", "rdpair"); pairEl.hidden = true;
      pairEl.title = "Poste distant";
      pairEl.appendChild(icone("poste"));
      pairIdEl = noeud("span", "rdpair-id");
      pairEl.appendChild(pairIdEl);
      barre.insertBefore(pairEl, btnSession.nextSibling);

      document.body.appendChild(tiroir);
      document.body.appendChild(statut);

      if (typeof MutationObserver === "function") {
        // Le gabarit greffe .rdfilesbtn plus tard (sondage a 400 ms) : on l'habille a son arrivee.
        observateur = new MutationObserver(function(){ appliquer(); habiller(); });
        observateur.observe(barre, { attributes: true, attributeFilter: ["class", "style"], childList: true });
      } else {
        setInterval(function(){ appliquer(); habiller(); }, 700);
      }
      window.addEventListener("resize", appliquer);
      setInterval(majStatut, 1200);

      monte = true;
      document.body.classList.add("rd-console");     // en DERNIER : l'habillage n'existe qu'apres un montage reussi
      habiller();
      appliquer();
      try { majStatut(); } catch (e) { /* le poste distant s'affiche des le montage, pas 1,2 s apres */ }
      console.log("[console] montee — reglages dans le tiroir, barre de statut active");
    } catch (e) {
      console.warn("[console] montage abandonne, barre d'origine conservee :", e);
      demonter();
      renonce = true;
    }
  }

  // #rdbar est cree par le gabarit quand le bundle a affiche son interface :
  // on attend, sans jamais ecrire dans une page qui n'est pas prete.
  function tenter(){
    if (monte || renonce) return true;
    if (!pret()) return false;
    monter();
    return true;
  }
  if (!tenter()) {
    var attente = setInterval(function(){
      essais++;
      if (tenter() || essais > 400) clearInterval(attente);
    }, 650);
  }

  C.shell = {
    monte: function(){ return monte; },
    etat: function(){ return etat; },
    ouvrirTiroir: function(on){ if (monte) reglerTiroir(on !== false, false); }
  };
})();
