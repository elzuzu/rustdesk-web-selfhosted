// Le poste distant : actions (Ctrl+Alt+Suppr, verrouiller, redemarrer), ecrans, options du pair, son, plein ecran.
//
// Tout passe par ce que le bundle sait DEJA faire (setByName « ctrl_alt_del », « lock_screen », « switch_display »,
// « toggle_option ») — seul le redemarrage, absent du pont, part en message brut (window.__rdSend). Une fonction que
// ce poste ne supporte pas reste visible, grisee, avec la raison ; jamais cachee, jamais une erreur muette.
(function(){
  var C = window.RDConsole = window.RDConsole || {};
  var ui = C.ui, t = C.i18n.t, noeud = ui.noeud, pur = C.input;

  C.i18n.ajouter({
    fr: {
      "bar.poste": "Poste", "bar.poste.titre": "Actions sur le poste distant",
      "poste.actions": "Actions", "poste.cad": "Ctrl+Alt+Suppr", "poste.cad.aide": "Ouvre l'écran de sécurité du poste.",
      "poste.verrou": "Verrouiller l'écran", "poste.redemarrer": "Redémarrer le poste", "poste.redemarrer.confirmer": "Confirmer le redémarrage",
      "poste.redemarrage.envoye": "Redémarrage demandé au poste.", "poste.echec": "Envoi impossible : la session n'est pas prête.",
      "poste.ecrans": "Écran", "poste.ecran.n": "Écran {n}", "poste.ecran.courant": "affiché",
      "poste.options": "Options du poste",
      "poste.confidentialite": "Mode confidentialité", "poste.confidentialite.aide": "Masque l'écran du poste pendant la session.",
      "poste.bloquer": "Bloquer les entrées du poste", "poste.bloquer.aide": "Désactive le clavier et la souris physiques du poste.",
      "poste.verrou.fin": "Verrouiller à la fin", "poste.verrou.fin.aide": "Verrouille le poste quand la session se termine.",
      "poste.cbp": "Presse-papier partagé", "poste.cbp.aide": "Désactivé : rien n'est copié, dans aucun sens.",
      "poste.sync": "Presse-papier automatique", "poste.sync.aide": "Ce que vous copiez ici part au poste dès votre retour sur la page : Ctrl+V colle sans attendre.",
      "poste.curseur": "Curseur dans l'image", "poste.curseur.aide": "Dessine le curseur du poste dans le flux vidéo.",
      "audio.son": "Son du poste", "audio.son.aide": "Désactivé : le poste n'envoie plus d'audio (économise du débit).",
      "bar.plein": "Plein écran", "bar.plein.sortir": "Quitter le plein écran"
    },
    en: {
      "bar.poste": "Machine", "bar.poste.titre": "Actions on the remote machine",
      "poste.actions": "Actions", "poste.cad": "Ctrl+Alt+Del", "poste.cad.aide": "Opens the machine's security screen.",
      "poste.verrou": "Lock screen", "poste.redemarrer": "Restart machine", "poste.redemarrer.confirmer": "Confirm restart",
      "poste.redemarrage.envoye": "Restart requested.", "poste.echec": "Cannot send: the session is not ready.",
      "poste.ecrans": "Display", "poste.ecran.n": "Display {n}", "poste.ecran.courant": "shown",
      "poste.options": "Machine options",
      "poste.confidentialite": "Privacy mode", "poste.confidentialite.aide": "Blanks the machine's screen during the session.",
      "poste.bloquer": "Block the machine's input", "poste.bloquer.aide": "Disables the machine's physical keyboard and mouse.",
      "poste.verrou.fin": "Lock at session end", "poste.verrou.fin.aide": "Locks the machine when the session ends.",
      "poste.cbp": "Shared clipboard", "poste.cbp.aide": "Off: nothing is copied, in either direction.",
      "poste.sync": "Automatic clipboard", "poste.sync.aide": "What you copy here is sent to the machine as soon as you return to the page: Ctrl+V pastes without waiting.",
      "poste.curseur": "Cursor in the image", "poste.curseur.aide": "Draws the machine's cursor into the video stream.",
      "audio.son": "Machine sound", "audio.son.aide": "Off: the machine stops sending audio (saves bandwidth).",
      "bar.plein": "Full screen", "bar.plein.sortir": "Exit full screen"
    }
  });

  function toast(cle, niveau){ if (typeof window.__rdToast === "function") { try { window.__rdToast(t(cle), niveau || "info"); } catch (e) {} } }
  // Envoi par le pont du bundle. Vrai si le pont a accepte l'ordre (la session peut malgre tout l'ignorer).
  function pont(nom, arg){
    try { if (typeof window.setByName !== "function") return false; window.setByName(nom, arg == null ? "" : arg); return true; }
    catch (e) { console.warn("[poste]", nom, e); return false; }
  }
  function infoPoste(){ return C.poste.info(); }
  function bascule(nom){ return pont("toggle_option", nom); }
  // L'etat d'une option : la page le tient de la REPONSE du pair (web/src/30-session.js, pairFiltrer) — le mode
  // confidentialite et le blocage de saisie ne sont coches que si le poste les a acceptes. Sans la page (banc, page en
  // panne), on retombe sur ce que le bundle memorise, et sur le dernier ordre envoye pour le blocage.
  function page(){ var P = window.__rdPoste; return P && typeof P.optionActive === "function" ? P : null; }
  function optionActive(nom){
    var P = page();
    if (P) { try { return !!P.optionActive(nom); } catch (e) {} }
    return nom === "block-input" ? !!etatLocal.bloque : C.poste.option(nom);
  }

  function bouton(libelle, auClic, icoNom){ return ui.bouton(libelle, auClic, icoNom, "rdbtn"); }
  function entete(texte){ return noeud("h3", "rdpop-titre", texte); }

  // ------------------------------------------------------------- fenetre « Poste »
  function construirePoste(el){
    var pi = infoPoste(), corps = noeud("div", "rdpop-corps");
    el.appendChild(entete(t("bar.poste.titre")));
    el.appendChild(corps);
    var rendu = function(){
      while (corps.firstChild) corps.removeChild(corps.firstChild);
      var info = infoPoste(), pe = C.poste.etat();

      // --- actions
      var actions = noeud("div", "rdpop-actions");
      var cad = bouton(t("poste.cad"), function(){ if (!pont("ctrl_alt_del")) toast("poste.echec", "erreur"); }, "cadenas");
      var sCad = pur.supporte("ctrlAltSuppr", info.version, info.plateforme);
      if (!sCad.ok) { cad.disabled = true; cad.title = t(sCad.cle, sCad.params); cad.setAttribute("data-indisponible", "1"); } else cad.title = t("poste.cad.aide");
      var verrou = bouton(t("poste.verrou"), function(){ if (!pont("lock_screen")) toast("poste.echec", "erreur"); }, "cadenas");
      var redem = bouton(t("poste.redemarrer"), function(ev, b){
        // Deux temps : une action destructrice ne part jamais sur un seul clic.
        if (b.getAttribute("data-confirme") !== "1") {
          b.setAttribute("data-confirme", "1"); b.classList.add("rdbtn-danger");
          b.querySelector(".rdlbl").textContent = t("poste.redemarrer.confirmer");
          var retour = setTimeout(function(){ if (b.isConnected) { b.removeAttribute("data-confirme"); b.classList.remove("rdbtn-danger"); b.querySelector(".rdlbl").textContent = t("poste.redemarrer"); } }, 6000);
          b.__retour = retour; return;
        }
        clearTimeout(b.__retour); b.removeAttribute("data-confirme"); b.classList.remove("rdbtn-danger");
        b.querySelector(".rdlbl").textContent = t("poste.redemarrer");
        var ok = typeof window.__rdSend === "function" && window.__rdSend({ misc: { restart_remote_device: true } });
        toast(ok ? "poste.redemarrage.envoye" : "poste.echec", ok ? "info" : "erreur");
        if (ok) { var p = el.__pop; if (p) p.fermer(); }
      }, "alimentation");
      redem.setAttribute("data-action", "redemarrer");
      cad.setAttribute("data-action", "cad"); verrou.setAttribute("data-action", "verrou");
      actions.appendChild(cad); actions.appendChild(verrou); actions.appendChild(redem);
      corps.appendChild(noeud("h4", "rdpop-sous", t("poste.actions")));
      corps.appendChild(actions);

      // --- ecrans (seulement si le poste en a plusieurs)
      if (pe.ecrans.length > 1) {
        corps.appendChild(noeud("h4", "rdpop-sous", t("poste.ecrans")));
        var liste = noeud("div", "rdpop-ecrans");
        liste.setAttribute("role", "radiogroup"); liste.setAttribute("aria-label", t("poste.ecrans"));
        pe.ecrans.forEach(function(e){
          var b = noeud("button", "rdecran");
          b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("data-ecran", String(e.index));
          var on = e.index === pe.courant;
          b.setAttribute("aria-checked", on ? "true" : "false");
          b.appendChild(ui.icone("ecran"));
          b.appendChild(noeud("span", "rdecran-nom", t("poste.ecran.n", { n: e.index + 1 }) + (e.nom ? " — " + e.nom : "")));
          b.appendChild(noeud("span", "rdecran-dim", e.w + "×" + e.h));
          b.addEventListener("click", function(){ if (e.index !== C.poste.etat().courant) pont("switch_display", e.index); });
          liste.appendChild(b);
        });
        corps.appendChild(liste);
      }

      // --- options du poste (etat relu a la source ; « bloquer » n'est pas memorise par le bundle : etat de la session)
      corps.appendChild(noeud("h4", "rdpop-sous", t("poste.options")));
      var opts = noeud("div", "rdopts");
      function option(cle, aideCle, nom, lire, ecrire, gate){
        var cb = ui.interrupteur(lire(), function(on){ ecrire(on); cb.checked = lire(); }, nom);
        var l = ui.ligne(t(cle), cb, t(aideCle));
        if (gate && !gate.ok) ui.grise(l, t(gate.cle, gate.params));
        opts.appendChild(l);
      }
      option("poste.confidentialite", "poste.confidentialite.aide", "privacy-mode",
        function(){ return optionActive("privacy-mode"); }, function(){ bascule("privacy-mode"); }, pur.supporte("confidentialite", info.version, info.plateforme));
      // Deux ordres distincts (le bundle n'a pas de bascule) ; l'ordre depend de l'etat CONFIRME, pas de l'interrupteur.
      option("poste.bloquer", "poste.bloquer.aide", "block-input",
        function(){ return optionActive("block-input"); },
        function(){ var bloque = optionActive("block-input"); etatLocal.bloque = !bloque; bascule(bloque ? "unblock-input" : "block-input"); });
      option("poste.verrou.fin", "poste.verrou.fin.aide", "lock-after-session-end",
        function(){ return optionActive("lock-after-session-end"); }, function(){ bascule("lock-after-session-end"); });
      option("poste.cbp", "poste.cbp.aide", "disable-clipboard",
        function(){ return !optionActive("disable-clipboard"); }, function(){ bascule("disable-clipboard"); });
      // Presse-papier automatique (local vers distant) : une fonction de la page, proposee seulement la ou le navigateur
      // sait lire le presse-papier. La bascule est asynchrone (demande de permission) : la fenetre se redessine apres.
      var P = page();
      if (P && typeof P.syncPossible === "function" && P.syncPossible()) {
        option("poste.sync", "poste.sync.aide", "clipboard-sync",
          function(){ return !!P.syncActif(); },
          function(){ try { P.basculerSync(); } catch (e) { console.warn("[poste]", e); } });
      }
      option("poste.curseur", "poste.curseur.aide", "show-remote-cursor",
        function(){ return optionActive("show-remote-cursor"); }, function(){ bascule("show-remote-cursor"); });
      corps.appendChild(opts);
    };
    el.__rendre = rendu;
    rendu();
  }
  var etatLocal = { bloque: false };

  // La page redessine son menu Actions (window.__rdActions) chaque fois que l'etat d'une option change — reponse du pair,
  // presse-papier automatique accorde ou refuse. On s'y accroche : la fenetre « Poste » ouverte suit le meme signal.
  C.shell.surMontage(function(){
    var o = window.__rdActions;
    if (typeof o !== "function" || o.__rdConsole) return;
    var w = function(){ var r = o.apply(this, arguments); try { C.poste.signaler(); } catch (e) {} return r; };
    w.__rdConsole = true;
    window.__rdActions = w;
  });

  C.shell.ajouterBouton({
    id: "poste", icone: "alimentation", libelle: "bar.poste", titre: "bar.poste.titre", ordre: 11,
    popover: function(el, pop){
      el.__pop = pop;
      construirePoste(el);
      // L'etat du poste change entre deux ouvertures (ecrans, plateforme apres peer_info) : on redessine a l'ouverture.
      el.addEventListener("beforetoggle", function(ev){ if (ev.newState === "open" && el.__rendre) el.__rendre(); });
      C.poste.surChangement(function(){ if (pop.estOuvert() && el.__rendre) el.__rendre(); });
    }
  });

  // --- Audio : « Son du poste » = option disable-audio (le poste n'envoie plus l'audio)
  C.shell.ajouterLigne("audio", 10, function(){
    var cb = ui.interrupteur(!optionActive("disable-audio"), function(){ bascule("disable-audio"); cb.checked = !optionActive("disable-audio"); }, "son");
    return ui.ligne(t("audio.son"), cb, t("audio.son.aide"));
  });

  // ------------------------------------------------------------- plein ecran
  // Le plein ecran + « Keyboard Lock » : le navigateur cesse de garder Cmd/Ctrl+W, Ctrl+T, Echap… et les transmet a la page,
  // donc au poste distant. Echap maintenu sort du plein ecran (comportement du navigateur). Chromium seulement : ailleurs,
  // le plein ecran marche sans le verrou.
  //
  // C'est la PAGE qui le fait (son bouton, repere data-rd="plein-page") : elle demande le plein ecran, capture le clavier
  // a l'evenement fullscreenchange, previent l'utilisateur et recale l'image. Le bouton de la console ne fait que cliquer
  // dessus ; deux captures concurrentes s'annuleraient (un second lock() rejette le premier). Le code ci-dessous ne sert
  // que si ce bouton manque.
  function boutonPage(){ return document.querySelector('[data-rd="plein-page"]'); }
  function pleinEcran(){ try { return !!document.fullscreenElement; } catch (e) { return false; } }
  function verrouClavier(on){
    try {
      var k = window.navigator && window.navigator.keyboard;
      if (!k) return;
      if (on && typeof k.lock === "function") { var p = k.lock(); if (p && p.catch) p.catch(function(){}); }
      else if (!on && typeof k.unlock === "function") k.unlock();
    } catch (e) { /* non supporte */ }
  }
  function basculerPlein(){
    var bp = boutonPage();
    if (bp) { bp.click(); return; }
    try {
      if (pleinEcran()) { var s = document.exitFullscreen && document.exitFullscreen(); if (s && s.catch) s.catch(function(){}); }
      else { var r = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (r && r.then) r.then(function(){ verrouClavier(true); }).catch(function(){}); }
    } catch (e) { console.warn("[plein ecran]", e); }
  }
  C.shell.ajouterBouton({
    id: "plein", icone: "pleinecran", libelle: "bar.plein", titre: "bar.plein", ordre: 70,
    surClic: function(){ basculerPlein(); },
    cree: function(b){
      function maj(){
        var on = pleinEcran(), lbl = b.querySelector(".rdlbl");
        b.title = t(on ? "bar.plein.sortir" : "bar.plein");
        if (lbl) lbl.textContent = t(on ? "bar.plein.sortir" : "bar.plein");
        b.setAttribute("aria-pressed", on ? "true" : "false");
        var vieux = b.querySelector("svg"); if (vieux) b.replaceChild(ui.icone(on ? "reduire" : "pleinecran"), vieux);
        if (!on && !boutonPage()) verrouClavier(false);
      }
      document.addEventListener("fullscreenchange", maj);
      maj();
    }
  });

  C.poste.actions = { pont: pont, basculerPlein: basculerPlein, verrouClavier: verrouClavier };
})();
