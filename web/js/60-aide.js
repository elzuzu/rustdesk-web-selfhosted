// Aide : diagnostic du relais, journal exportable, a propos.
//
// Le journal garde les 400 derniers messages de la console du navigateur (ceux du gabarit y ecrivent ce qui s'est passe :
// reprise, codec, presse-papier, relais…). « Exporter » les enregistre dans un fichier texte, AVEC l'etat utile (versions,
// plateforme du poste, codec, mesures) et SANS secret : ni mot de passe, ni cle, ni le stockage des postes memorises.
(function(){
  var C = window.RDConsole = window.RDConsole || {};
  var ui = C.ui, t = C.i18n.t, noeud = ui.noeud;
  var DEPOT = "https://github.com/elzuzu/rustdesk-web-selfhosted";       // AGPL art. 13 : la source est offerte depuis la page

  C.i18n.ajouter({
    fr: {
      "bar.aide": "Aide", "bar.aide.titre": "Aide et diagnostic",
      "aide.diag": "Diagnostic", "aide.relais": "Tester le relais", "aide.relais.encours": "Test en cours…",
      "aide.relais.aide": "Envoie trois clés à hbbr (celle de ce navigateur, une fausse, une vide) et compare les réponses. Prend 10 s.",
      "aide.relais.ok": "hbbr accepte la clé de ce navigateur.", "aide.relais.faux": "hbbr accepte aussi une clé fausse : il tourne sans -k _ (relais ouvert).",
      "aide.relais.refuse": "hbbr refuse la clé de ce navigateur. Voir docs/DEPANNAGE-RELAIS.md.", "aide.relais.inconnu": "Test impossible : la liaison n'atteint pas hbbr.",
      "aide.journal": "Exporter le journal", "aide.journal.aide": "Enregistre les derniers messages et l'état de la session dans un fichier texte, sans mot de passe ni clé.",
      "aide.journal.ok": "Journal exporté.", "aide.copier": "Copier le diagnostic", "aide.copie": "Diagnostic copié.", "aide.copie.echec": "Copie impossible.",
      "aide.apropos": "À propos", "aide.version": "Version", "aide.source": "Code source (AGPL-3.0)",
      "aide.licence": "Client web RustDesk auto-hébergé, indépendant du projet RustDesk. Les fichiers compilés dérivent du client RustDesk (AGPL-3.0)."
    },
    en: {
      "bar.aide": "Help", "bar.aide.titre": "Help and diagnostics",
      "aide.diag": "Diagnostics", "aide.relais": "Test the relay", "aide.relais.encours": "Testing…",
      "aide.relais.aide": "Sends three keys to hbbr (this browser's, a wrong one, an empty one) and compares the replies. Takes 10 s.",
      "aide.relais.ok": "hbbr accepts this browser's key.", "aide.relais.faux": "hbbr also accepts a wrong key: it runs without -k _ (open relay).",
      "aide.relais.refuse": "hbbr rejects this browser's key. See docs/DEPANNAGE-RELAIS.md.", "aide.relais.inconnu": "Cannot test: the link does not reach hbbr.",
      "aide.journal": "Export the log", "aide.journal.aide": "Saves the latest messages and the session state to a text file, with no password or key.",
      "aide.journal.ok": "Log exported.", "aide.copier": "Copy the diagnostics", "aide.copie": "Diagnostics copied.", "aide.copie.echec": "Copy failed.",
      "aide.apropos": "About", "aide.version": "Version", "aide.source": "Source code (AGPL-3.0)",
      "aide.licence": "Self-hosted RustDesk web client, independent from the RustDesk project. The compiled files derive from the RustDesk client (AGPL-3.0)."
    }
  });

  // ------------------------------------------------------------- journal
  var tampon = [], MAX = 400;
  // Aucune cle dans un journal qu'on envoie a quelqu'un : ni la cle entiere (base64 de 40 caracteres ou plus), ni son resume
  // « 8 premiers…6 derniers » que le gabarit ecrit en console pour diagnostiquer « invalid key ».
  function masquer(texte){
    return String(texte)
      .replace(/[A-Za-z0-9+\/]{40,}={0,2}/g, "[cle masquee]")
      .replace(/[A-Za-z0-9+\/]{6,}\u2026[A-Za-z0-9+\/]{4,}/g, "[cle masquee]")
      .replace(/(password|mot de passe|passwd|token|jeton)(["']?\s*[:=]\s*["']?)[^\s,;"']+/gi, "$1$2[masque]");
  }
  function ligneJournal(niveau, args){
    var texte = Array.prototype.slice.call(args).map(function(a){
      if (a instanceof Error) return a.name + ": " + a.message;
      if (a && typeof a === "object") { try { return JSON.stringify(a); } catch (e) { return String(a); } }
      return String(a);
    }).join(" ");
    return new Date().toISOString().slice(11, 23) + " " + niveau + " " + masquer(texte);
  }
  (function brancherConsole(){
    if (!window.console || console.__rdJournal) return;
    ["log", "info", "warn", "error"].forEach(function(n){
      var o = console[n]; if (typeof o !== "function") return;
      console[n] = function(){
        try { tampon.push(ligneJournal(n, arguments)); if (tampon.length > MAX) tampon.shift(); } catch (e) {}
        return o.apply(this, arguments);
      };
    });
    try { console.__rdJournal = true; } catch (e) {}
  })();

  function lignesEtat(){
    var RD = window.RD || {}, S = RD.stats || {}, info = C.poste.info(), pe = C.poste.etat(), P = window.__rdPct;
    var pc = function(a, p){ return (typeof P === "function" && a && a.length) ? Math.round(P(a, p)) : "-"; };
    var c = ui.actif();
    return [
      "Client web : console " + (C.version || "?") + ", langue " + C.i18n.langue() + ", theme " + (C.shell.etat().theme || "?"),
      "Navigateur : " + (navigator.userAgent || "?"),
      "Page : " + location.protocol + "//" + location.host + ", ecran " + innerWidth + "x" + innerHeight + " @" + (window.devicePixelRatio || 1),
      "Poste : " + (info.plateforme || "?") + " RustDesk " + (info.version || "?") + ", id " + (info.id || "-"),
      "Liaison : relais" + (pe.chiffre === true ? ", chiffre" : pe.chiffre === false ? ", NON chiffre" : "") + ", ecrans " + pe.ecrans.length + " (courant " + (pe.courant + 1) + ")",
      "Video : " + (RD.codec || "logiciel") + (c && c.width ? " " + c.width + "x" + c.height : "") + ", debit cible " + (S.bitrate || "-") + " kbit/s",
      "Aller-retour ms p50/p95/p99 : " + pc(S.delay, 0.5) + "/" + pc(S.delay, 0.95) + "/" + pc(S.delay, 0.99),
      "Decodage ms p50/p95/p99 : " + pc(S.decode, 0.5) + "/" + pc(S.decode, 0.95) + "/" + pc(S.decode, 0.99)
    ];
  }
  // Le texte exporte. Aucune cle, aucun mot de passe, aucun contenu de « peers » : seulement l'etat et le journal.
  function rapport(){
    return ["=== Diagnostic RustDesk Web ===", new Date().toString()].concat(lignesEtat(), ["", "=== Journal (" + tampon.length + " lignes) ==="], tampon).join("\n") + "\n";
  }
  function telecharger(texte, nom){
    var u = URL.createObjectURL(new Blob([texte], { type: "text/plain;charset=utf-8" })), a = document.createElement("a");
    a.href = u; a.download = nom; a.style.display = "none"; document.body.appendChild(a); a.click();
    setTimeout(function(){ try { document.body.removeChild(a); URL.revokeObjectURL(u); } catch (e) {} }, 1000);
  }
  function toast(cle, niveau){ if (typeof window.__rdToast === "function") { try { window.__rdToast(t(cle), niveau || "info"); } catch (e) {} } }

  function verdictRelais(r){
    var conf = r[0] && r[0].verdict, temoin = r[1] && r[1].verdict;
    if (conf === "ACCEPTEE" && temoin === "REFUSEE") return ["ok", "aide.relais.ok"];
    if (temoin === "ACCEPTEE") return ["alerte", "aide.relais.faux"];
    if (conf === "REFUSEE") return ["erreur", "aide.relais.refuse"];
    return ["alerte", "aide.relais.inconnu"];
  }

  function construire(el){
    el.appendChild(noeud("h3", "rdpop-titre", t("bar.aide.titre")));
    var corps = noeud("div", "rdpop-corps"); el.appendChild(corps);
    corps.appendChild(noeud("h4", "rdpop-sous", t("aide.diag")));
    var actions = noeud("div", "rdactions");
    var sortie = noeud("p", "rdaide rdaide-resultat"); sortie.setAttribute("role", "status"); sortie.hidden = true;
    var relais = ui.bouton(t("aide.relais"), function(ev, b){
      if (typeof window.rdRelayTest !== "function") return;
      var l = b.querySelector(".rdlbl"); l.textContent = t("aide.relais.encours"); b.disabled = true;
      Promise.resolve(window.rdRelayTest()).then(function(r){
        var v = verdictRelais(r || []); sortie.textContent = t(v[1]); sortie.setAttribute("data-niveau", v[0]); sortie.hidden = false;
      }).catch(function(){ sortie.textContent = t("aide.relais.inconnu"); sortie.hidden = false; })
        .then(function(){ l.textContent = t("aide.relais"); b.disabled = false; });
    }, "aide", "rdbtn");
    relais.setAttribute("data-action", "relais"); relais.title = t("aide.relais.aide");
    var exporter = ui.bouton(t("aide.journal"), function(){ telecharger(rapport(), "rustdesk-web-journal-" + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "") + ".txt"); toast("aide.journal.ok"); }, "dossier", "rdbtn");
    exporter.setAttribute("data-action", "journal"); exporter.title = t("aide.journal.aide");
    var copier = ui.bouton(t("aide.copier"), function(){
      var texte = lignesEtat().join("\n");
      var f = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(texte) : Promise.reject();
      f.then(function(){ toast("aide.copie"); }, function(){ toast("aide.copie.echec", "erreur"); });
    }, null, "rdbtn");
    copier.setAttribute("data-action", "copier-diag");
    actions.appendChild(relais); actions.appendChild(exporter); actions.appendChild(copier);
    corps.appendChild(actions); corps.appendChild(sortie);
    corps.appendChild(noeud("p", "rdaide rdtb-aide", t("aide.journal.aide")));

    corps.appendChild(noeud("h4", "rdpop-sous", t("aide.apropos")));
    var ap = noeud("dl", "rdapropos");
    var d1 = noeud("dt", null, t("aide.version")), d2 = noeud("dd", null, "console " + (C.version || "?"));
    var d3 = noeud("dt", null, t("aide.source")), d4 = noeud("dd");
    var a = noeud("a", null, "github.com/elzuzu/rustdesk-web-selfhosted");
    a.href = DEPOT; a.target = "_blank"; a.rel = "noopener noreferrer";
    d4.appendChild(a);
    ap.appendChild(d1); ap.appendChild(d2); ap.appendChild(d3); ap.appendChild(d4);
    corps.appendChild(ap);
    corps.appendChild(noeud("p", "rdaide rdtb-aide", t("aide.licence")));
  }

  C.shell.ajouterBouton({ id: "aide", icone: "aide", libelle: "bar.aide", titre: "bar.aide.titre", ordre: 12, popover: construire });
  C.aide = { masquer: masquer, rapport: rapport, journal: function(){ return tampon.slice(); }, lignesEtat: lignesEtat, verdictRelais: verdictRelais };
})();
