(function(){
  var HOST="__RD_DOMAIN__";
  var KEY="__RD_PUBLIC_KEY__";

  // Le stockage ne doit jamais faire tomber une session : le quota est une
  // limite du navigateur, pas une erreur applicative. En cas de debordement
  // on elague le champ "info" (PeerInfo complet, binaire serialise) qui en
  // est la cause, en conservant le mot de passe memorise.
  var _si = Storage.prototype.setItem;
  Storage.prototype.setItem = function(k, v){
    if (typeof v === "string" && (k === "key" || k === "rendezvous-server" || k === "custom-rendezvous-server" || k === "id")) {
      v = v.trim();
    }
    try { _si.call(this, k, v); }
    catch (e) {
      console.warn("[stockage] ecriture ignoree:", k, "(" + e.name + ")");
      if (k === "peers") {
        try {
          var P = JSON.parse(v), c = 0;
          for (var id in P) { if (P[id] && P[id].info) { delete P[id].info; c++; } }
          _si.call(this, "peers", JSON.stringify(P));
          console.warn("[stockage] quota : " + c + " champ(s) info elague(s), reste conserve");
        } catch(_) { try { _si.call(this, "peers", "{}"); } catch(__){} }
      }
    }
  };

  var _gi = Storage.prototype.getItem;
  Storage.prototype.getItem = function(k){
    var v = _gi.call(this, k);
    if (typeof v === "string" && (k === "key" || k === "rendezvous-server" || k === "custom-rendezvous-server" || k === "id")) {
      return v.trim();
    }
    return v;
  };

  // Les pairs portent le mot de passe memorise : ne PAS les effacer.
  (function(){
    try{
      var P=JSON.parse(localStorage.getItem("peers")||"{}"), n=0;
      for(var id in P){ if(P[id]&&P[id].info){ delete P[id].info; n++; } }
      localStorage.setItem("peers",JSON.stringify(P));
      if(n) console.log("[pairs] "+n+" fiche(s) elaguee(s), mots de passe conserves");
    }catch(e){ localStorage.setItem("peers","{}"); }
  })();

  localStorage.setItem("custom-rendezvous-server",(HOST||"").trim());
  localStorage.setItem("rendezvous-server",(HOST||"").trim());
  localStorage.setItem("key",(KEY||"").trim());
  if(localStorage.getItem("id")===null)localStorage.setItem("id","__RD_DEFAULT_PEER_ID__");

  // Ce que le deploiement a cuit dans la page, expose pour les autres blocs :
  // le diagnostic doit pouvoir comparer ce que le navigateur ENVOIE (qui vient
  // de localStorage, et peut etre perime) avec ce que cette page PRESCRIT.
  window.__rdCleConfig  = (KEY||"").trim();
  window.__rdHoteConfig = (HOST||"").trim();
})();
