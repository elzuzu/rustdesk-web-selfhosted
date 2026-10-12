// Liste des postes : la page d'accueil « Mes postes » (avant la connexion) et le changement de poste (en session).
//
// Elle ne fait rien sans le service « flotte » (fleet/server.py, facultatif) : absent, en panne ou refuse (502, 401…), la page est
// exactement celle d'avant — le formulaire du bundle et les dix dernieres connexions. Le service ne voit JAMAIS de mot de passe de
// poste : ils restent dans le navigateur (le bundle les memorise par poste), donc « Se connecter » ne fait que remplir l'ID et
// appuyer sur Connect, comme vous le feriez.
(function(){
  var C = window.RDConsole = window.RDConsole || {};
  var ui = C.ui, t = C.i18n.t, noeud = ui.noeud, F = C.flotte;

  C.i18n.ajouter({
    fr: {
      "flotte.titre": "Mes postes", "flotte.compte": "{n} postes · {m} en ligne", "flotte.compte.sans": "{n} postes", "flotte.compte.un": "1 poste",
      "flotte.vide": "Aucun poste pour l'instant. Ajoutez-en un, ou connectez-vous une fois : il sera ajouté tout seul.",
      "flotte.aucun": "Aucun poste ne correspond.", "flotte.rechercher": "Rechercher un poste", "flotte.ajouter": "Ajouter un poste",
      "flotte.connecter": "Se connecter", "flotte.connecter.a": "Se connecter à {nom}", "flotte.modifier": "Modifier {nom}",
      "flotte.favori": "Épingler {nom}", "flotte.favori.off": "Désépingler {nom}",
      "flotte.etat.en_ligne": "En ligne", "flotte.etat.hors_ligne": "Hors ligne", "flotte.etat.inconnu": "État inconnu",
      "flotte.jamais": "jamais connecté", "flotte.rel.now": "à l'instant", "flotte.rel.min": "il y a {n} min", "flotte.rel.h": "il y a {n} h", "flotte.rel.j": "il y a {n} j",
      "flotte.dlg.ajouter": "Ajouter un poste", "flotte.dlg.modifier": "Modifier le poste", "flotte.f.id": "ID du poste", "flotte.f.nom": "Nom", "flotte.f.note": "Note",
      "flotte.f.tags": "Étiquettes", "flotte.f.tags.aide": "Séparées par des virgules, 8 au plus.", "flotte.dlg.enregistrer": "Enregistrer", "flotte.dlg.annuler": "Annuler",
      "flotte.dlg.retirer": "Retirer de la liste", "flotte.dlg.retirer.confirmer": "Confirmer : retirer de la liste",
      "flotte.dlg.retirer.aide": "Le poste lui-même n'est pas touché ; il se rajoutera à votre prochaine connexion.",
      "flotte.err.id": "ID invalide : 5 à 32 caractères (chiffres, lettres, - ou _).", "flotte.err.api": "Le service de la liste ne répond pas.",
      "flotte.err.plein": "La liste est pleine (500 postes).", "flotte.err.tags": "Étiquettes : 8 au plus, 24 caractères chacune.", "flotte.err.nom": "Nom ou note trop long.",
      "flotte.exporter": "Exporter", "flotte.importer": "Importer", "flotte.import.ok": "{n} poste(s) importé(s).", "flotte.import.partiel": "{n} importé(s), {m} ignoré(s).",
      "flotte.import.echec": "Fichier illisible.", "flotte.outils": "Sauvegarde de la liste",
      "bar.postes": "Postes", "flotte.changer.titre": "Changer de poste", "flotte.recents": "Dernières connexions", "flotte.courant": "connecté",
      "flotte.changer.vide": "Aucun autre poste connu.", "flotte.changer.aide": "Quitte la session en cours puis ouvre l'autre. Le mot de passe mémorisé du poste est réutilisé."
    },
    en: {
      "flotte.titre": "My machines", "flotte.compte": "{n} machines · {m} online", "flotte.compte.sans": "{n} machines", "flotte.compte.un": "1 machine",
      "flotte.vide": "No machines yet. Add one, or connect once: it will be added by itself.",
      "flotte.aucun": "No machine matches.", "flotte.rechercher": "Search machines", "flotte.ajouter": "Add a machine",
      "flotte.connecter": "Connect", "flotte.connecter.a": "Connect to {nom}", "flotte.modifier": "Edit {nom}",
      "flotte.favori": "Pin {nom}", "flotte.favori.off": "Unpin {nom}",
      "flotte.etat.en_ligne": "Online", "flotte.etat.hors_ligne": "Offline", "flotte.etat.inconnu": "Status unknown",
      "flotte.jamais": "never connected", "flotte.rel.now": "just now", "flotte.rel.min": "{n} min ago", "flotte.rel.h": "{n} h ago", "flotte.rel.j": "{n} d ago",
      "flotte.dlg.ajouter": "Add a machine", "flotte.dlg.modifier": "Edit machine", "flotte.f.id": "Machine ID", "flotte.f.nom": "Name", "flotte.f.note": "Note",
      "flotte.f.tags": "Tags", "flotte.f.tags.aide": "Comma-separated, 8 at most.", "flotte.dlg.enregistrer": "Save", "flotte.dlg.annuler": "Cancel",
      "flotte.dlg.retirer": "Remove from the list", "flotte.dlg.retirer.confirmer": "Confirm: remove from the list",
      "flotte.dlg.retirer.aide": "The machine itself is untouched; it will be added again at your next connection.",
      "flotte.err.id": "Invalid ID: 5 to 32 characters (digits, letters, - or _).", "flotte.err.api": "The list service is not responding.",
      "flotte.err.plein": "The list is full (500 machines).", "flotte.err.tags": "Tags: 8 at most, 24 characters each.", "flotte.err.nom": "Name or note too long.",
      "flotte.exporter": "Export", "flotte.importer": "Import", "flotte.import.ok": "{n} machine(s) imported.", "flotte.import.partiel": "{n} imported, {m} ignored.",
      "flotte.import.echec": "Unreadable file.", "flotte.outils": "Back up the list",
      "bar.postes": "Machines", "flotte.changer.titre": "Switch machine", "flotte.recents": "Recent connections", "flotte.courant": "connected",
      "flotte.changer.vide": "No other known machine.", "flotte.changer.aide": "Leaves the current session then opens the other. The machine's saved password is reused."
    }
  });

  var etat = { dispo: false, postes: [], filtre: "", derniereSession: 0 };
  var panneau = null, liste = null, compte = null, recherche = null, dlg = null, abonnesListe = [];
  function toast(cle, niveau, p){ if (typeof window.__rdToast === "function") { try { window.__rdToast(t(cle, p), niveau || "info"); } catch (e) {} } }
  function maintenant(){ return Math.floor(Date.now() / 1000); }

  // ------------------------------------------------------------- reseau
  // Tout echec (reseau, 4xx, 5xx, corps illisible) rend { ok: false } : la page ne depend jamais du service.
  function appel(methode, chemin, corps){
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var minuteur = ctl ? setTimeout(function(){ ctl.abort(); }, 6000) : null;
    var opts = { method: methode, credentials: "same-origin", headers: { "X-RD": "1" }, cache: "no-store" };
    if (ctl) opts.signal = ctl.signal;
    if (corps !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(corps); }
    return fetch(chemin, opts).then(function(r){
      clearTimeout(minuteur);
      return r.text().then(function(txt){
        var j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
        return { ok: r.ok, status: r.status, json: j };
      });
    }, function(){ clearTimeout(minuteur); return { ok: false, status: 0, json: null }; });
  }
  function prevenirListe(){ abonnesListe.slice().forEach(function(f){ try { f(); } catch (e) {} }); }
  function charger(){
    return appel("GET", "/api/devices").then(function(r){
      if (r.ok && r.json && Array.isArray(r.json.postes)) { etat.dispo = true; etat.postes = r.json.postes; prevenirListe(); return true; }
      if (!r.ok) etat.dispo = false;
      return false;
    });
  }
  function sonder(){
    return appel("GET", "/api/health").then(function(r){
      etat.dispo = !!(r.ok && r.json && r.json.ok === true);
      return etat.dispo ? charger() : false;
    });
  }
  function cle(code){ return code === "id_invalide" ? "flotte.err.id" : code === "liste_pleine" ? "flotte.err.plein" :
                             code === "etiquettes_invalides" ? "flotte.err.tags" : (code === "nom_invalide" || code === "note_invalide") ? "flotte.err.nom" : "flotte.err.api"; }

  // ------------------------------------------------------------- actions
  function seConnecter(id){
    var champ = document.getElementById("id"), go = document.querySelector("#connect td > button");
    if (!champ || !go) return false;
    champ.value = id;
    try { champ.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    go.click();
    return true;
  }
  // En session : on quitte (le gabarit revient au formulaire), puis on ouvre l'autre poste.
  function changerDe(id){
    var quitter = document.querySelector("#rdbar .quit");
    if (!quitter) return false;
    quitter.click();
    var essais = 0, iv = setInterval(function(){
      essais++;
      var c = document.getElementById("connect");
      if (c && getComputedStyle(c).display !== "none") { clearInterval(iv); seConnecter(id); }
      else if (essais > 40) clearInterval(iv);
    }, 250);
    return true;
  }
  function majPoste(id, champs){
    return appel("PUT", "/api/devices/" + encodeURIComponent(id), champs).then(function(r){
      if (r.ok) return charger().then(function(){ return { ok: true }; });
      return { ok: false, cle: cle(r.json && r.json.erreur) };
    });
  }

  // ------------------------------------------------------------- dialogue d'ajout / modification
  function dialogue(p){
    if (dlg && dlg.parentNode) dlg.parentNode.removeChild(dlg);
    var edition = !!p;
    dlg = noeud("dialog", "rdfl-dlg"); dlg.setAttribute("aria-labelledby", "rdfl-dlg-titre");
    var form = noeud("form"); form.method = "dialog"; form.noValidate = true;
    form.appendChild(noeud("h2", "rdfl-dlg-titre", t(edition ? "flotte.dlg.modifier" : "flotte.dlg.ajouter")));
    form.firstChild.id = "rdfl-dlg-titre";
    function champ(libelle, nom, valeur, opts){
      opts = opts || {};
      var l = noeud("label", "rdfl-champ"); l.appendChild(noeud("span", null, libelle));
      var i = noeud(opts.zone ? "textarea" : "input"); i.name = nom; i.value = valeur || "";
      if (opts.zone) i.rows = 3; else i.type = "text";
      if (opts.max) i.maxLength = opts.max;
      if (opts.lecture) { i.readOnly = true; }
      i.setAttribute("autocomplete", "off"); i.setAttribute("spellcheck", "false");
      l.appendChild(i);
      if (opts.aide) l.appendChild(noeud("small", null, opts.aide));
      form.appendChild(l);
      return i;
    }
    var fId = champ(t("flotte.f.id"), "id", p ? p.id : "", { lecture: edition, max: 40 });
    var fNom = champ(t("flotte.f.nom"), "nom", p && p.nom, { max: 60 });
    var fTags = champ(t("flotte.f.tags"), "tags", p && (p.etiquettes || []).join(", "), { aide: t("flotte.f.tags.aide") });
    var fNote = champ(t("flotte.f.note"), "note", p && p.note, { zone: true, max: 500 });
    if (!edition) fId.setAttribute("inputmode", "text");
    var err = noeud("p", "rdfl-err"); err.setAttribute("role", "alert"); err.hidden = true; form.appendChild(err);
    var rang = noeud("div", "rdfl-dlg-actions");
    var annuler = noeud("button", "rdfl-btn", t("flotte.dlg.annuler")); annuler.type = "button";
    var ok = noeud("button", "rdfl-btn rdfl-primaire", t("flotte.dlg.enregistrer")); ok.type = "submit";
    if (edition) {
      var retirer = noeud("button", "rdfl-btn rdfl-danger", t("flotte.dlg.retirer")); retirer.type = "button"; retirer.setAttribute("data-action", "retirer");
      retirer.addEventListener("click", function(){
        if (retirer.getAttribute("data-confirme") !== "1") { retirer.setAttribute("data-confirme", "1"); retirer.textContent = t("flotte.dlg.retirer.confirmer"); err.textContent = t("flotte.dlg.retirer.aide"); err.hidden = false; err.setAttribute("data-info", "1"); return; }
        appel("DELETE", "/api/devices/" + encodeURIComponent(p.id)).then(function(r){
          if (r.ok) { charger(); dlg.close(); } else { err.removeAttribute("data-info"); err.textContent = t("flotte.err.api"); err.hidden = false; }
        });
      });
      rang.appendChild(retirer);
    }
    rang.appendChild(annuler); rang.appendChild(ok); form.appendChild(rang);
    annuler.addEventListener("click", function(){ dlg.close(); });
    form.addEventListener("submit", function(ev){
      ev.preventDefault();
      err.removeAttribute("data-info");
      var id = F.normaliserId(fId.value), tags = F.etiquettesDepuis(fTags.value);
      if (!edition && !F.idValide(id)) { err.textContent = t("flotte.err.id"); err.hidden = false; fId.focus(); return; }
      if (!tags.ok) { err.textContent = t(tags.cle); err.hidden = false; fTags.focus(); return; }
      var corps = { nom: fNom.value.trim(), note: fNote.value.trim(), etiquettes: tags.liste };
      ok.disabled = true;
      var requete = edition ? appel("PUT", "/api/devices/" + encodeURIComponent(p.id), corps) : appel("POST", "/api/devices", Object.assign({ id: id }, corps));
      requete.then(function(r){
        ok.disabled = false;
        if (r.ok) { charger(); dlg.close(); return; }
        err.textContent = t(cle(r.json && r.json.erreur)); err.hidden = false;
      });
    });
    dlg.appendChild(form);
    dlg.addEventListener("close", function(){ if (dlg && dlg.parentNode) dlg.parentNode.removeChild(dlg); dlg = null; });
    document.body.appendChild(dlg);
    try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
    (edition ? fNom : fId).focus();
  }

  // ------------------------------------------------------------- export / import
  function exporter(){
    var d = new Date(), p2 = function(n){ return (n < 10 ? "0" : "") + n; };
    var contenu = JSON.stringify({ version: 1, postes: etat.postes.map(function(x){
      return { id: x.id, nom: x.nom, note: x.note, etiquettes: x.etiquettes, favori: !!x.favori };
    }) }, null, 2);
    var u = URL.createObjectURL(new Blob([contenu], { type: "application/json" })), a = document.createElement("a");
    a.href = u; a.download = "rustdesk-postes-" + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + ".json"; a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(function(){ try { document.body.removeChild(a); URL.revokeObjectURL(u); } catch (e) {} }, 1000);
  }
  function importer(fichier){
    var lecteur = new FileReader();
    lecteur.onload = function(){
      var r = F.importDepuis(String(lecteur.result || ""));
      if (!r) { toast("flotte.import.echec", "erreur"); return; }
      var faits = 0;
      r.postes.reduce(function(chaine, p){
        return chaine.then(function(){ return appel("POST", "/api/devices", p).then(function(x){ if (x.ok) faits++; else r.ignores++; }); });
      }, Promise.resolve()).then(function(){
        charger();
        toast(r.ignores ? "flotte.import.partiel" : "flotte.import.ok", "info", { n: faits, m: r.ignores });
      });
    };
    lecteur.onerror = function(){ toast("flotte.import.echec", "erreur"); };
    lecteur.readAsText(fichier);
  }

  // ------------------------------------------------------------- page d'accueil
  function libelleRel(ts){
    var r = F.relatif(ts, maintenant());
    return r.unite === "jamais" ? t("flotte.jamais") : t("flotte.rel." + r.unite, { n: r.n });
  }
  function carte(p){
    var li = noeud("li", "rdfl-carte"); li.setAttribute("data-id", p.id);
    var etatCle = p.en_ligne === true ? "en_ligne" : p.en_ligne === false ? "hors_ligne" : "inconnu";
    li.setAttribute("data-etat", etatCle);
    var nom = F.nomAffiche(p);
    var tete = noeud("div", "rdfl-tete");
    var pastille = noeud("span", "rdfl-pastille"); pastille.title = t("flotte.etat." + etatCle); pastille.setAttribute("role", "img"); pastille.setAttribute("aria-label", t("flotte.etat." + etatCle));
    tete.appendChild(pastille);
    var h = noeud("h3", "rdfl-nom", nom); tete.appendChild(h);
    var etoile = noeud("button", "rdfl-etoile"); etoile.type = "button";
    etoile.setAttribute("aria-pressed", p.favori ? "true" : "false");
    etoile.setAttribute("aria-label", t(p.favori ? "flotte.favori.off" : "flotte.favori", { nom: nom })); etoile.title = etoile.getAttribute("aria-label");
    etoile.appendChild(document.createTextNode(p.favori ? "★" : "☆"));
    etoile.addEventListener("click", function(){ p.favori = !p.favori; majPoste(p.id, { favori: !!p.favori }); prevenirListe(); });
    tete.appendChild(etoile); li.appendChild(tete);
    var sous = noeud("p", "rdfl-sous");
    if (p.nom) sous.appendChild(noeud("span", "rdfl-id", F.fmtId(p.id)));                    // sans nom, l'ID est deja le titre
    sous.appendChild(noeud("span", "rdfl-rel", libelleRel(p.derniere_connexion)));
    li.appendChild(sous);
    if (p.etiquettes && p.etiquettes.length) {
      var tags = noeud("ul", "rdfl-tags");
      p.etiquettes.forEach(function(e){ tags.appendChild(noeud("li", "rdfl-tag", e)); });
      li.appendChild(tags);
    }
    if (p.note) { var n = noeud("p", "rdfl-note", p.note); n.title = p.note; li.appendChild(n); }
    var actions = noeud("div", "rdfl-actions");
    var go = noeud("button", "rdfl-btn rdfl-primaire", t("flotte.connecter")); go.type = "button";
    go.setAttribute("aria-label", t("flotte.connecter.a", { nom: nom })); go.setAttribute("data-action", "connecter");
    go.addEventListener("click", function(){ seConnecter(p.id); });
    var ed = noeud("button", "rdfl-btn rdfl-icone", "⋯"); ed.type = "button"; ed.setAttribute("data-action", "modifier");
    ed.setAttribute("aria-label", t("flotte.modifier", { nom: nom })); ed.title = ed.getAttribute("aria-label");
    ed.addEventListener("click", function(){ dialogue(p); });
    actions.appendChild(go); actions.appendChild(ed); li.appendChild(actions);
    return li;
  }
  function dessiner(){
    if (!panneau) return;
    var tous = F.trier(etat.postes), vus = F.filtrer(tous, etat.filtre), c = F.compter(etat.postes);
    compte.textContent = etat.postes.length === 1 ? t("flotte.compte.un") : c.etatConnu ? t("flotte.compte", { n: c.total, m: c.enLigne }) : t("flotte.compte.sans", { n: c.total });
    while (liste.firstChild) liste.removeChild(liste.firstChild);
    if (!vus.length) {
      var v = noeud("li", "rdfl-vide", t(etat.postes.length ? "flotte.aucun" : "flotte.vide")); liste.appendChild(v);
    } else vus.forEach(function(p){ liste.appendChild(carte(p)); });
    recherche.hidden = etat.postes.length < 4;                    // une barre de recherche pour trois postes est du bruit
  }
  function monterPanneau(){
    var app = document.getElementById("app"), connect = document.getElementById("connect");
    if (panneau || !app || !connect) return;
    panneau = noeud("section"); panneau.id = "rdflotte"; panneau.setAttribute("aria-labelledby", "rdfl-titre");
    var tete = noeud("header", "rdfl-entete");
    var h = noeud("h2", null, t("flotte.titre")); h.id = "rdfl-titre"; tete.appendChild(h);
    compte = noeud("span", "rdfl-compte"); compte.setAttribute("role", "status"); tete.appendChild(compte);
    var outils = noeud("div", "rdfl-outils");
    var ajouter = noeud("button", "rdfl-btn rdfl-primaire", "+ " + t("flotte.ajouter")); ajouter.type = "button"; ajouter.setAttribute("data-action", "ajouter");
    ajouter.addEventListener("click", function(){ dialogue(null); });
    var exp = noeud("button", "rdfl-btn", t("flotte.exporter")); exp.type = "button"; exp.title = t("flotte.outils"); exp.setAttribute("data-action", "exporter");
    exp.addEventListener("click", exporter);
    var imp = noeud("button", "rdfl-btn", t("flotte.importer")); imp.type = "button"; imp.setAttribute("data-action", "importer");
    var fichier = noeud("input"); fichier.type = "file"; fichier.accept = "application/json,.json"; fichier.hidden = true; fichier.setAttribute("data-role", "import");
    imp.addEventListener("click", function(){ fichier.click(); });
    fichier.addEventListener("change", function(){ if (fichier.files && fichier.files[0]) importer(fichier.files[0]); fichier.value = ""; });
    outils.appendChild(ajouter); outils.appendChild(exp); outils.appendChild(imp); outils.appendChild(fichier); tete.appendChild(outils);
    panneau.appendChild(tete);
    recherche = noeud("input", "rdfl-recherche"); recherche.type = "search"; recherche.placeholder = t("flotte.rechercher"); recherche.setAttribute("aria-label", t("flotte.rechercher"));
    recherche.setAttribute("autocomplete", "off"); recherche.setAttribute("spellcheck", "false");
    recherche.addEventListener("input", function(){ etat.filtre = recherche.value; dessiner(); });
    recherche.addEventListener("keydown", function(ev){ if (ev.key === "Enter") ev.stopPropagation(); });
    panneau.appendChild(recherche);
    liste = noeud("ul", "rdfl-grille"); liste.setAttribute("aria-label", t("flotte.titre")); panneau.appendChild(liste);
    app.insertBefore(panneau, connect);
    abonnesListe.push(dessiner);
    // Visible seulement tant que le formulaire de connexion l'est (le bundle bascule vers le mot de passe, l'attente, puis la session).
    var suivre = function(){ panneau.hidden = getComputedStyle(connect).display === "none"; };
    try { new MutationObserver(suivre).observe(connect, { attributes: true, attributeFilter: ["style", "class"] }); } catch (e) {}
    suivre(); dessiner();
  }

  // ------------------------------------------------------------- changement de poste (en session)
  function recentsLocaux(){
    try { var R = window.RDLib && window.RDLib.recent && window.RDLib.recent.create(window.localStorage); return R ? R.list().map(function(e){ return { id: e.id, nom: "", derniere_connexion: Math.floor(e.t / 1000) }; }) : []; }
    catch (e) { return []; }
  }
  function construirePopover(el, pop){
    el.appendChild(noeud("h3", "rdpop-titre", t("flotte.changer.titre")));
    var corps = noeud("div", "rdpop-corps"); el.appendChild(corps);
    var rendu = function(){
      while (corps.firstChild) corps.removeChild(corps.firstChild);
      var courant = C.poste.info().id, source = etat.dispo && etat.postes.length ? F.trier(etat.postes) : recentsLocaux();
      var autres = source.filter(function(p){ return p.id !== courant; });
      corps.appendChild(noeud("p", "rdaide rdtb-aide", t("flotte.changer.aide")));
      if (!etat.dispo || !etat.postes.length) corps.appendChild(noeud("h4", "rdpop-sous", t("flotte.recents")));
      var ul = noeud("ul", "rdsw-liste");
      source.forEach(function(p){
        var li = noeud("li"), b = noeud("button", "rdposte"); b.type = "button"; b.setAttribute("data-id", p.id);
        var cur = p.id === courant; if (cur) { b.disabled = true; b.setAttribute("aria-current", "true"); }
        var etatCle = p.en_ligne === true ? "en_ligne" : p.en_ligne === false ? "hors_ligne" : "inconnu";
        var pas = noeud("span", "rdfl-pastille"); pas.setAttribute("data-etat", etatCle); pas.setAttribute("role", "img"); pas.setAttribute("aria-label", t("flotte.etat." + etatCle));
        b.appendChild(pas);
        var txt = noeud("span", "rdposte-txt"); txt.appendChild(noeud("span", "rdposte-nom", F.nomAffiche(p)));
        txt.appendChild(noeud("span", "rdposte-id", F.fmtId(p.id) + (cur ? " · " + t("flotte.courant") : ""))); b.appendChild(txt);
        b.addEventListener("click", function(){ pop.fermer(); changerDe(p.id); });
        li.appendChild(b); ul.appendChild(li);
      });
      if (!autres.length) corps.appendChild(noeud("p", "rdaide rdtb-aide", t("flotte.changer.vide")));
      corps.appendChild(ul);
    };
    el.addEventListener("beforetoggle", function(ev){ if (ev.newState === "open") { rendu(); if (etat.dispo) charger(); } });
    abonnesListe.push(function(){ if (pop.estOuvert()) rendu(); });
    rendu();
  }
  C.shell.ajouterBouton({ id: "postes", icone: "poste", libelle: "bar.postes", titre: "flotte.changer.titre", ordre: 5, popover: construirePopover });

  // ------------------------------------------------------------- une session s'ouvre : le poste rejoint la liste
  function surSession(){
    var pe = C.poste.etat(), info = C.poste.info();
    if (!etat.dispo || !info.id || pe.session === etat.derniereSession) return;
    etat.derniereSession = pe.session;
    var connu = etat.postes.some(function(p){ return p.id === info.id; });
    if (!connu && !F.idValide(info.id)) return;                  // un ID que le service refuserait : on n'insiste pas
    var requete = connu ? appel("POST", "/api/devices/" + encodeURIComponent(info.id) + "/touch")
                        : appel("POST", "/api/devices", pe.hote ? { id: info.id, nom: F.nomDepuisHote(pe.hote) } : { id: info.id });
    requete.then(function(r){ if (r.ok) charger(); });
  }
  C.poste.surChangement(surSession);

  // ------------------------------------------------------------- demarrage
  var essais = 0;
  function tenter(){
    if (!document.getElementById("connect")) return false;
    sonder().then(function(){ if (etat.dispo) monterPanneau(); });
    // Rafraichissement discret tant que la page d'accueil est visible : l'etat en ligne change.
    setInterval(function(){ if (etat.dispo && panneau && !panneau.hidden) charger(); }, 15000);
    return true;
  }
  if (!tenter()) {
    var iv = setInterval(function(){ essais++; if (tenter() || essais > 200) clearInterval(iv); }, 550);
  }

  C.flotteUi = { etat: function(){ return etat; }, appel: appel, charger: charger, seConnecter: seConnecter, changerDe: changerDe, dialogue: dialogue, exporter: exporter, importer: importer };
})();
