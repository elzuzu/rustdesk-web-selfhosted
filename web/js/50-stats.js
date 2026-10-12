// Statistiques de connexion : l'aller-retour, le temps de decodage, les images par seconde et le debit, en courbes sur
// une fenetre glissante d'environ 90 secondes. Les percentiles restent dans le HUD ; ici on voit la TENDANCE.
//
// Les mesures viennent du gabarit (RD.stats), echantillonnees ici : rien n'est envoye, rien n'est stocke.
// Il n'y a pas de « perte de paquets » : ce client parle TCP (WebSocket) au relais, la perte se voit en latence.
(function(){
  var C = window.RDConsole = window.RDConsole || {};
  var ui = C.ui, t = C.i18n.t, noeud = ui.noeud, M = C.mesures, FENETRE = 90;

  C.i18n.ajouter({
    fr: {
      "bar.stats": "Stats", "bar.stats.titre": "Statistiques de connexion", "stats.vide": "En attente de mesures…",
      "stats.rtt": "Aller-retour", "stats.decode": "Décodage", "stats.fps": "Images par seconde", "stats.debit": "Débit cible",
      "stats.u.ms": "ms", "stats.u.fps": "i/s", "stats.u.kbit": "kbit/s",
      "stats.bornes": "min {a} · moy {b} · max {c}", "stats.pct": "p50 {a} · p95 {b} · p99 {c}",
      "stats.aide": "Fenêtre d'environ 90 s. Pas de perte de paquets ici : la liaison est TCP, une perte se voit en latence."
    },
    en: {
      "bar.stats": "Stats", "bar.stats.titre": "Connection statistics", "stats.vide": "Waiting for measurements…",
      "stats.rtt": "Round trip", "stats.decode": "Decode time", "stats.fps": "Frames per second", "stats.debit": "Target bitrate",
      "stats.u.ms": "ms", "stats.u.fps": "fps", "stats.u.kbit": "kbit/s",
      "stats.bornes": "min {a} · avg {b} · max {c}", "stats.pct": "p50 {a} · p95 {b} · p99 {c}",
      "stats.aide": "About 90 s window. No packet loss here: the link is TCP, a loss shows up as latency."
    }
  });

  var series = { rtt: [], decode: [], fps: [], debit: [] }, dernier = { frames: 0, t: 0 }, minuterie = null;
  function pct(a, p){ var P = window.__rdPct; return (typeof P === "function" && a && a.length) ? P(a, p) : NaN; }

  function echantillonner(){
    var RD = window.RD || {}, S = RD.stats || {}, now = Date.now();
    M.pousser(series.rtt, pct(S.delay, 0.5), FENETRE);
    M.pousser(series.decode, pct(S.decode, 0.5), FENETRE);
    if (dernier.t) { var dt = (now - dernier.t) / 1000; if (dt > 0.2) M.pousser(series.fps, ((S.frames || 0) - dernier.frames) / dt, FENETRE); }
    dernier.frames = S.frames || 0; dernier.t = now;
    if (S.bitrate > 0) M.pousser(series.debit, S.bitrate, FENETRE);
  }

  // La couleur d'un jeton, resolue par le navigateur (oklch, light-dark : on ne reimplemente aucune conversion).
  function couleur(jeton){
    var e = document.createElement("i"); e.style.color = "var(--" + jeton + ")"; e.style.display = "none";
    document.body.appendChild(e);
    var c = getComputedStyle(e).color; document.body.removeChild(e);
    return c;
  }
  function courbe(cv, valeurs, jeton){
    var dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 280, h = cv.clientHeight || 52;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var g = cv.getContext("2d"); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    var r = M.resume(valeurs); if (!r) return;
    if (valeurs.length === 1) valeurs = [valeurs[0], valeurs[0]];        // une seule mesure : un trait plat, pas un point
    var lo = Math.min(r.min, 0), hi = Math.max(r.max, lo + 1), pas = valeurs.length > 1 ? w / (FENETRE - 1) : 0;
    var x0 = w - (valeurs.length - 1) * pas;
    var y = function(v){ return h - 3 - ((v - lo) / (hi - lo)) * (h - 8); };
    var c = couleur(jeton);
    g.beginPath();
    valeurs.forEach(function(v, i){ var px = x0 + i * pas, py = y(v); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.strokeStyle = c; g.lineWidth = 1.75; g.lineJoin = "round"; g.stroke();
    g.lineTo(x0 + (valeurs.length - 1) * pas, h); g.lineTo(x0, h); g.closePath();
    g.globalAlpha = 0.14; g.fillStyle = c; g.fill(); g.globalAlpha = 1;
  }
  function nombre(v, dec){ return isFinite(v) ? (dec ? v.toFixed(dec) : String(Math.round(v))) : "—"; }

  function construire(el, pop){
    el.appendChild(noeud("h3", "rdpop-titre", t("bar.stats.titre")));
    var corps = noeud("div", "rdpop-corps rdstats"); el.appendChild(corps);
    var METRIQUES = [["rtt", "stats.rtt", "stats.u.ms", "rd-accent", true], ["decode", "stats.decode", "stats.u.ms", "rd-ok", true],
                     ["fps", "stats.fps", "stats.u.fps", "rd-warn", false], ["debit", "stats.debit", "stats.u.kbit", "rd-text-2", false]];
    var cartes = {};
    METRIQUES.forEach(function(m){
      var c = noeud("section", "rdstat"); c.setAttribute("data-metrique", m[0]);
      var tete = noeud("div", "rdstat-tete");
      tete.appendChild(noeud("span", "rdstat-nom", t(m[1])));
      var val = noeud("span", "rdstat-val", "—"); tete.appendChild(val);
      var cv = noeud("canvas", "rdstat-cv"); cv.setAttribute("role", "img"); cv.setAttribute("aria-label", t(m[1]));
      var pied = noeud("div", "rdstat-pied", "");
      c.appendChild(tete); c.appendChild(cv); c.appendChild(pied); corps.appendChild(c);
      cartes[m[0]] = { val: val, cv: cv, pied: pied, def: m };
    });
    corps.appendChild(noeud("p", "rdaide rdtb-aide", t("stats.aide")));

    function dessiner(){
      var RD = window.RD || {}, S = RD.stats || {};
      METRIQUES.forEach(function(m){
        var k = cartes[m[0]], r = M.resume(series[m[0]]);
        if (!r) { k.val.textContent = "—"; k.pied.textContent = t("stats.vide"); courbe(k.cv, [], m[3]); return; }
        k.val.textContent = nombre(r.derniere, m[0] === "fps" ? 1 : 0) + " " + t(m[2]);
        var pied = t("stats.bornes", { a: nombre(r.min, m[0] === "fps" ? 1 : 0), b: nombre(r.moy, m[0] === "fps" ? 1 : 0), c: nombre(r.max, m[0] === "fps" ? 1 : 0) });
        if (m[4]) pied += "  |  " + t("stats.pct", { a: nombre(pct(S[m[0] === "rtt" ? "delay" : "decode"], 0.5)), b: nombre(pct(S[m[0] === "rtt" ? "delay" : "decode"], 0.95)), c: nombre(pct(S[m[0] === "rtt" ? "delay" : "decode"], 0.99)) });
        k.pied.textContent = pied;
        courbe(k.cv, series[m[0]], m[3]);
      });
    }
    el.__dessiner = dessiner;
    var tick = setInterval(function(){
      if (el.isConnected) { el.__vu = true; if (pop.estOuvert()) dessiner(); } else if (el.__vu) clearInterval(tick);
    }, 900);
    el.addEventListener("beforetoggle", function(ev){ if (ev.newState === "open") { echantillonner(); setTimeout(dessiner, 0); } });
  }

  C.shell.ajouterBouton({ id: "stats", icone: "stats", libelle: "bar.stats", titre: "bar.stats.titre", ordre: 60, popover: construire });
  C.shell.surMontage(function(){ if (!minuterie) minuterie = setInterval(echantillonner, 900); });
  C.stats = { series: series, echantillonner: echantillonner };
})();
