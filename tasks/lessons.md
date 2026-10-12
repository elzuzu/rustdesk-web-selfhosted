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

## Banc navigateur : attendre le câblage avant de mesurer le focus
- **Règle** : `sessionSimulee` attend « niveau retenu » puis le câblage de `#rdcanvas` ; `ouvrirTiroir` attend le focus du canvas.
- **Pourquoi** : la sonde de codec est asynchrone et le gabarit appelle `c.focus()` après coup ; un test qui lisait le focus avant
  échouait une fois sur dix, sans régression réelle.
- **Comment l'appliquer** : toute nouvelle aide de banc qui ouvre quelque chose attend l'état final, jamais un `setTimeout`.

## Le banc doit pouvoir se rejouer sans WebCodecs
- **Règle** : `RD_SANS_VIDEODECODER=1 node scripts/test-browser.mjs` supprime `window.VideoDecoder` ; le banc doit passer des deux façons.
- **Pourquoi** : le chemin logiciel (WebGL) ne peint pas de contexte 2D : capture possiblement vide, enregistrement vide. Un test
  qui ne vaut que pour WebCodecs doit le dire.

## Service HTTP maison : HTTP/1.0 et corps toujours lu
- **Règle** : `http.server` en HTTP/1.0, et vider le corps de requête même quand on répond une erreur avant de le lire.
- **Pourquoi** : un corps non lu fait réinitialiser la connexion côté nginx (502 au lieu du 4xx attendu).

## macOS : `sed -i` sans suffixe avale la suite
- **Règle** : `sed -i.bak … && rm *.bak`, ou un petit script Python pour les remplacements multi-lignes.
- **Pourquoi** : le script `sed` est pris pour le suffixe, et la chaîne `&&` s'arrête sans message clair.

## Masquer les secrets du journal exporté, y compris la forme JSON
- **Règle** : le masquage couvre les clés base64 longues, les empreintes `abcdefgh…KLMNOP` et `mot de passe|token|jeton` suivis de
  `:`/`=` avec guillemets optionnels des deux côtés (`{"token": "valeur"}`).
- **Pourquoi** : le premier jet ratait la forme JSON ; le test `console-aide-masquage` l'a trouvé. Tout nouveau secret = nouveau cas de test.

## Un bouton ajouté dans la barre change les listes attendues des tests
- **Règle** : après avoir ajouté un bouton de barre (ici « Postes »), chercher les tests qui énumèrent les boutons (`i18n-anglais`).
