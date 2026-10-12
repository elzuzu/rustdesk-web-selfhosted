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
// tout l'habillage, n'est posee qu'a la FIN d'un montage reussi.
(function(){
  var C = window.RDConsole = window.RDConsole || {};

  var stockage = (function(){
    try { return C.store.create(window.localStorage); }
    catch (e) {
      return C.store.create({ getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} });
    }
  })();
  var etat = stockage.get();

  var monte = false, renonce = false, essais = 0;
  var barre = null, tiroir = null, statut = null, btnSession = null, observateur = null;
  var deplaces = [], ligneEl = null, etatEl = null, pastilleEl = null;
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
  function ligne(libelle, controle, aide){
    var l = noeud("div", "rdrow");
    l.appendChild(noeud("span", "rdlib", libelle));
    var tag = String(controle.tagName || "").toUpperCase();
    if ((tag === "SELECT" || tag === "INPUT") && !controle.getAttribute("aria-label")) {
      controle.setAttribute("aria-label", libelle);
    }
    l.appendChild(controle);
    if (aide) l.title = aide;
    return l;
  }
  function section(cle, titre, lignes){
    var d = noeud("details", "rdsec");
    d.setAttribute("data-sec", cle);
    d.open = etat[cle] === "ouverte";
    d.appendChild(noeud("summary", null, titre));
    var corps = noeud("div", "rdsec-corps");
    lignes.forEach(function(l){ corps.appendChild(l); });
    d.appendChild(corps);
    d.addEventListener("toggle", function(){
      var p = {}; p[cle] = d.open ? "ouverte" : "fermee";
      memoriser(p);
    });
    return d;
  }
  function interrupteur(coche, auChangement, aide){
    var cb = noeud("input", "rdsw");
    cb.type = "checkbox";
    cb.checked = !!coche;
    if (aide) cb.title = aide;
    cb.addEventListener("change", function(){ auChangement(cb.checked); rendreFocus(); });
    return cb;
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
    appliquer();
    if (rendre) rendreFocus();
  }

  // Resume en une ligne ; le detail (percentiles) reste dans le HUD, qui est conserve.
  function majStatut(){
    if (!monte) return;
    if (statut.hidden){ mesure.t = 0; return; }
    var RD = window.RD || {}, S = RD.stats || {}, c = actif(), t = Date.now(), ips = -1;
    if (mesure.t){
      var dt = (t - mesure.t) / 1000;
      if (dt > 0.2) ips = ((S.frames || 0) - mesure.frames) / dt;
    }
    mesure.frames = S.frames || 0; mesure.t = t;
    ligneEl.textContent = C.statut.ligne({
      codec: RD.codec, w: c && c.width, h: c && c.height, kbit: S.bitrate, fps: ips
    });
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
      var st = document.documentElement.style;
      ["--rd-top", "--rd-left", "--rd-bottom"].forEach(function(p){ st.removeProperty(p); });
    } catch (e) {}
    // Remettre les controles dans la barre, dans leur ordre d'origine, avant le
    // premier enfant qui n'est pas le bouton vert du presse-papier.
    if (barre) {
      var ancre = barre.firstChild;
      while (ancre && ancre.className && String(ancre.className).indexOf("rdppbtn") >= 0) ancre = ancre.nextSibling;
      deplaces.forEach(function(d){ try { d.parent.insertBefore(d.n, ancre); } catch (e) {} });
    }
    [tiroir, statut, btnSession].forEach(function(n){ try { if (n && n.parentNode) n.parentNode.removeChild(n); } catch (e) {} });
    deplaces = []; monte = false;
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
      var fermer = noeud("button", "rdfermer", "⟨");
      fermer.type = "button"; fermer.title = "Fermer les réglages";
      fermer.setAttribute("aria-label", "Fermer les réglages");
      fermer.addEventListener("click", function(){ reglerTiroir(false, true); });
      tete.appendChild(fermer);
      tiroir.appendChild(tete);

      var corps = noeud("div", "rdcorps");
      corps.appendChild(section("secVideo", "Vidéo", [
        ligne("Résolution distante", sel),
        ligne("Ajuster à la fenêtre", fit),
        ligne("Qualité", qual),
        ligne("Cadence max", fps),
        ligne("Codec", cod)
      ]));
      corps.appendChild(section("secClavier", "Clavier", [
        ligne("Ctrl ↔ Cmd", swp, "Convertit Ctrl en Cmd (copier/coller macOS) ou le transmet tel quel (terminal)")
      ]));
      corps.appendChild(section("secSouris", "Souris", [
        ligne("Souris haute fréquence", interrupteur(rd.coalesce, function(on){
          if (typeof window.rdCoalesce === "function") window.rdCoalesce(on);
        }, "Événements pointeur groupés : plus fidèles, mais plus de débit sortant"))
      ]));
      corps.appendChild(section("secAffichage", "Affichage", [
        ligne("Barre de statut", interrupteur(etat.statut === "visible", function(on){
          memoriser({ statut: on ? "visible" : "masquee" }); appliquer();
        }))
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
        rendreFocus();
      });

      // --- barre de statut
      statut = noeud("div"); statut.id = "rdstatut"; statut.hidden = true;
      pastilleEl = noeud("span", "rdpastille", "●");
      pastilleEl.setAttribute("aria-hidden", "true");
      ligneEl = noeud("span", "rdst-ligne");
      ligneEl.setAttribute("aria-hidden", "true");     // releve continu : jamais annonce
      etatEl = noeud("span", "rdst-etat");
      etatEl.setAttribute("role", "status");
      statut.appendChild(pastilleEl); statut.appendChild(ligneEl); statut.appendChild(etatEl);

      // --- bouton « Session » dans la barre haute
      btnSession = noeud("button", "rdsession", "⚙ Session");
      btnSession.type = "button";
      btnSession.setAttribute("data-rd", "session");
      btnSession.setAttribute("aria-controls", "rddrawer");
      btnSession.setAttribute("aria-expanded", "false");
      btnSession.title = "Réglages de la session";
      btnSession.addEventListener("click", function(){ reglerTiroir(etat.drawer !== "ouvert", true); });
      barre.insertBefore(btnSession, barre.firstChild);

      document.body.appendChild(tiroir);
      document.body.appendChild(statut);

      if (typeof MutationObserver === "function") {
        observateur = new MutationObserver(appliquer);
        observateur.observe(barre, { attributes: true, attributeFilter: ["class", "style"] });
      } else {
        setInterval(appliquer, 700);
      }
      window.addEventListener("resize", appliquer);
      setInterval(majStatut, 1200);

      monte = true;
      document.body.classList.add("rd-console");     // en DERNIER : l'habillage n'existe qu'apres un montage reussi
      appliquer();
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
