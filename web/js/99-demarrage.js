// Demarrage de la console : appele en DERNIER (ordre numerique des sources), quand tous les modules se sont
// enregistres aupres du shell. Le shell attend ensuite que la page soit prete avant de monter quoi que ce soit.
(function(){
  var C = window.RDConsole;
  if (C && C.shell && typeof C.shell.demarrer === "function") C.shell.demarrer();
})();
