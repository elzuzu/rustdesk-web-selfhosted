// Magasin des reglages de la console, sous la cle « rd-console ».
//
// Meme contrat que RDLib.prefs (liste blanche, jamais de cle inconnue recopiee,
// repli en memoire si le stockage refuse l'ecriture) mais INDEPENDANT de
// « rd-prefs » : aucune migration, aucun risque pour les reglages existants
// (qualite, cadence, codec, barre). RDLib n'est pas touche.
(function(){
  var C = window.RDConsole = window.RDConsole || {};

  var OK = {
    drawer:       ["ouvert", "ferme"],
    statut:       ["visible", "masquee"],
    secVideo:     ["ouverte", "fermee"],
    secClavier:   ["ouverte", "fermee"],
    secSouris:    ["ouverte", "fermee"],
    secAffichage: ["ouverte", "fermee"]
  };
  var DEFAUT = {
    drawer: "ferme", statut: "visible",
    secVideo: "ouverte", secClavier: "ouverte", secSouris: "ouverte", secAffichage: "ouverte"
  };
  var CLE = "rd-console";

  // Une valeur inconnue (ancienne version, stockage corrompu, cle « __proto__ »)
  // est ignoree, jamais recopiee.
  function propre(src){
    var r = {};
    if (!src || typeof src !== "object") return r;
    Object.keys(OK).forEach(function(k){
      if (!Object.prototype.hasOwnProperty.call(src, k)) return;
      if (OK[k].indexOf(src[k]) >= 0) r[k] = src[k];
    });
    return r;
  }
  function lire(storage, key){ try { return storage.getItem(key); } catch (e) { return null; } }
  function json(t){ try { return t == null ? null : JSON.parse(t); } catch (e) { return null; } }

  function creer(storage, opts){
    var key = (opts && opts.key) || CLE, mem = null;

    function stocke(){
      if (mem) return propre(mem);
      var j = json(lire(storage, key));
      return (j && j.v === 1) ? propre(j) : {};
    }
    function complet(partiel){
      var r = {};
      Object.keys(DEFAUT).forEach(function(k){ r[k] = DEFAUT[k]; });
      Object.keys(partiel).forEach(function(k){ r[k] = partiel[k]; });
      return r;
    }
    return {
      get: function(){ return complet(stocke()); },
      // patch : { drawer, statut, secVideo, … } ; null retire une valeur (retour au defaut).
      // Rend vrai si l'ecriture a tenu (relue).
      set: function(patch){
        var cur = stocke(), p = patch || {};
        Object.keys(p).forEach(function(k){
          if (p[k] === null){ delete cur[k]; return; }
          var un = {}; un[k] = p[k];
          var f = propre(un);
          if (Object.prototype.hasOwnProperty.call(f, k)) cur[k] = f[k];
        });
        var o = { v: 1 };
        Object.keys(cur).forEach(function(k){ o[k] = cur[k]; });
        var texte = JSON.stringify(o), ok = false;
        try { storage.setItem(key, texte); ok = storage.getItem(key) === texte; } catch (e) { ok = false; }
        mem = ok ? null : cur;
        return ok;
      },
      reset: function(){
        mem = null;
        try { storage.removeItem(key); } catch (e) { return false; }
        return true;
      }
    };
  }

  C.store = { OK: OK, DEFAUT: DEFAUT, create: creer };
})();
