// Logique PURE de la console : aucune lecture du DOM, aucune globale hormis
// window.RDConsole. C'est ce qui la rend testable sous Node (scripts/test-template.mjs).
(function(){
  var C = window.RDConsole = window.RDConsole || {};

  // Les memes valeurs sont declarees en CSS (:root --rd-bar-h, --rd-drawer-w, --rd-status-h) :
  // un test les compare.
  var BARRE = 48, TIROIR = 336, STATUT = 30, ETROIT = 720;

  // Espace que la console reserve autour de l'image, en pixels. Hors session
  // rien n'est reserve. Barre haute repliee : l'image garde le haut (seule la
  // poignee flotte). Sur un ecran etroit le tiroir recouvre l'image au lieu de
  // la pousser (feuille basse), donc ne reserve rien a gauche.
  //   e = { enSession, barre: "ouverte"|"repliee", drawer: "ouvert"|"ferme",
  //         statut: "visible"|"masquee", largeur, plein: bool, pleinMasque: bool, clavier: hauteur du clavier virtuel ouvert (px) }
  // En plein ecran avec « masquees » : ni tiroir ni statut, le poste distant garde tout l'ecran. Le clavier virtuel, lui,
  // reste reserve : sans lui l'image passerait dessous.
  function insets(e){
    e = e || {};
    if (!e.enSession) return { top: 0, left: 0, bottom: 0, statutBas: 0 };
    var etroit = e.largeur > 0 && e.largeur < ETROIT;
    var masque = !!(e.plein && e.pleinMasque);
    return {
      top:    e.barre === "ouverte" ? BARRE : 0,
      left:   (e.drawer === "ouvert" && !etroit && !masque) ? TIROIR : 0,
      bottom: ((e.statut === "visible" && !masque) ? STATUT : 0) + (e.clavier > 0 ? Math.round(e.clavier) : 0),
      statutBas: (e.statut === "visible" && !masque) ? STATUT : 0     // le clavier virtuel se pose juste au-dessus
    };
  }

  function nomCodec(c){
    return c === "h265" ? "H.265" : c === "vp9" ? "VP9" : c === "h264" ? "H.264" :
           c === "av1" ? "AV1" : "Logiciel";
  }

  // Les morceaux du resume de la barre de statut : « H.265 1920×1080 », « 4664 kbit/s »,
  // « 60 i/s ». Une valeur inconnue s'affiche « — », jamais « 0 » ni « NaN » (un debit a 0
  // n'est pas une mesure, c'est une absence de mesure ; 0 i/s, lui, en est une).
  //   s = { codec, w, h, kbit, fps }
  function segments(s){
    s = s || {};
    var tete = nomCodec(s.codec);
    if (s.w > 0 && s.h > 0) tete += " " + s.w + "\u00d7" + s.h;
    return [
      tete,
      s.kbit > 0 ? Math.round(s.kbit) + " kbit/s" : "\u2014",
      (s.fps >= 0 && isFinite(s.fps)) ? Math.round(s.fps) + " i/s" : "\u2014"
    ];
  }
  function ligneStatut(s){ return segments(s).join(" / "); }

  // Etat de la liaison d'apres l'aller-retour median (ms). Seuils : sous 60 ms la frappe et
  // la souris paraissent immediates ; au-dela de 150 ms on la sent a chaque geste.
  function sante(rtt){
    if (typeof rtt !== "number" || !isFinite(rtt) || rtt < 0) return "inconnue";
    return rtt <= 60 ? "bonne" : rtt <= 150 ? "moyenne" : "mauvaise";
  }

  // Resume d'une serie de mesures : derniere, min, max, moyenne (null s'il n'y a rien d'exploitable).
  function resume(a){
    var v = (Array.isArray(a) ? a : []).filter(function(x){ return typeof x === "number" && isFinite(x); });
    if (!v.length) return null;
    var min = v[0], max = v[0], somme = 0;
    v.forEach(function(x){ if (x < min) min = x; if (x > max) max = x; somme += x; });
    return { derniere: v[v.length - 1], min: min, max: max, moy: somme / v.length, n: v.length };
  }
  // Ajoute une mesure a une serie bornee (les plus anciennes sortent) ; ignore une mesure illisible.
  function pousser(serie, x, max){
    if (typeof x !== "number" || !isFinite(x)) return serie;
    serie.push(x);
    while (serie.length > (max || 90)) serie.shift();
    return serie;
  }

  C.layout = { BARRE: BARRE, TIROIR: TIROIR, STATUT: STATUT, ETROIT: ETROIT, insets: insets };
  C.mesures = { resume: resume, pousser: pousser };
  C.statut = { nomCodec: nomCodec, segments: segments, ligne: ligneStatut, sante: sante };
})();
