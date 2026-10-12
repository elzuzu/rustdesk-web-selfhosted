# Leçons

## GLKVM est une référence, pas une dépendance (Alex, 2026-10-12)
- **Règle** : le chantier fait évoluer le client web RustDesk. On reprend l'**interface et les paramètres** de la console GLKVM ;
  on n'intègre aucun composant GL.iNet (glkvm-cloud, rttys, TURN, firmware) et on n'ajoute pas de WebRTC.
- **Pourquoi** : Alex l'a rappelé en cours d'exécution — « l'objectif c'est pas d'utiliser GL.iNet en plus, c'est d'avoir un
  front/gui web similaire et de porter les mêmes paramètres, pas d'ajouter la prise en compte de rtc ».
- **Comment l'appliquer** : tout réglage repris de GLKVM doit se traduire en message/option RustDesk (`OptionMessage`, `Misc`,
  `KeyEvent`…) ou en comportement navigateur. Ce qui est matériel (Virtual Media, Accessories, EDID, Apps Center, transports
  WebRTC/FEC) reste exclu. Le service « flotte » est un petit service à nous qui interroge hbbs, pas un glkvm-cloud.

## Un banc qui suppose le chemin logiciel masque le chemin réel
- **Règle** : un test navigateur ne doit pas coder en dur `#player` ; il compare à `window.__rdActive()`.
- **Pourquoi** : avec un décodeur WebCodecs matériel (le cas d'un Mac), le canvas actif est `#rdcanvas` ; trois tests échouaient
  sans régression réelle, ce qui rend un échec ultérieur indéchiffrable.
- **Comment l'appliquer** : lancer le banc sur les deux chemins (avec et sans `VideoDecoder`) avant d'annoncer qu'il est vert.

## Après un `git pull`, régénérer `html/`
- **Règle** : `./scripts/extract-assets.sh && ./scripts/patch-assets.sh` après toute fusion qui touche `assets/` ou `patch-assets.sh`.
- **Pourquoi** : `html/` est gitignoré et `setup.sh` saute l'extraction s'il existe ; le banc navigateur lit `html/` directement
  (le patch `__rdZstdDecoder` manquait, d'où un échec faussement attribué au code).

## Mesurer un style qui transite : finir les animations d'abord
- **Règle** : avant de lire une couleur ou une position calculée dans un test, appeler `document.getAnimations().forEach(a => a.finish())`.
- **Pourquoi** : après un changement de thème, le fond d'un bouton transite sur 120 ms ; lu trop tôt, il donnait un faux contraste de
  1,03:1. De même une feuille qui glisse affichait 12 px au lieu de 30.
- **Comment l'appliquer** : tout test de contraste, de position ou de taille après une interaction.

## Un défaut mobile peut venir de l'écran d'avant, pas de la fonction testée
- **Règle** : sur téléphone, mesurer `document.documentElement.scrollWidth` contre `innerWidth` avant d'accuser le nouveau code.
- **Pourquoi** : la poignée sortait de l'écran à 477 px ; la cause était le formulaire de connexion du bundle (`min-width:22rem`), qui
  dézoomait toute la page. Le banc simulait une session sans masquer ce formulaire, comme le fait la vraie.

