// Ecran de connexion (le formulaire du bundle) : accessibilite et ergonomie, sans toucher a sa logique.
//
//   - des noms accessibles : « Host: », « Key: », « Id: » sont des <span>, pas des <label> ; un
//     lecteur d'ecran n'annonce que « champ de saisie ». On donne un aria-label a chaque champ ;
//   - Entree dans un champ valide la connexion (le formulaire n'est pas un <form> : rien ne le faisait) ;
//   - clavier numerique avec touche « Aller » sur mobile (enterkeyhint) ;
//   - sur un pointeur precis (souris), le curseur arrive dans le champ Id, le seul que l'on remplit ;
//     sur mobile on ne force pas : le clavier a l'ecran masquerait la page.
//
// Independant du tiroir : s'applique des que le formulaire existe, meme si la console ne se monte jamais
// (c'est l'ecran d'AVANT la session). Idempotent ; une erreur ici ne touche a rien d'autre.
(function(){
  var essais = 0, fait = false;

  function habiller(){
    var host = document.getElementById("host"), key = document.getElementById("key"), id = document.getElementById("id");
    var go = document.querySelector("#connect td > button");
    if (!host || !key || !id || !go) return false;
    if (id.getAttribute("data-rdlogin")) return true;
    id.setAttribute("data-rdlogin", "1");
    host.setAttribute("aria-label", "Hôte du serveur");
    key.setAttribute("aria-label", "Clé publique du serveur");
    id.setAttribute("aria-label", "ID du poste distant");
    id.setAttribute("enterkeyhint", "go");
    id.setAttribute("autocapitalize", "off");
    [host, key, id].forEach(function(champ){
      champ.addEventListener("keydown", function(ev){
        if (ev.key !== "Enter" || ev.isComposing || ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return;
        ev.preventDefault();
        go.click();
      });
    });
    try {
      if (!id.value && window.matchMedia && window.matchMedia("(pointer: fine)").matches &&
          document.activeElement === document.body) id.focus();
    } catch (e) {}
    return true;
  }

  function tenter(){
    if (fait) return true;
    try { fait = habiller(); } catch (e) { fait = true; }
    return fait;
  }
  if (!tenter()) {
    var attente = setInterval(function(){
      essais++;
      if (tenter() || essais > 300) clearInterval(attente);
    }, 550);
  }
})();
