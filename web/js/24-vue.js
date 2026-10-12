// « Vue » : l'image distante ajustee a la fenetre, ou en pixel d'origine (1 pixel distant = 1 pixel physique, avec defilement).
// Le reglage vit dans rd-console ; le shell le pose sur <body data-rd-vue> et fitCanvas (gabarit) le lit.
(function(){
  var C = window.RDConsole = window.RDConsole || {};
  var ui = C.ui, t = C.i18n.t;

  C.i18n.ajouter({
    fr: { "video.vue": "Vue", "video.vue.aide": "Ajustée : toute l'image dans la fenêtre. 1:1 : un pixel distant pour un pixel d'écran, avec défilement.",
          "vue.ajuste": "Ajustée", "vue.pixel": "1:1" },
    en: { "video.vue": "View", "video.vue.aide": "Fitted: the whole image in the window. 1:1: one remote pixel per screen pixel, scrolling if needed.",
          "vue.ajuste": "Fitted", "vue.pixel": "1:1" }
  });

  C.shell.ajouterLigne("video", 60, function(){
    return ui.ligne(t("video.vue"), ui.segmente([["ajuste", t("vue.ajuste")], ["pixel", t("vue.pixel")]], C.shell.etat().vue, function(v){
      C.shell.memoriser({ vue: v });
      C.shell.appliquer();                           // pose data-rd-vue puis recale l'image
      if (typeof window.__rdFit === "function") window.__rdFit();
    }), t("video.vue.aide"));
  });
})();
