// Ecran de connexion : deux finitions que la page ne fait pas.
//
// La page (web/src/30-session.js, habillerFormulaire) habille deja le formulaire du bundle : en-tete, <label for=id>,
// lignes hote et cle masquees, Entree qui lance la connexion, case de memorisation, choix de langue. On ne refait RIEN
// de cela ici — une seconde ecoute d'Entree lancerait deux connexions.
//
//   - clavier numerique avec touche « Aller » sur mobile (enterkeyhint) ;
//   - sur un pointeur precis (souris), le curseur arrive dans le champ Id, le seul que l'on remplit ;
//     sur mobile on ne force pas : le clavier a l'ecran masquerait la page.
//
// Independant du tiroir : s'applique des que le formulaire existe, meme si la console ne se monte jamais
// (c'est l'ecran d'AVANT la session). Idempotent ; une erreur ici ne touche a rien d'autre.
(function(){
  var essais = 0, fait = false;

  function habiller(){
    var id = document.getElementById("id");
    if (!id) return false;
    if (id.getAttribute("data-rdlogin")) return true;
    id.setAttribute("data-rdlogin", "1");
    id.setAttribute("enterkeyhint", "go");
    id.setAttribute("autocapitalize", "off");
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
