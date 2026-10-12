// Logique PURE de la liste des postes (page d'accueil et changement de poste) : aucune lecture du DOM, aucun reseau.
// Testable sous Node. Le service (fleet/server.py) valide les memes regles : on ne les fait pas confiance, on les partage.
(function(){
  var C = window.RDConsole = window.RDConsole || {};

  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{4,31}$/;                  // ID RustDesk : chiffres, ou 5 a 32 caracteres sobres
  var MAX_ETIQUETTES = 8, LONG_ETIQUETTE = 24;

  function normaliserId(s){ return String(s == null ? "" : s).replace(/\s+/g, ""); }     // « 123 456 789 » -> « 123456789 »
  function idValide(s){ return typeof s === "string" && ID_RE.test(s); }
  function fmtId(id){
    if (window.RDLib && window.RDLib.fmtId) { var f = window.RDLib.fmtId(id); if (f) return f; }
    return /^\d+$/.test(id) ? String(id).replace(/(\d{3})(?=\d)/g, "$1 ") : String(id);
  }
  function nomAffiche(p){ return (p && p.nom) ? p.nom : fmtId(p && p.id); }

  // Sans accents ni casse : « Éléonore » se trouve en tapant « eleo ».
  function plier(s){
    var t = String(s == null ? "" : s).toLowerCase();
    try { t = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) { /* navigateur sans normalize */ }
    return t;
  }
  // Tous les mots saisis doivent se retrouver (nom, ID, note, etiquettes) : « mac maison » ne garde que les postes qui portent les deux.
  function filtrer(postes, texte){
    var mots = plier(texte).split(/\s+/).filter(Boolean);
    if (!mots.length) return postes.slice();
    return postes.filter(function(p){
      var foin = plier([p.nom, p.id, normaliserId(fmtId(p.id)), p.note, (p.etiquettes || []).join(" ")].join(" "));
      return mots.every(function(m){ return foin.indexOf(m) >= 0; });
    });
  }
  // Epingles d'abord, puis en ligne, puis inconnus, puis hors ligne ; a egalite, derniere connexion la plus recente, puis nom.
  function poids(e){ return e === true ? 2 : e === false ? 0 : 1; }
  function trier(postes){
    return postes.map(function(p, i){ return [p, i]; }).sort(function(a, b){
      var x = a[0], y = b[0];
      if (!!y.favori !== !!x.favori) return y.favori ? 1 : -1;
      if (poids(y.en_ligne) !== poids(x.en_ligne)) return poids(y.en_ligne) - poids(x.en_ligne);
      var cx = x.derniere_connexion || 0, cy = y.derniere_connexion || 0;
      if (cx !== cy) return cy - cx;
      var nx = plier(nomAffiche(x)), ny = plier(nomAffiche(y));
      if (nx !== ny) return nx < ny ? -1 : 1;
      return a[1] - b[1];
    }).map(function(a){ return a[0]; });
  }
  // « maison, mac ,Maison » -> ["maison", "mac"] ; { ok:false, cle } si une etiquette est hors limites.
  function etiquettesDepuis(texte){
    var vus = [], liste = [];
    String(texte || "").split(",").forEach(function(x){
      var e = x.trim();
      if (e && vus.indexOf(plier(e)) < 0) { vus.push(plier(e)); liste.push(e); }
    });
    if (liste.length > MAX_ETIQUETTES || liste.some(function(e){ return e.length > LONG_ETIQUETTE || /[\x00-\x1f]/.test(e); })) return { ok: false, cle: "flotte.err.tags" };
    return { ok: true, liste: liste };
  }
  // Depuis combien de temps (secondes Unix). Rend { unite: "jamais" | "now" | "min" | "h" | "j", n }.
  function relatif(ts, maintenant){
    if (!ts) return { unite: "jamais", n: 0 };
    var s = Math.max(0, Math.floor(maintenant - ts));
    if (s < 60) return { unite: "now", n: 0 };
    if (s < 3600) return { unite: "min", n: Math.floor(s / 60) };
    if (s < 86400) return { unite: "h", n: Math.floor(s / 3600) };
    return { unite: "j", n: Math.floor(s / 86400) };
  }
  function compter(postes){
    var connus = postes.filter(function(p){ return p.en_ligne === true || p.en_ligne === false; }).length;
    return { total: postes.length, enLigne: postes.filter(function(p){ return p.en_ligne === true; }).length, etatConnu: connus > 0 };
  }
  // Un nom d'hote devient un nom de poste : 60 caracteres, sans caractere de controle.
  function nomDepuisHote(h){ return String(h || "").replace(/[\x00-\x1f]/g, " ").trim().slice(0, 60); }

  // Un fichier d'import (celui qu'exporte la page, ou une simple liste) : ne garde que ce qui est valide, rien d'autre. Au plus 500 postes ;
  // un champ inconnu n'est jamais recopie. Rend { postes, ignores } ou null si le fichier n'est pas du JSON exploitable.
  function importDepuis(texte){
    var j;
    try { j = JSON.parse(texte); } catch (e) { return null; }
    var liste = Array.isArray(j) ? j : (j && Array.isArray(j.postes) ? j.postes : null);
    if (!liste) return null;
    var postes = [], ignores = 0, vus = {};
    liste.forEach(function(x){
      var id = x && typeof x === "object" ? normaliserId(x.id) : "";
      if (!idValide(id) || vus[id] || postes.length >= 500) { ignores++; return; }
      var p = { id: id };
      if (typeof x.nom === "string" && x.nom.length <= 60 && !/[\x00-\x1f]/.test(x.nom)) p.nom = x.nom.trim();
      if (typeof x.note === "string" && x.note.length <= 500) p.note = x.note.trim();
      if (Array.isArray(x.etiquettes)) { var e = etiquettesDepuis(x.etiquettes.filter(function(v){ return typeof v === "string"; }).join(",")); if (e.ok) p.etiquettes = e.liste; }
      if (x.favori === true) p.favori = true;
      vus[id] = true; postes.push(p);
    });
    return { postes: postes, ignores: ignores };
  }

  C.flotte = { importDepuis: importDepuis, idValide: idValide, normaliserId: normaliserId, fmtId: fmtId, nomAffiche: nomAffiche, plier: plier, filtrer: filtrer, trier: trier,
               etiquettesDepuis: etiquettesDepuis, relatif: relatif, compter: compter, nomDepuisHote: nomDepuisHote,
               MAX_ETIQUETTES: MAX_ETIQUETTES, LONG_ETIQUETTE: LONG_ETIQUETTE };
})();
