// Textes de la console, en francais et en anglais.
//
// Chaque module declare ses cles par C.i18n.ajouter({ fr: {...}, en: {...} }) : les textes restent a cote du
// code qui les emploie, et un test verifie la parite des deux langues (memes cles, memes {parametres}).
// Langue : « auto » suit celle du navigateur (francais ailleurs que « en » → anglais), ou « fr » / « en » force.
(function(){
  var C = window.RDConsole = window.RDConsole || {};
  var CAT = { fr: {}, en: {} }, courante = "fr", abonnes = [];

  function ajouter(parLangue){
    ["fr", "en"].forEach(function(l){
      var src = parLangue && parLangue[l];
      if (src) Object.keys(src).forEach(function(k){ CAT[l][k] = src[k]; });
    });
  }
  function detecter(pref){
    if (pref === "fr" || pref === "en") return pref;
    var l = "fr";
    try { l = String((window.navigator && window.navigator.language) || "fr").toLowerCase(); } catch (e) {}
    return l.indexOf("fr") === 0 ? "fr" : "en";
  }
  // t("cle", { n: 3 }) : remplace {n}. Une cle absente d'une langue retombe sur le francais, puis sur la cle elle-meme
  // (jamais de page vide, jamais d'exception).
  function t(cle, p){
    var s = CAT[courante][cle];
    if (s == null) s = CAT.fr[cle];
    if (s == null) return cle;
    return String(s).replace(/\{(\w+)\}/g, function(_, k){ return p && p[k] != null ? p[k] : ""; });
  }
  function definir(pref){
    var avant = courante;
    courante = detecter(pref);
    try { document.documentElement.setAttribute("lang", courante); } catch (e) {}
    if (avant !== courante) abonnes.slice().forEach(function(f){ try { f(courante); } catch (e) {} });
    return courante;
  }
  C.i18n = {
    t: t, ajouter: ajouter, definir: definir, detecter: detecter,
    langue: function(){ return courante; },
    surChangement: function(f){ abonnes.push(f); },
    catalogue: function(l){ return CAT[l]; }
  };
})();
