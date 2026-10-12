// Console de session : habille la barre #rdbar, ajoute le tiroir « Reglages de session » et la barre de statut,
// et offre aux autres modules un REGISTRE pour s'y brancher (lignes, boutons, fenetres flottantes).
//
// PRINCIPE — on ne recree aucun controle du gabarit. Les six controles tenus par closure (reperes data-rd=…)
// sont DEPLACES dans le tiroir : leurs gestionnaires, les reglages memorises (rd-prefs) et les references ui.*
// restent intacts. #rdbar reste la barre haute : le bouton vert du presse-papier (.rdppbtn), .rdfilesbtn, .quit
// et .rdhandle en restent des enfants DIRECTS (le gabarit les insere avec insertBefore).
//
// ISOLATION — si quoi que ce soit echoue au montage, tout est remis en place et la barre d'origine reste en
// service : la classe body.rd-console n'est posee qu'a la FIN d'un montage reussi. Une contribution de module qui
// echoue ne fait echouer ni le shell ni les autres (chacune est isolee dans un try/catch).
//
// DEMARRAGE — le shell ne demarre pas seul : 99-demarrage.js l'appelle APRES que tous les modules se sont
// enregistres (C.shell.demarrer()).
(function(){
  var C = window.RDConsole = window.RDConsole || {};
  var ui = C.ui, t = C.i18n.t, icone = ui.icone, noeud = ui.noeud, rendreFocus = ui.rendreFocus, actif = ui.actif;

  C.i18n.ajouter({
    fr: {
      "tiroir.titre": "Réglages de session", "tiroir.fermer": "Fermer les réglages",
      "bar.session": "Session", "bar.session.titre": "Réglages de la session", "pair.titre": "Poste distant",
      "sec.video": "Vidéo", "sec.audio": "Audio", "sec.clavier": "Clavier", "sec.souris": "Souris", "sec.affichage": "Affichage",
      "video.resolution": "Résolution distante", "video.resolution.aide": "Mode d'affichage demandé au poste distant.",
      "video.ajuster": "Ajuster à la fenêtre", "video.ajuster.aide": "Choisit la résolution la plus proche de la fenêtre.",
      "video.qualite": "Qualité", "video.qualite.aide": "Équilibre netteté et débit.",
      "video.cadence": "Cadence max", "video.cadence.aide": "Un plafond : le serveur décide de la cadence réelle.",
      "video.codec": "Codec", "video.codec.aide": "Auto retient le décodage matériel quand il existe.",
      "opt.qualite.balanced": "Équilibré", "opt.qualite.best": "Qualité", "opt.qualite.low": "Fluidité",
      "opt.fps": "{n} i/s max", "opt.codec.auto": "Codec auto", "opt.codec.h265": "H265", "opt.codec.vp9": "VP9", "opt.codec.logiciel": "Logiciel",
      "clavier.swap": "Ctrl devient Cmd", "clavier.swap.aide": "Actif : copier/coller comme sur macOS. Désactivé : Ctrl reste Ctrl (terminal).",
      "souris.hf": "Souris haute fréquence", "souris.hf.aide": "Plus fidèle, mais consomme plus de débit sortant.",
      "aff.theme": "Thème", "aff.theme.aide": "Auto suit le thème de votre système.",
      "theme.auto": "Auto", "theme.clair": "Clair", "theme.sombre": "Sombre",
      "aff.langue": "Langue", "aff.langue.aide": "Auto suit la langue du navigateur.",
      "langue.auto": "Auto", "langue.fr": "Français", "langue.en": "English",
      "aff.statut": "Barre de statut", "aff.statut.aide": "Résumé du flux en bas de l'écran.",
      "aff.plein": "Plein écran épuré", "aff.plein.aide": "En plein écran, masque le tiroir et la barre de statut.",
      "statut.relais": "Relais", "statut.relais.aide": "Ce client passe toujours par le relais du serveur.", "statut.direct": "Direct",
      "statut.chiffre": "Chiffré", "statut.nonchiffre": "Non chiffré",
      "sante.bonne": "liaison fluide", "sante.moyenne": "liaison correcte", "sante.mauvaise": "liaison lente", "sante.inconnue": "liaison non mesurée",
      "statut.rtt.titre": "Aller-retour (médiane) : {ms} ms",
      "indispo.version": "Exige RustDesk {min} ou plus récent sur le poste.", "indispo.plateforme": "Disponible sur {os} seulement."
    },
    en: {
      "tiroir.titre": "Session settings", "tiroir.fermer": "Close settings",
      "bar.session": "Session", "bar.session.titre": "Session settings", "pair.titre": "Remote machine",
      "sec.video": "Video", "sec.audio": "Audio", "sec.clavier": "Keyboard", "sec.souris": "Mouse", "sec.affichage": "Display",
      "video.resolution": "Remote resolution", "video.resolution.aide": "Display mode requested from the remote machine.",
      "video.ajuster": "Fit to window", "video.ajuster.aide": "Picks the resolution closest to the window.",
      "video.qualite": "Quality", "video.qualite.aide": "Balances sharpness and bandwidth.",
      "video.cadence": "Max frame rate", "video.cadence.aide": "A ceiling: the server decides the real rate.",
      "video.codec": "Codec", "video.codec.aide": "Auto picks hardware decoding when available.",
      "opt.qualite.balanced": "Balanced", "opt.qualite.best": "Quality", "opt.qualite.low": "Smoothness",
      "opt.fps": "{n} fps max", "opt.codec.auto": "Auto codec", "opt.codec.h265": "H265", "opt.codec.vp9": "VP9", "opt.codec.logiciel": "Software",
      "clavier.swap": "Ctrl becomes Cmd", "clavier.swap.aide": "On: copy/paste like macOS. Off: Ctrl stays Ctrl (terminal).",
      "souris.hf": "High-frequency mouse", "souris.hf.aide": "More accurate, but uses more upstream bandwidth.",
      "aff.theme": "Theme", "aff.theme.aide": "Auto follows your system theme.",
      "theme.auto": "Auto", "theme.clair": "Light", "theme.sombre": "Dark",
      "aff.langue": "Language", "aff.langue.aide": "Auto follows the browser language.",
      "langue.auto": "Auto", "langue.fr": "Français", "langue.en": "English",
      "aff.statut": "Status bar", "aff.statut.aide": "Stream summary at the bottom of the screen.",
      "aff.plein": "Clean full screen", "aff.plein.aide": "In full screen, hides the drawer and the status bar.",
      "statut.relais": "Relay", "statut.relais.aide": "This client always goes through the server relay.", "statut.direct": "Direct",
      "statut.chiffre": "Encrypted", "statut.nonchiffre": "Not encrypted",
      "sante.bonne": "smooth link", "sante.moyenne": "fair link", "sante.mauvaise": "slow link", "sante.inconnue": "link not measured",
      "statut.rtt.titre": "Round trip (median): {ms} ms",
      "indispo.version": "Requires RustDesk {min} or newer on the remote machine.", "indispo.plateforme": "Only available on {os}."
    }
  });

  var stockage = (function(){
    try { return C.store.create(window.localStorage); }
    catch (e) {
      return C.store.create({ getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} });
    }
  })();
  var etat = stockage.get();

  var monte = false, renonce = false, demarre = false, essais = 0;
  var barre = null, tiroir = null, statut = null, btnSession = null, pairEl = null, observateur = null;
  var tickStatut = null, tickObs = null;
  var deplaces = [], resynchros = [], elements = [], popovers = [], ecouteurs = [], internes = [];
  var ligneEl = null, tagsEl = null, etatEl = null, lienEl = null, rttEl = null, pairIdEl = null;
  var mesure = { frames: 0, t: 0 }, derniere = "";

  // ------------------------------------------------------------- registre
  // Les modules s'y inscrivent AVANT le montage ; chaque contribution est executee a l'interieur d'un try/catch.
  var registre = { lignes: {}, boutons: [], montages: [] };
  var SECTIONS = [["video", "video", 10], ["audio", "audio", 20], ["clavier", "clavier", 30], ["souris", "souris", 40], ["affichage", "affichage", 60]];
  function ajouterLigne(section, ordre, construire){
    (registre.lignes[section] = registre.lignes[section] || []).push({ ordre: ordre, construire: construire });
  }
  // { id, icone, libelle (cle i18n), titre (cle i18n), ordre, popover: function(contenu, pop, bouton) | surClic: function(ev, bouton) }
  function ajouterBouton(d){ registre.boutons.push(d); }
  function surMontage(f){ if (monte) { try { f(); } catch (e) { console.warn("[console]", e); } } else registre.montages.push(f); }

  function ctl(nom){ return document.querySelector('[data-rd="' + nom + '"]'); }
  function memoriser(patch){ stockage.set(patch); etat = stockage.get(); }

  // On NOTE d'ou vient un controle avant de le deplacer : si le montage echoue, demonter() le remet dans la barre.
  function prendre(nom){
    var n = ctl(nom);
    if (!n) throw new Error("controle introuvable : data-rd=" + nom);
    deplaces.push({ n: n, parent: n.parentNode });
    return n;
  }
  function section(cle, titreCle, icoNom, lignes){
    var d = noeud("details", "rdsec");
    var k = "sec" + cle.charAt(0).toUpperCase() + cle.slice(1);
    d.setAttribute("data-sec", k);
    d.open = etat[k] === "ouverte";
    var sm = noeud("summary");
    sm.appendChild(icone(icoNom));
    sm.appendChild(noeud("span", "rdsec-titre", t(titreCle)));
    d.appendChild(sm);
    var corps = noeud("div", "rdsec-corps");
    lignes.forEach(function(l){ corps.appendChild(l); });
    d.appendChild(corps);
    d.addEventListener("toggle", function(){
      var p = {}; p[k] = d.open ? "ouverte" : "fermee";
      memoriser(p);
    });
    return d;
  }
  // Un interrupteur qui PILOTE un bouton existant du gabarit : le bouton garde son gestionnaire (et sa memorisation),
  // l'interrupteur n'en est que la vue. L'etat se relit a la source, jamais d'apres le texte du bouton.
  function interrupteurSur(original, lire, pour){
    var cb = ui.interrupteur(lire(), function(){ original.click(); cb.checked = lire(); }, pour);
    original.setAttribute("hidden", "");
    var enveloppe = noeud("span", "rdsw-wrap");
    enveloppe.appendChild(original); enveloppe.appendChild(cb);
    resynchros.push(function(){ cb.checked = lire(); });
    return enveloppe;
  }
  // Les listes d'origine ont des libelles francais codes en dur dans le gabarit : on les traduit par VALEUR.
  function traduireOptions(sel, cle){
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i], v = o.value;
      var l = cle === "fps" ? t("opt.fps", { n: v }) : t("opt." + cle + "." + v);
      if (l && l.indexOf("opt.") !== 0) o.textContent = l;
    }
  }

  // ---------------------------------------------------------- mise en page
  function enPlein(){ try { return !!document.fullscreenElement; } catch (e) { return false; } }
  // Variables CSS lues par console.css (conteneur #canvas, HUD, panneau de fichiers) : l'image se cale entre les barres.
  function appliquer(){
    if (!monte) return;
    var d = barre.style.display;                    // le veilleur du gabarit pose flex / none
    var enSession = d !== "" && d !== "none";
    var plein = enPlein(), epure = plein && etat.plein === "masquees";
    var kb = (enSession && etat.clavierV === "ouvert" && C.vkb) ? C.vkb.hauteur() : 0;
    var ins = C.layout.insets({
      enSession: enSession, barre: barre.classList.contains("replie") ? "repliee" : "ouverte",
      drawer: etat.drawer, statut: etat.statut, largeur: window.innerWidth, plein: plein, pleinMasque: etat.plein === "masquees",
      clavier: kb
    });
    if (C.vkb) C.vkb.afficher(enSession && etat.clavierV === "ouvert");
    tiroir.hidden = !(enSession && etat.drawer === "ouvert" && !epure);
    statut.hidden = !(enSession && etat.statut === "visible" && !epure);
    btnSession.setAttribute("aria-expanded", etat.drawer === "ouvert" ? "true" : "false");
    var corps = document.body;
    corps.setAttribute("data-rd-theme", etat.theme);
    corps.setAttribute("data-rd-vue", etat.vue);
    if (enSession) majPair();
    var cle = [enSession, ins.top, ins.left, ins.bottom, ins.statutBas, etat.drawer, etat.statut, plein, etat.vue].join("|");
    if (cle === derniere) return;                   // le veilleur reecrit style 1 fois / 800 ms : rien a refaire
    derniere = cle;
    var st = document.documentElement.style;
    st.setProperty("--rd-top", ins.top + "px");
    st.setProperty("--rd-left", ins.left + "px");
    st.setProperty("--rd-bottom", ins.bottom + "px");
    st.setProperty("--rd-statut-bas", ins.statutBas + "px");
    var cl = corps.classList;
    cl.toggle("rd-en-session", enSession);
    cl.toggle("rd-tiroir", etat.drawer === "ouvert");
    cl.toggle("rd-plein", plein);
    // Le conteneur de l'image vient de changer de taille : on la recale.
    if (typeof window.__rdFit === "function") window.__rdFit();
  }

  function reglerTiroir(ouvert, rendre){
    memoriser({ drawer: ouvert ? "ouvert" : "ferme" });
    if (ouvert) resynchros.forEach(function(f){ try { f(); } catch (e) {} });
    appliquer();
    if (rendre) rendreFocus();
  }

  // Le poste distant, dans la barre haute (la place du futur « changer d'appareil »). Appele des que la barre
  // devient visible (appliquer) et a chaque tick : la pastille n'attend jamais le tick suivant.
  function majPair(){
    if (!monte) return;
    var id = window.curConn && window.curConn._id;
    var fmt = window.RDLib && window.RDLib.fmtId ? window.RDLib.fmtId(id) : String(id || "");
    if (pairIdEl.textContent !== fmt) pairIdEl.textContent = fmt;
    pairEl.hidden = !fmt;
  }

  function etiquette(cls, texte, titre){
    var e = noeud("span", "rdtag " + cls, texte);
    if (titre) e.title = titre;
    return e;
  }
  // Resume en une ligne ; le detail (percentiles) reste dans le HUD, qui est conserve.
  function majStatut(){
    if (!monte) return;
    var RD = window.RD || {}, S = RD.stats || {}, c = actif(), tt = Date.now(), ips = -1;
    majPair();
    if (statut.hidden){ mesure.t = 0; return; }
    if (mesure.t){
      var dt = (tt - mesure.t) / 1000;
      if (dt > 0.2) ips = ((S.frames || 0) - mesure.frames) / dt;
    }
    mesure.frames = S.frames || 0; mesure.t = tt;
    var segs = C.statut.segments({ codec: RD.codec, w: c && c.width, h: c && c.height, kbit: S.bitrate, fps: ips });
    var texte = segs.join(" / ");
    if (ligneEl.getAttribute("data-ligne") !== texte){
      ligneEl.setAttribute("data-ligne", texte);
      while (ligneEl.firstChild) ligneEl.removeChild(ligneEl.firstChild);
      segs.forEach(function(s){ ligneEl.appendChild(noeud("span", "rdseg", s)); });
    }
    // Liaison : ce client passe toujours par le relais ; « chiffre » vient de connection_ready (inconnu avant).
    var pe = C.poste.etat(), cleTags = pe.direct + "|" + pe.chiffre + "|" + C.i18n.langue();
    if (tagsEl.getAttribute("data-cle") !== cleTags) {
      tagsEl.setAttribute("data-cle", cleTags);
      while (tagsEl.firstChild) tagsEl.removeChild(tagsEl.firstChild);
      tagsEl.appendChild(etiquette("rdtag-relais", t(pe.direct ? "statut.direct" : "statut.relais"), t("statut.relais.aide")));
      if (pe.chiffre === true) tagsEl.appendChild(etiquette("rdtag-ok", t("statut.chiffre")));
      else if (pe.chiffre === false) tagsEl.appendChild(etiquette("rdtag-alerte", t("statut.nonchiffre")));
    }
    // Sante de la liaison : mediane de l'aller-retour (la queue de la distribution reste dans le HUD).
    var P = window.__rdPct, rtt = (S.delay && S.delay.length && typeof P === "function") ? P(S.delay, 0.5) : NaN;
    var sante = C.statut.sante(rtt);
    lienEl.setAttribute("data-sante", sante);
    rttEl.textContent = isFinite(rtt) ? Math.round(rtt) + " ms" : "—";
    lienEl.title = (isFinite(rtt) ? t("statut.rtt.titre", { ms: Math.round(rtt) }) + " — " : "") + t("sante." + sante);
    var h = window.__rdHud;                         // message de reprise automatique, s'il y en a un
    etatEl.textContent = (h && h.__statut && h.__statut.textContent) || "";
  }

  // ------------------------------------------------------------- montage
  function pret(){
    return !!(document.body && document.getElementById("rdbar") &&
      ctl("resolution") && ctl("ajuster") && ctl("qualite") && ctl("cadence") && ctl("codec") && ctl("swap"));
  }
  function ecouter(cible, type, f, opts){ cible.addEventListener(type, f, opts); ecouteurs.push([cible, type, f, opts]); }

  function demonter(){
    try { if (observateur) observateur.disconnect(); } catch (e) {}
    try { if (tickStatut) clearInterval(tickStatut); if (tickObs) clearInterval(tickObs); } catch (e) {}
    tickStatut = tickObs = null;
    ecouteurs.forEach(function(x){ try { x[0].removeEventListener(x[1], x[2], x[3]); } catch (e) {} });
    ecouteurs = [];
    try {
      var cl = document.body.classList;
      ["rd-console", "rd-en-session", "rd-tiroir", "rd-plein"].forEach(function(c){ cl.remove(c); });
      document.body.removeAttribute("data-rd-theme"); document.body.removeAttribute("data-rd-vue");
      var st = document.documentElement.style;
      ["--rd-top", "--rd-left", "--rd-bottom", "--rd-statut-bas"].forEach(function(p){ st.removeProperty(p); });
    } catch (e) {}
    // Remettre les controles dans la barre, dans leur ordre d'origine, avant le premier enfant qui n'est pas le bouton vert.
    if (barre) {
      var ancre = barre.firstChild;
      while (ancre && ancre.className && String(ancre.className).indexOf("rdppbtn") >= 0) ancre = ancre.nextSibling;
      deplaces.forEach(function(d){
        try { d.n.removeAttribute("hidden"); d.parent.insertBefore(d.n, ancre); } catch (e) {}
      });
    }
    [tiroir, statut, btnSession, pairEl].concat(elements, popovers.map(function(p){ return p.el; })).forEach(function(n){
      try { if (n && n.parentNode) n.parentNode.removeChild(n); } catch (e) {}
    });
    // Les boutons du gabarit ont ete habilles : on leur rend leur texte nu.
    try {
      [".rdfilesbtn", ".quit"].forEach(function(s){
        var b = barre && barre.querySelector(s);
        if (b && b.getAttribute("data-rdico")) {
          var l = b.querySelector(".rdlbl"), tx = l ? l.textContent : b.textContent;
          b.textContent = tx; b.removeAttribute("data-rdico");
        }
      });
    } catch (e) {}
    deplaces = []; resynchros = []; elements = []; popovers = []; monte = false;
  }

  // Icone + libelle pour les boutons que cree le gabarit (Fichiers, Quitter). Purement cosmetique : idempotent, et une
  // erreur ici ne touche jamais au montage. Le libelle reste du texte (masque a l'ecran sur un petit ecran, jamais retire
  // de l'arbre d'accessibilite).
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

  function construireLignes(cle){
    var res = [];
    (registre.lignes[cle] || []).slice().sort(function(a, b){ return a.ordre - b.ordre; }).forEach(function(c){
      try {
        var l = c.construire({ etat: etat, memoriser: memoriser, appliquer: appliquer, resynchros: resynchros });
        if (l) res.push(l);
      } catch (e) { console.warn("[console] ligne « " + cle + " » abandonnee :", e); }
    });
    return res;
  }
  // Les lignes du shell capturent les noeuds deplaces : elles se re-inscrivent a chaque montage et se retirent au demontage.
  function ajouterLigneInterne(sec, ordre, construire){
    internes.push({ section: sec, construire: construire });
    ajouterLigne(sec, ordre, construire);
  }
  function purgerInternes(){
    internes.forEach(function(i){
      var l = registre.lignes[i.section] || [];
      for (var k = 0; k < l.length; k++) if (l[k].construire === i.construire) { l.splice(k, 1); break; }
    });
    internes = [];
  }

  function monter(){
    barre = document.getElementById("rdbar");
    try {
      C.i18n.definir(etat.langue);
      var sel = prendre("resolution"), fit = prendre("ajuster"), qual = prendre("qualite"),
          fps = prendre("cadence"), cod = prendre("codec"), swp = prendre("swap");
      var rd = window.RD || {};
      traduireOptions(qual, "qualite"); traduireOptions(fps, "fps"); traduireOptions(cod, "codec");

      // --- lignes d'origine (les controles du gabarit, deplaces) et celles du shell
      ajouterLigneInterne("video", 10, function(){ return ui.ligne(t("video.resolution"), sel, t("video.resolution.aide")); });
      ajouterLigneInterne("video", 20, function(){ return ui.ligne(t("video.ajuster"), fit, t("video.ajuster.aide")); });
      ajouterLigneInterne("video", 30, function(){ return ui.ligne(t("video.qualite"), qual, t("video.qualite.aide")); });
      ajouterLigneInterne("video", 40, function(){ return ui.ligne(t("video.cadence"), fps, t("video.cadence.aide")); });
      ajouterLigneInterne("video", 50, function(){ return ui.ligne(t("video.codec"), cod, t("video.codec.aide")); });
      ajouterLigneInterne("clavier", 10, function(){
        return ui.ligne(t("clavier.swap"), interrupteurSur(swp, function(){
          try { return window.localStorage.getItem("rd-swap-ctrl") !== "0"; } catch (e) { return true; }
        }, "swap"), t("clavier.swap.aide"));
      });
      ajouterLigneInterne("souris", 10, function(){
        return ui.ligne(t("souris.hf"), ui.interrupteur(rd.coalesce, function(on){
          if (typeof window.rdCoalesce === "function") window.rdCoalesce(on);
        }, "coalesce"), t("souris.hf.aide"));
      });
      ajouterLigneInterne("affichage", 10, function(){
        return ui.ligne(t("aff.theme"), ui.segmente([["auto", t("theme.auto")], ["clair", t("theme.clair")], ["sombre", t("theme.sombre")]], etat.theme, function(v){
          memoriser({ theme: v }); appliquer();
        }), t("aff.theme.aide"));
      });
      ajouterLigneInterne("affichage", 20, function(){
        return ui.ligne(t("aff.langue"), ui.segmente([["auto", t("langue.auto")], ["fr", t("langue.fr")], ["en", t("langue.en")]], etat.langue, function(v){
          memoriser({ langue: v });
          setTimeout(function(){ C.i18n.definir(v); }, 0);       // reconstruit la console dans la nouvelle langue (cf. surChangement)
        }), t("aff.langue.aide"));
      });
      ajouterLigneInterne("affichage", 30, function(){
        return ui.ligne(t("aff.statut"), ui.interrupteur(etat.statut === "visible", function(on){
          memoriser({ statut: on ? "visible" : "masquee" }); appliquer();
        }, "statut"), t("aff.statut.aide"));
      });
      ajouterLigneInterne("affichage", 40, function(){
        return ui.ligne(t("aff.plein"), ui.interrupteur(etat.plein === "masquees", function(on){
          memoriser({ plein: on ? "masquees" : "barres" }); appliquer();
        }, "plein"), t("aff.plein.aide"));
      });

      // --- tiroir « Reglages de session »
      tiroir = noeud("aside"); tiroir.id = "rddrawer"; tiroir.hidden = true;
      tiroir.setAttribute("aria-label", t("tiroir.titre"));
      var tete = noeud("div", "rdtete");
      tete.appendChild(noeud("b", null, t("tiroir.titre")));
      var fermer = noeud("button", "rdfermer");
      fermer.type = "button"; fermer.title = t("tiroir.fermer");
      fermer.setAttribute("aria-label", t("tiroir.fermer"));
      fermer.appendChild(icone("fermer"));
      fermer.addEventListener("click", function(){ reglerTiroir(false, true); });
      tete.appendChild(fermer);
      tiroir.appendChild(tete);

      var corps = noeud("div", "rdcorps");
      SECTIONS.forEach(function(s){
        var lignes = construireLignes(s[0]);
        if (lignes.length) corps.appendChild(section(s[0], "sec." + s[0], s[1], lignes));
      });
      tiroir.appendChild(corps);

      // Echap ferme le tiroir SANS atteindre le poste distant (le canvas transmet Echap) : le canvas ne reprend le clavier
      // qu'apres le keyup (meme logique que la barre). Un <select> garde Echap pour fermer sa liste.
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
      tagsEl = noeud("span", "rdtags");
      etatEl = noeud("span", "rdst-etat");
      etatEl.setAttribute("role", "status");
      statut.appendChild(lienEl); statut.appendChild(ligneEl); statut.appendChild(tagsEl); statut.appendChild(etatEl);

      // --- barre haute : bouton « Session », le poste distant, puis les boutons des modules
      btnSession = noeud("button", "rdsession");
      btnSession.type = "button";
      btnSession.setAttribute("data-rd", "session");
      btnSession.setAttribute("aria-controls", "rddrawer");
      btnSession.setAttribute("aria-expanded", "false");
      btnSession.title = t("bar.session.titre");
      btnSession.appendChild(icone("reglages"));
      btnSession.appendChild(noeud("span", "rdlbl", t("bar.session")));
      btnSession.addEventListener("click", function(){ reglerTiroir(etat.drawer !== "ouvert", true); });
      barre.insertBefore(btnSession, barre.firstChild);

      pairEl = noeud("span", "rdpair"); pairEl.hidden = true;
      pairEl.title = t("pair.titre");
      pairEl.appendChild(icone("poste"));
      pairIdEl = noeud("span", "rdpair-id");
      pairEl.appendChild(pairIdEl);
      barre.insertBefore(pairEl, btnSession.nextSibling);

      var apres = pairEl.nextSibling;
      registre.boutons.slice().sort(function(a, b){ return a.ordre - b.ordre; }).forEach(function(d){
        try {
          var b = noeud("button", "rdtool");
          b.type = "button"; b.setAttribute("data-rd", d.id);
          b.title = t(d.titre || d.libelle);
          b.style.order = String(d.ordre);
          b.appendChild(icone(d.icone));
          b.appendChild(noeud("span", "rdlbl", t(d.libelle)));
          if (d.popover) {
            var pop = ui.popover("rdpop-" + d.id, t(d.titre || d.libelle), "rdpop-" + d.id);
            b.setAttribute("aria-haspopup", "dialog"); b.setAttribute("aria-expanded", "false");
            b.setAttribute("aria-controls", pop.el.id);
            d.popover(pop.el, pop, b);
            b.addEventListener("click", function(){ pop.basculer(b); });
            document.body.appendChild(pop.el); popovers.push(pop);
          } else {
            b.addEventListener("click", function(ev){ d.surClic(ev, b); });
          }
          barre.insertBefore(b, apres);
          elements.push(b);
          if (d.cree) d.cree(b);
        } catch (e) { console.warn("[console] bouton « " + d.id + " » abandonne :", e); }
      });

      document.body.appendChild(tiroir);
      document.body.appendChild(statut);

      if (typeof MutationObserver === "function") {
        // Le gabarit greffe .rdfilesbtn plus tard (sondage a 400 ms) : on l'habille a son arrivee.
        observateur = new MutationObserver(function(){ appliquer(); habiller(); });
        observateur.observe(barre, { attributes: true, attributeFilter: ["class", "style"], childList: true });
      } else {
        tickObs = setInterval(function(){ appliquer(); habiller(); }, 700);
      }
      ecouter(window, "resize", appliquer);
      ecouter(document, "fullscreenchange", appliquer);
      tickStatut = setInterval(majStatut, 1200);
      C.poste.surChangement(function(){ if (monte) majStatut(); });

      monte = true;
      document.body.classList.add("rd-console");     // en DERNIER : l'habillage n'existe qu'apres un montage reussi
      habiller();
      appliquer();
      try { majStatut(); } catch (e) { /* le poste distant s'affiche des le montage, pas 1,2 s apres */ }
      registre.montages.slice().forEach(function(f){ try { f(); } catch (e) { console.warn("[console]", e); } });
      console.log("[console] montee — reglages dans le tiroir, barre de statut active");
    } catch (e) {
      console.warn("[console] montage abandonne, barre d'origine conservee :", e);
      demonter(); purgerInternes();
      renonce = true;
    }
  }

  // Changement de langue : la console se reconstruit (le DOM seulement, jamais la session).
  function remonter(){
    if (!monte) return;
    demonter(); purgerInternes();
    renonce = false; derniere = "";
    monter();
    if (monte) { etat = stockage.get(); appliquer(); }
  }
  C.i18n.surChangement(function(){ remonter(); });

  // #rdbar est cree par le gabarit quand le bundle a affiche son interface : on attend, sans jamais ecrire dans une page
  // qui n'est pas prete.
  function tenter(){
    if (monte || renonce) return true;
    if (!pret()) return false;
    monter();
    return true;
  }
  function demarrer(){
    if (demarre) return;
    demarre = true;
    C.i18n.definir(etat.langue);
    if (!tenter()) {
      var attente = setInterval(function(){
        essais++;
        if (tenter() || essais > 400) clearInterval(attente);
      }, 650);
    }
  }

  C.shell = {
    demarrer: demarrer,
    monte: function(){ return monte; },
    etat: function(){ return etat; },
    memoriser: memoriser, appliquer: appliquer,
    ajouterLigne: ajouterLigne, ajouterBouton: ajouterBouton, surMontage: surMontage,
    ouvrirTiroir: function(on){ if (monte) reglerTiroir(on !== false, false); },
    barre: function(){ return barre; }
  };
})();
