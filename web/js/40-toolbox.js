// Toolbox : presse-papier (envoyer du texte), raccourcis (selon le systeme du poste, plus les votres), capture d'ecran
// et enregistrement de la video. Tout reste dans le navigateur : rien n'est envoye a un serveur.
(function(){
  var C = window.RDConsole = window.RDConsole || {};
  var ui = C.ui, t = C.i18n.t, noeud = ui.noeud, pur = C.input;

  C.i18n.ajouter({
    fr: {
      "bar.toolbox": "Toolbox", "bar.toolbox.titre": "Outils de la session",
      "tb.cbp": "Presse-papier", "tb.texte.label": "Texte à envoyer", "tb.texte.ph": "Saisissez ou collez du texte…",
      "tb.copier": "Copier vers le poste", "tb.taper": "Taper au clavier",
      "tb.cbp.aide": "Ctrl+V colle déjà texte, images et fichiers. Un bouton vert apparaît dans la barre quand le poste copie du texte ou une image. « Taper » écrit le texte touche par touche : utile à un écran de connexion ou dans le BIOS.",
      "tb.envoye": "Texte envoyé au presse-papier du poste.", "tb.tape": "Texte tapé sur le poste.", "tb.vide": "Rien à envoyer.", "tb.echec": "Envoi impossible : la session n'est pas prête.",
      "tb.rac": "Raccourcis", "rac.ajouter": "Ajouter", "rac.ph": "ctrl+alt+t", "rac.label": "Votre raccourci",
      "rac.invalide": "Combinaison illisible. Exemples : ctrl+alt+t, win+d, alt+F4.", "rac.doublon": "Ce raccourci existe déjà.", "rac.plein": "Douze raccourcis au plus.",
      "rac.retirer": "Retirer {combo}", "rac.perso": "Les vôtres",
      "rac.p.cad": "Ctrl+Alt+Suppr", "rac.p.win": "Touche Windows", "rac.p.alttab": "Alt+Tab", "rac.p.gestionnaire": "Gestionnaire des tâches",
      "rac.p.bureau": "Afficher le bureau", "rac.p.verrou": "Verrouiller (Win+L)", "rac.p.altf4": "Fermer la fenêtre (Alt+F4)", "rac.p.impr": "Impr. écran",
      "rac.p.esc": "Échap", "rac.p.tab": "Tab", "rac.p.spotlight": "Spotlight", "rac.p.cmdtab": "Changer d'app (Cmd+Tab)", "rac.p.capture": "Capture d'écran",
      "rac.p.zone": "Capture d'une zone", "rac.p.forcer": "Forcer à quitter", "rac.p.verroumac": "Verrouiller l'écran", "rac.p.super": "Touche Super",
      "rac.p.terminal": "Terminal (Ctrl+Alt+T)",
      "tb.capture": "Capture et enregistrement", "cap.photo": "Capture d'écran", "cap.enreg": "Enregistrer la vidéo", "cap.stop": "Arrêter ({duree})",
      "cap.aide": "Enregistre l'image du poste dans votre navigateur, sans le son. Rien n'est envoyé à un serveur.",
      "cap.ok": "Capture enregistrée.", "cap.echec": "Capture impossible.", "cap.debut": "Enregistrement démarré.", "cap.fin": "Enregistrement terminé.",
      "cap.indispo": "Ce navigateur ne sait pas enregistrer la vidéo."
    },
    en: {
      "bar.toolbox": "Toolbox", "bar.toolbox.titre": "Session tools",
      "tb.cbp": "Clipboard", "tb.texte.label": "Text to send", "tb.texte.ph": "Type or paste text…",
      "tb.copier": "Copy to the machine", "tb.taper": "Type it out",
      "tb.cbp.aide": "Ctrl+V already pastes text, images and files. A green button appears in the bar when the machine copies text or an image. “Type it out” writes the text key by key: useful at a login screen or in the BIOS.",
      "tb.envoye": "Text sent to the machine's clipboard.", "tb.tape": "Text typed on the machine.", "tb.vide": "Nothing to send.", "tb.echec": "Cannot send: the session is not ready.",
      "tb.rac": "Shortcuts", "rac.ajouter": "Add", "rac.ph": "ctrl+alt+t", "rac.label": "Your shortcut",
      "rac.invalide": "Unreadable combination. Examples: ctrl+alt+t, win+d, alt+F4.", "rac.doublon": "This shortcut already exists.", "rac.plein": "Twelve shortcuts at most.",
      "rac.retirer": "Remove {combo}", "rac.perso": "Yours",
      "rac.p.cad": "Ctrl+Alt+Del", "rac.p.win": "Windows key", "rac.p.alttab": "Alt+Tab", "rac.p.gestionnaire": "Task Manager",
      "rac.p.bureau": "Show desktop", "rac.p.verrou": "Lock (Win+L)", "rac.p.altf4": "Close window (Alt+F4)", "rac.p.impr": "Print Screen",
      "rac.p.esc": "Esc", "rac.p.tab": "Tab", "rac.p.spotlight": "Spotlight", "rac.p.cmdtab": "Switch app (Cmd+Tab)", "rac.p.capture": "Screenshot",
      "rac.p.zone": "Screenshot of an area", "rac.p.forcer": "Force Quit", "rac.p.verroumac": "Lock screen", "rac.p.super": "Super key",
      "rac.p.terminal": "Terminal (Ctrl+Alt+T)",
      "tb.capture": "Capture and recording", "cap.photo": "Screenshot", "cap.enreg": "Record video", "cap.stop": "Stop ({duree})",
      "cap.aide": "Records the machine's image in your browser, without sound. Nothing is sent to a server.",
      "cap.ok": "Screenshot saved.", "cap.echec": "Screenshot failed.", "cap.debut": "Recording started.", "cap.fin": "Recording finished.",
      "cap.indispo": "This browser cannot record video."
    }
  });

  function toast(cle, niveau, p){ if (typeof window.__rdToast === "function") { try { window.__rdToast(t(cle, p), niveau || "info"); } catch (e) {} } }
  function stockageSur(){ try { return window.localStorage; } catch (e) { return { getItem: function(){ return null; }, setItem: function(){} }; } }
  var raccourcis = pur.creerRaccourcis(stockageSur());

  // ------------------------------------------------------------- presse-papier
  function copierVersPoste(texte){
    var octets = new TextEncoder().encode(texte);
    return typeof window.__rdSend === "function" && window.__rdSend({ clipboard: { content: octets, compress: false } });
  }
  function taperTexte(texte){
    try { window.setByName("input_string", texte); return true; } catch (e) { console.warn("[toolbox]", e); return false; }
  }

  // ------------------------------------------------------------- raccourcis
  function executer(combo, special){
    if (special === "ctrl_alt_del") return C.poste.actions.pont("ctrl_alt_del");
    var c = pur.parseCombo(combo);
    if (!c) return false;
    var msg = { name: c.name, down: "false", press: "true", alt: String(c.alt), ctrl: String(c.ctrl), shift: String(c.shift), command: String(c.command) };
    try { window.setByName("input_key", JSON.stringify(msg)); return true; } catch (e) { console.warn("[toolbox]", e); return false; }
  }

  // ------------------------------------------------------------- capture et enregistrement
  function horodatage(){
    var d = new Date(), p = function(n){ return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function nomFichier(ext){
    var id = String(C.poste.info().id || "poste").replace(/\D/g, "") || "poste";
    return "rustdesk-" + id + "-" + horodatage() + "." + ext;
  }
  function telecharger(blob, nom){
    var u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u; a.download = nom; a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(function(){ try { document.body.removeChild(a); URL.revokeObjectURL(u); } catch (e) {} }, 1000);
  }
  function capturer(){
    var c = ui.actif();
    if (!c || !c.width || !c.height) { toast("cap.echec", "erreur"); return Promise.resolve(false); }
    return new Promise(function(ok){
      try {
        c.toBlob(function(blob){
          if (!blob) { toast("cap.echec", "erreur"); ok(false); return; }
          telecharger(blob, nomFichier("png")); toast("cap.ok"); ok(true);
        }, "image/png");
      } catch (e) { toast("cap.echec", "erreur"); ok(false); }
    });
  }
  var enr = { rec: null, morceaux: [], debut: 0, tick: null, mime: "" };
  function enregistrementPossible(){ return typeof window.MediaRecorder === "function" && !!(ui.actif() && ui.actif().captureStream); }
  function choisirMime(){
    var essais = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    for (var i = 0; i < essais.length; i++) { try { if (MediaRecorder.isTypeSupported(essais[i])) return essais[i]; } catch (e) {} }
    return "";
  }
  function demarrerEnregistrement(){
    if (enr.rec) return false;
    if (!enregistrementPossible()) { toast("cap.indispo", "erreur"); return false; }
    try {
      var flux = ui.actif().captureStream(30), mime = choisirMime();
      enr.rec = mime ? new MediaRecorder(flux, { mimeType: mime }) : new MediaRecorder(flux);
      enr.morceaux = []; enr.mime = enr.rec.mimeType || mime || "video/webm";
      enr.rec.ondataavailable = function(ev){ if (ev.data && ev.data.size) enr.morceaux.push(ev.data); };
      enr.rec.onstop = function(){
        var blob = new Blob(enr.morceaux, { type: enr.mime });
        enr.rec = null; enr.morceaux = [];
        if (blob.size) { telecharger(blob, nomFichier("webm")); toast("cap.fin"); }
        else toast("cap.echec", "erreur");
        notifier();
      };
      enr.rec.start(1000);
      enr.debut = Date.now();
      toast("cap.debut"); notifier();
      return true;
    } catch (e) { console.warn("[enregistrement]", e); enr.rec = null; toast("cap.indispo", "erreur"); return false; }
  }
  function arreterEnregistrement(){ if (enr.rec && enr.rec.state !== "inactive") { try { enr.rec.stop(); } catch (e) { enr.rec = null; } } }
  function duree(){ var s = Math.max(0, Math.round((Date.now() - enr.debut) / 1000)); return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
  var abonnes = [];
  function notifier(){ abonnes.slice().forEach(function(f){ try { f(); } catch (e) {} }); }
  window.addEventListener("pagehide", arreterEnregistrement);

  // ------------------------------------------------------------- fenetre
  function construire(el, pop){
    el.appendChild(noeud("h3", "rdpop-titre", t("bar.toolbox.titre")));
    var corps = noeud("div", "rdpop-corps"); el.appendChild(corps);

    // --- presse-papier
    corps.appendChild(noeud("h4", "rdpop-sous", t("tb.cbp")));
    var bloc = noeud("div", "rdtb-bloc");
    var etiquette = noeud("label", "rdlib", t("tb.texte.label")); etiquette.htmlFor = "rdtb-texte";
    var zone = noeud("textarea", "rdtexte"); zone.id = "rdtb-texte"; zone.rows = 3; zone.placeholder = t("tb.texte.ph");
    zone.setAttribute("spellcheck", "false"); zone.setAttribute("autocomplete", "off");
    var rangee = noeud("div", "rdtb-rangee");
    var copier = ui.bouton(t("tb.copier"), function(){
      if (!zone.value) { toast("tb.vide"); return; }
      var ok = copierVersPoste(zone.value); toast(ok ? "tb.envoye" : "tb.echec", ok ? "info" : "erreur");
    }, null, "rdbtn");
    var taper = ui.bouton(t("tb.taper"), function(){
      if (!zone.value) { toast("tb.vide"); return; }
      var ok = taperTexte(zone.value); toast(ok ? "tb.tape" : "tb.echec", ok ? "info" : "erreur");
      if (ok) pop.fermer();
    }, null, "rdbtn");
    copier.setAttribute("data-action", "copier"); taper.setAttribute("data-action", "taper");
    rangee.appendChild(copier); rangee.appendChild(taper);
    var aide = noeud("p", "rdaide rdtb-aide", t("tb.cbp.aide"));
    bloc.appendChild(etiquette); bloc.appendChild(zone); bloc.appendChild(rangee); bloc.appendChild(aide);
    corps.appendChild(bloc);

    // --- raccourcis
    corps.appendChild(noeud("h4", "rdpop-sous", t("tb.rac")));
    var grille = noeud("div", "rdrac"); corps.appendChild(grille);
    var perso = noeud("div", "rdrac-perso"); corps.appendChild(perso);
    var saisie = noeud("div", "rdrac-saisie");
    var champ = noeud("input", "rdchamp"); champ.type = "text"; champ.placeholder = t("rac.ph"); champ.setAttribute("aria-label", t("rac.label"));
    champ.setAttribute("autocomplete", "off"); champ.setAttribute("spellcheck", "false"); champ.maxLength = 40;
    var erreur = noeud("p", "rdaide rdrac-erreur"); erreur.setAttribute("role", "alert"); erreur.hidden = true;
    var ajouter = ui.bouton(t("rac.ajouter"), function(){
      var r = raccourcis.ajouter(champ.value);
      if (!r.ok) { erreur.textContent = t(r.cle); erreur.hidden = false; return; }
      champ.value = ""; erreur.hidden = true; dessiner();
    }, null, "rdbtn");
    ajouter.setAttribute("data-action", "rac-ajouter");
    champ.addEventListener("keydown", function(ev){ if (ev.key === "Enter") { ev.preventDefault(); ajouter.click(); } ev.stopPropagation(); });
    champ.addEventListener("input", function(){ erreur.hidden = true; });
    saisie.appendChild(champ); saisie.appendChild(ajouter);
    corps.appendChild(saisie); corps.appendChild(erreur);

    function dessiner(){
      var info = C.poste.info();
      while (grille.firstChild) grille.removeChild(grille.firstChild);
      pur.presets(info.plateforme).forEach(function(p){
        var b = ui.bouton(t("rac.p." + p.id), function(){ if (!executer(p.combo, p.special)) toast("tb.echec", "erreur"); }, null, "rdbtn rdbtn-rac");
        b.setAttribute("data-rac", p.id); b.title = pur.libelleCombo(pur.parseCombo(p.combo));
        grille.appendChild(b);
      });
      while (perso.firstChild) perso.removeChild(perso.firstChild);
      var l = raccourcis.liste();
      if (l.length) perso.appendChild(noeud("h5", "rdpop-sous2", t("rac.perso")));
      l.forEach(function(combo, i){
        var ligne = noeud("div", "rdrac-ligne");
        var go = ui.bouton(pur.libelleCombo(pur.parseCombo(combo)), function(){ if (!executer(combo)) toast("tb.echec", "erreur"); }, null, "rdbtn rdbtn-rac");
        go.setAttribute("data-perso", String(i));
        var x = noeud("button", "rdx"); x.type = "button"; x.setAttribute("aria-label", t("rac.retirer", { combo: combo })); x.title = t("rac.retirer", { combo: combo });
        x.appendChild(ui.icone("fermer"));
        x.addEventListener("click", function(){ raccourcis.retirer(i); dessiner(); });
        ligne.appendChild(go); ligne.appendChild(x); perso.appendChild(ligne);
      });
    }
    dessiner();
    el.addEventListener("beforetoggle", function(ev){ if (ev.newState === "open") dessiner(); });
    C.poste.surChangement(function(){ if (pop.estOuvert()) dessiner(); });

    // --- capture et enregistrement
    corps.appendChild(noeud("h4", "rdpop-sous", t("tb.capture")));
    var cap = noeud("div", "rdactions");
    var photo = ui.bouton(t("cap.photo"), function(){ capturer(); }, "camera", "rdbtn"); photo.setAttribute("data-action", "capture");
    var rec = ui.bouton(t("cap.enreg"), function(){ if (enr.rec) arreterEnregistrement(); else demarrerEnregistrement(); }, "enregistrer", "rdbtn");
    rec.setAttribute("data-action", "enregistrer");
    function majRec(){
      var on = !!enr.rec, l = rec.querySelector(".rdlbl");
      l.textContent = on ? t("cap.stop", { duree: duree() }) : t("cap.enreg");
      rec.classList.toggle("rdbtn-danger", on); rec.setAttribute("aria-pressed", on ? "true" : "false");
    }
    abonnes.push(majRec); majRec();
    var tick = setInterval(function(){
      if (el.isConnected) { el.__vu = true; if (enr.rec) majRec(); } else if (el.__vu) clearInterval(tick);     // la fenetre a ete reconstruite
    }, 1100);
    cap.appendChild(photo); cap.appendChild(rec);
    corps.appendChild(cap);
    corps.appendChild(noeud("p", "rdaide rdtb-aide", t("cap.aide")));
  }

  C.shell.ajouterBouton({ id: "toolbox", icone: "outils", libelle: "bar.toolbox", titre: "bar.toolbox.titre", ordre: 10, popover: construire });
  C.toolbox = { executer: executer, capturer: capturer, copierVersPoste: copierVersPoste, taperTexte: taperTexte,
                demarrerEnregistrement: demarrerEnregistrement, arreterEnregistrement: arreterEnregistrement,
                enregistrement: function(){ return !!enr.rec; }, raccourcis: raccourcis };
})();
