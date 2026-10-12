// Clavier virtuel : un clavier a l'ecran, pose au-dessus de la barre de statut. Pour les ecrans tactiles (qui n'ont pas
// de touches Echap, Tab, Ctrl, Alt, F1 a F12, fleches…) et pour les touches que le navigateur garde pour lui.
//
//   - Ctrl, Alt, Maj et Cmd/Win sont COLLANTS : un appui les arme pour la touche suivante, puis ils se relachent.
//   - Un caractere seul part comme du texte (input_string) : il arrive tel qu'affiche, quelle que soit la disposition du poste.
//     Avec Ctrl, Alt ou Cmd, il part comme une combinaison (input_key, touche en minuscule) : Ctrl+C, Alt+F4…
//   - Les touches nommees (Echap, Tab, Entree, fleches, F1-F12…) partent par input_key, comme sur un vrai clavier.
//   - Le clavier ne prend jamais le focus : la frappe physique continue d'aller au poste en meme temps.
(function(){
  var C = window.RDConsole = window.RDConsole || {};
  var ui = C.ui, t = C.i18n.t, noeud = ui.noeud;

  C.i18n.ajouter({
    fr: { "bar.clavierv": "Clavier", "bar.clavierv.titre": "Clavier virtuel", "clavier.virtuel": "Clavier virtuel",
          "clavier.virtuel.aide": "Un clavier à l'écran : Échap, Tab, flèches, F1–F12, Ctrl, Alt, Cmd/Win.",
          "kb.label": "Clavier virtuel", "kb.ctrl": "Ctrl", "kb.alt": "Alt", "kb.maj": "Maj", "kb.cmd": "Cmd/Win", "kb.espace": "Espace" },
    en: { "bar.clavierv": "Keyboard", "bar.clavierv.titre": "Virtual keyboard", "clavier.virtuel": "Virtual keyboard",
          "clavier.virtuel.aide": "An on-screen keyboard: Esc, Tab, arrows, F1–F12, Ctrl, Alt, Cmd/Win.",
          "kb.label": "Virtual keyboard", "kb.ctrl": "Ctrl", "kb.alt": "Alt", "kb.maj": "Shift", "kb.cmd": "Cmd/Win", "kb.espace": "Space" }
  });

  // [libelle, genre, valeur, largeur] — genre : « c » caractere, « k » touche nommee, « m » modificateur.
  function lettres(l){ return l.split("").map(function(c){ return [c, "c", c, 1]; }); }
  var FONCTION = [["Esc", "k", "Escape", 1.4]].concat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function(n){ return ["F" + n, "k", "F" + n, 1]; }));
  var CHIFFRES = lettres("1234567890-=").concat([["⌫", "k", "Backspace", 1.6]]);
  var MODS = [["kb.ctrl", "m", "ctrl", 1.4], ["kb.alt", "m", "alt", 1.2], ["kb.cmd", "m", "command", 1.6]];
  var FLECHES = [["←", "k", "LeftArrow", 1], ["↑", "k", "UpArrow", 1], ["↓", "k", "DownArrow", 1], ["→", "k", "RightArrow", 1]];
  var DISPOSITIONS = {
    azerty: [FONCTION, CHIFFRES,
             [["Tab", "k", "Tab", 1.4]].concat(lettres("azertyuiop"), [["Suppr", "k", "Delete", 1.5]]),
             lettres("qsdfghjklm").concat([["ù", "c", "ù", 1], ["↵", "k", "Return", 1.6]]),
             [["kb.maj", "m", "shift", 1.6]].concat(lettres("wxcvbn,;:!")),
             MODS.concat([["kb.espace", "k", "Space", 5]], FLECHES)],
    qwerty: [FONCTION, CHIFFRES,
             [["Tab", "k", "Tab", 1.4]].concat(lettres("qwertyuiop"), [["Del", "k", "Delete", 1.5]]),
             lettres("asdfghjkl;").concat([["'", "c", "'", 1], ["↵", "k", "Return", 1.6]]),
             [["kb.maj", "m", "shift", 1.6]].concat(lettres("zxcvbnm,./")),
             MODS.concat([["kb.espace", "k", "Space", 5]], FLECHES)]
  };

  var panneau = null, armes = { ctrl: false, alt: false, shift: false, command: false }, boutonsMod = {};

  function pont(nom, v){ try { window.setByName(nom, v); return true; } catch (e) { console.warn("[clavier virtuel]", e); return false; } }
  function relacher(){
    Object.keys(armes).forEach(function(k){ armes[k] = false; });
    Object.keys(boutonsMod).forEach(function(k){ boutonsMod[k].setAttribute("aria-pressed", "false"); });
  }
  function drapeaux(){ return { alt: String(armes.alt), ctrl: String(armes.ctrl), shift: String(armes.shift), command: String(armes.command) }; }

  // Un appui sur une touche : texte, combinaison ou touche nommee. Rend le message envoye (testable) ou null.
  function appuyer(genre, valeur){
    var d = drapeaux(), msg = null;
    if (genre === "c") {
      if (armes.ctrl || armes.alt || armes.command) msg = { type: "key", name: valeur.toLowerCase(), down: "false", press: "true", alt: d.alt, ctrl: d.ctrl, shift: d.shift, command: d.command };
      else msg = { type: "texte", texte: armes.shift ? valeur.toUpperCase() : valeur };
    } else if (genre === "k") {
      msg = { type: "key", name: valeur, down: "false", press: "true", alt: d.alt, ctrl: d.ctrl, shift: d.shift, command: d.command };
    }
    if (!msg) return null;
    if (msg.type === "texte") pont("input_string", msg.texte);
    else pont("input_key", JSON.stringify({ name: msg.name, down: msg.down, press: msg.press, alt: msg.alt, ctrl: msg.ctrl, shift: msg.shift, command: msg.command }));
    relacher();
    return msg;
  }

  function construire(){
    var disposition = C.i18n.langue() === "fr" ? "azerty" : "qwerty";
    var p = noeud("div"); p.id = "rdvkb"; p.hidden = true;
    p.setAttribute("role", "group"); p.setAttribute("aria-label", t("kb.label")); p.setAttribute("data-disposition", disposition);
    DISPOSITIONS[disposition].forEach(function(rang, i){
      var r = noeud("div", "rdkb-rang"); if (i === 0) r.className += " rdkb-fonction";
      rang.forEach(function(k){
        var libelle = k[0].indexOf("kb.") === 0 ? t(k[0]) : k[0];
        var b = noeud("button", "rdkey", libelle);
        b.type = "button"; b.style.flexGrow = String(k[3]); b.style.flexBasis = "0";
        b.setAttribute("data-genre", k[1]); b.setAttribute("data-valeur", k[2]);
        if (k[1] === "m") { b.setAttribute("aria-pressed", "false"); boutonsMod[k[2]] = b; }
        // Pas de prise de focus : la frappe physique continue d'aller au poste.
        b.addEventListener("pointerdown", function(ev){ ev.preventDefault(); });
        b.addEventListener("mousedown", function(ev){ ev.preventDefault(); });
        b.addEventListener("click", function(){
          if (k[1] === "m") { armes[k[2]] = !armes[k[2]]; b.setAttribute("aria-pressed", armes[k[2]] ? "true" : "false"); return; }
          appuyer(k[1], k[2]);
        });
        r.appendChild(b);
      });
      p.appendChild(r);
    });
    return p;
  }

  function monter(){
    boutonsMod = {}; relacher();
    if (panneau && panneau.parentNode) panneau.parentNode.removeChild(panneau);
    panneau = construire();
    document.body.appendChild(panneau);
  }
  function basculer(on){
    var ouvert = on == null ? C.shell.etat().clavierV !== "ouvert" : on;
    C.shell.memoriser({ clavierV: ouvert ? "ouvert" : "ferme" });
    C.shell.appliquer();
    var s = document.querySelector('#rddrawer .rdsw[data-pour="clavierv"]'); if (s) s.checked = ouvert;
  }

  C.vkb = {
    hauteur: function(){
      var v = 0;
      try { v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rd-vkb-h")); } catch (e) {}
      return v > 0 ? v : 240;
    },
    afficher: function(on){ if (panneau) panneau.hidden = !on; },
    appuyer: appuyer, basculer: basculer, DISPOSITIONS: DISPOSITIONS,
    armes: function(){ return JSON.parse(JSON.stringify(armes)); }
  };

  C.shell.ajouterLigne("clavier", 20, function(){
    return ui.ligne(t("clavier.virtuel"), ui.interrupteur(C.shell.etat().clavierV === "ouvert", function(on){ basculer(on); }, "clavierv"), t("clavier.virtuel.aide"));
  });
  C.shell.ajouterBouton({ id: "clavierv", icone: "clavierv", libelle: "bar.clavierv", titre: "bar.clavierv.titre", ordre: 14,
    surClic: function(){ basculer(); },
    cree: function(b){ b.setAttribute("aria-pressed", C.shell.etat().clavierV === "ouvert" ? "true" : "false"); } });
  C.shell.surMontage(function(){ monter(); C.shell.appliquer(); });
})();
