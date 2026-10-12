// Ce que l'on sait du poste distant et de la liaison, relevé SANS toucher au gabarit : on enveloppe
// window.onGlobalEvent (les evenements du bundle) et on lit window.curConn.
//
//   - peer_info          : plateforme, version, liste des ecrans, ecran courant
//   - switch_display     : ecran courant apres un changement
//   - connection_ready   : { secure, direct } — ce client passe TOUJOURS par le relais (pas d'UDP), « direct » est donc faux ;
//                          « secure » dit si l'echange de cles a abouti.
(function(){
  var C = window.RDConsole = window.RDConsole || {};
  var etat = { chiffre: null, direct: false, ecrans: [], courant: 0, hote: "", session: 0 }, abonnes = [];

  function val(x){ if (typeof x !== "string") return x; try { return JSON.parse(x); } catch (e) { return x; } }
  function vrai(x){ x = val(x); return x === true || x === "true" || x === 1; }
  function prevenir(){ abonnes.slice().forEach(function(f){ try { f(etat); } catch (e) {} }); }

  function observer(payload){
    var e; try { e = JSON.parse(payload); } catch (x) { return; }
    if (!e || typeof e.name !== "string") return;
    if (e.name === "connection_ready") {
      etat.chiffre = vrai(e.secure); etat.direct = vrai(e.direct); prevenir();
    } else if (e.name === "peer_info") {
      var d = val(e.displays);
      etat.ecrans = Array.isArray(d) ? d.map(function(x, i){
        return { index: i, w: x && x.width | 0, h: x && x.height | 0, nom: x && x.name ? String(x.name) : "", en_ligne: !x || x.online !== false };
      }) : [];
      etat.courant = parseInt(val(e.current_display) || 0, 10) || 0;
      var h = val(e.hostname); etat.hote = typeof h === "string" ? h.slice(0, 60) : "";
      etat.session++;                                             // une nouvelle session (peer_info arrive une fois par session)
      prevenir();
    } else if (e.name === "switch_display") {
      var n = parseInt(val(e.display), 10);
      if (n >= 0) { etat.courant = n; prevenir(); }
    }
  }

  var orig = window.onGlobalEvent;
  window.onGlobalEvent = function(payload){
    try { observer(payload); } catch (e) { /* observer ne doit jamais empecher le gabarit de traiter l'evenement */ }
    return typeof orig === "function" ? orig.apply(this, arguments) : undefined;
  };

  // Une nouvelle session repart de zero : le chiffrement d'hier ne dit rien de celle-ci.
  function oublier(){ etat.chiffre = null; etat.direct = false; etat.ecrans = []; etat.courant = 0; etat.hote = ""; prevenir(); }

  C.poste = {
    etat: function(){ return etat; },
    // Plateforme et version du pair, lues sur la connexion courante (« Windows » | « Linux » | « Mac OS » | …).
    info: function(){
      var c = window.curConn, pi = c && c._peerInfo;
      return { plateforme: (pi && pi.platform) || "", version: (pi && pi.version) || "", id: (c && c._id) || "" };
    },
    // Un reglage du pair (« disable-audio », « privacy-mode »…), tel que le bundle le memorise pour ce poste.
    option: function(nom){ var c = window.curConn; return !!(c && c._options && c._options[nom]); },
    surChangement: function(f){ abonnes.push(f); },
    oublier: oublier,
    _observer: observer
  };
})();
