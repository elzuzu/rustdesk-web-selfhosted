# Aligner rustdesk-web sur la console GLKVM — travail actif

Plan complet : `~/.claude/plans/warm-whistling-thacker.md` (approuvé le 2026-10-12).
Cadre : on fait évoluer **ce client web RustDesk**. GL.iNet (GLKVM, glkvm-cloud) n'est qu'une **référence d'interface et de
paramètres** ; aucun composant GL.iNet, aucun WebRTC. Périmètre : console de session + flotte d'appareils ; usage Alex + proches.
Contrainte : **toutes les fonctions existantes conservées et intégrées logiquement**.

## Phase 0 — Réconcilier et poser la base
- [x] Fusion locale de `origin/main` (`e6345f0`), sans push (décision d'Alex requise ; `59f9661` n'est pas sur GitHub)
- [x] `html/` régénéré (`extract-assets.sh` puis `patch-assets.sh`) : le patch `__rdZstdDecoder` manquait
- [x] Banc navigateur : 15/18 → **18/18** (le banc supposait `#player` ; avec décodage matériel le canvas actif est `#rdcanvas`)
- [x] Plancher de tests dans `verify.sh` : gabarit ≥ 123, navigateur ≥ 18 (à relever quand on ajoute des tests)
- [x] `logs/` dans `.gitignore`
- [x] Baseline complète `./scripts/verify.sh` (Docker + Chrome réel) : tout vert

**Baseline 2026-10-12** : banc du gabarit 123/123 · banc Chromium 18/18 (chemins matériel et logiciel) · images construites ·
`/healthz` 204, `/` 401, `index.js.orig` 404 · format de fil d'authentification conforme.
Lancer le banc navigateur : `NODE_PATH=<dir>/node_modules RD_PW_CHANNEL=chrome ./scripts/verify.sh`
(`playwright-core@1.56.1` installé **hors dépôt**).

## Phase 1 — Socle « console » sans nouvelle fonction (≈ 8 à 10 h) — FAIT, à relire
- [x] `scripts/build-web.sh` (node --check, IIFE obligatoire, try/catch par module, sortie `html/rd-console.{js,css}`)
- [x] Gabarit : 2 balises ; `data-rd` (7 reperes) ; `zoneImage()` — `fitCanvas` et `placerHud` mesurent le conteneur `#canvas`
- [x] `web/js/00-store.js` (magasin `rd-console`), `01-pure.js` (insets, ligne de statut), `10-shell.js`, `web/css/console.css`
- [x] nginx : `location ~ ^/rd-console\.(js|css)$` (auth + limit_req + cookie répétés, `try_files =404`, `no-cache`)
- [x] Outillage : `setup.sh`, `verify.sh`, CI, `test-browser.mjs` appellent `build-web.sh` ; planchers 141 / 26
- [x] Tests : +18 (Node) et +8 (Chromium) ; repli si la console échoue ; retour arrière si le montage échoue en cours de route
- [x] Contrôle visuel desktop (barre repliée / dépliée / tiroir ouvert) et mobile 390×844
- [ ] Contrôle avec un vrai pair (session réelle) — avec l'accord d'Alex

**Écarts assumés par rapport au plan** (corrigés dans le code, pas dans le plan approuvé) :
- pas de `RD.insets` ni de nom suffixé d'un hash : l'espace est réservé en CSS pur (`--rd-top/left/bottom` sur `<html>`, `#canvas` se cale dedans)
  et `fitCanvas`/`placerHud` mesurent `#canvas` ; noms de fichiers fixes, revalidés (`no-cache`) — moins de pièces mobiles, même effet.
- `gzip_types` : vérifié, nginx:alpine (1.31) sert déjà `.js` en `application/javascript` ; rien à corriger. `verify.sh` contrôle le gzip.
- `RDLib` n'est pas touché (magasin `rd-console` dans `web/js/00-store.js`).

**Limite héritée (non corrigée)** : en chemin logiciel (ogv.js), le HUD et la barre de statut affichent « 0 i/s » faute de compteur de trames (seul le chemin WebCodecs l'alimente).

## Passe design « top-end 2026 » — FAIT (commit à venir)
- [x] Jetons `oklch()` + `light-dark()` ; thème Auto / Clair / Sombre (`rd-console.theme`) ; zone de l'image toujours noire
- [x] Icônes SVG inline (jeu cohérent, 24×24, trait 1,75) ; barre haute : Session, poste distant (ID), Fichiers, Quitter
- [x] Tiroir : aide d'une ligne par réglage, interrupteurs natifs `role="switch"`, groupe radio ARIA, sections animées (`::details-content`)
- [x] Barre de statut : segments + point de santé de la liaison (seuils 60 / 150 ms, médiane du RTT), `—` si pas de mesure
- [x] Panneau Fichiers et fenêtre modale re-thémés ; feuille basse mobile avec poignée ; zones sûres ; cibles 44 px en tactile
- [x] Accessibilité : contraste 4,5:1 / 3:1 mesuré dans les deux thèmes, mouvement réduit, contraste renforcé, couleurs forcées
- [x] Écran de connexion : carte adaptative (plus de débordement à 390 px), noms ARIA, Entrée valide, `enterkeyhint`, focus selon le pointeur
- [x] Tests : Node 123 → 146, Chromium 18 → 42 (deux chemins de décodage) ; `verify.sh` complet vert, planchers 146 / 42
- Écarté : thème de l'écran de connexion suivant le système (exigerait un script avant le premier rendu, flash de thème, gain mince)
- Écarté : réordonner visuellement les lignes du formulaire (casserait l'ordre de tabulation)
- À faire plus tard : thème « Auto » de la connexion si Alex le veut ; icônes pour la poignée repliée

## Phase 2A / 2B — fonctions de session — FAIT
- [x] Socle : `02-i18n` (FR/EN, parité testée), `08-ui` (widgets), registre du shell (`ajouterLigne/Bouton`, `surMontage`), `99-demarrage`
- [x] A : menu Poste (Ctrl+Alt+Suppr, verrouiller, redémarrer en 2 clics, écrans, confidentialité, blocage, verrou en fin, presse-papier, curseur),
      grisé avec raison selon plateforme/version ; plein écran + Keyboard Lock ; statut Relais/Chiffré (`connection_ready`) ; son (`disable-audio`)
- [x] Entrées : souris relative (type 5, sensibilité), bouton principal, vitesse + sens de molette (le gabarit n'est pas touché : pont `setByName`
      enveloppé + captures document), Retour/Avance, anti-veille, touches Impr. écran/Menu/Pause
- [x] B : clavier virtuel (AZERTY/QWERTY, modificateurs collants, sans voler le focus, image calée au-dessus), raccourcis (OS du poste + les vôtres),
      statistiques (4 courbes), export du journal sans secret, thème, FR/EN, vue 1:1 (3ᵉ retouche du gabarit : `fitCanvas`), À propos + lien source (AGPL 13)
- [x] C retenus : capture d'écran, enregistrement vidéo
- Écartés (dit une fois) : rotation (sans usage pour un poste distant, et fausse `pos()`), volume (PCMPlayer interne), micro / OCR / terminal /
  H264-AV1 / mur d'écrans (non vérifiables sans pair réel ou exigent le patch 6 du bundle ; go/no-go d'Alex), tactile par gestes (le clavier virtuel
  et les événements souris synthétiques couvrent l'usage)

## Phase 3 — flotte d'appareils — FAIT
- [x] 3.0 : vecteurs d'or calculés à la main = vecteurs produits par le code ; faux hbbs TCP dans les tests ; `scripts/online-probe.py`
- [x] 3.1 `fleet/server.py` (stdlib, SQLite, cache 10 s, validation stricte, CSRF `X-RD` + `Sec-Fetch-Site`) + `fleet/Dockerfile` + 19 tests
- [x] 3.2 nginx : `location /api/` (zone `rdapi`, `resolver` + variable, `resolver_timeout 2s`) ; compose : profil `fleet`, lecture seule, sans privilège
- [x] 3.3 client : « Mes postes » (tri, recherche, ajout/modif/retrait, favoris, export/import, auto-ajout), sélecteur « Postes » en session, repli sans service
- [x] 3.4 `setup.sh` (question, profil, contrôles, 21115 en avertissement seulement), `verify.sh` (tests, image, nginx de bout en bout, service absent), CI, `docs/FLOTTE.md`
- Non vérifié contre un vrai hbbs (aucun n'était disponible ici) : le cadrage est confirmé par le source de RustDesk et par un faux hbbs ; `online-probe.py` le confirmera chez Alex

## Version finale 1.0.0
- [x] `VERSION`, `CHANGELOG.md`, READMEs FR/EN, `docs/FLOTTE.md`
- [ ] Contrôle avec un vrai pair et un vrai hbbs (Alex) — voir « Non vérifié » ci-dessus
- [ ] Push (décision d'Alex ; publierait aussi `59f9661`)

## Réconciliation avec `origin/main` (2026-11-12) — FAIT, fusion `6752939` sur `main`, poussée
`main` local (9 commits, console + flotte, v1.0.0) et `origin/main` (8 commits : codecs, entrées, écran de connexion, CSP, langue,
`web/src/`) avaient divergé depuis `e1928dd`. Fusion faite dans une branche à part, puis `main` avancé dessus et poussé.

- [x] Conflits de texte : `nginx.conf.template`, `scripts/verify.sh`, les deux bancs ; `web/index.html.template` supprimé côté
      distant → les 4 retouches locales du gabarit sont reportées dans `web/src/page.html` et `web/src/30-session.js`
- [x] Règle : **la page fait, la console présente**. Par recouvrement — connexion (structure : page ; apparence : console),
      langue (page seule, réglage du tiroir retiré), plein écran / actions / écrans / options (fenêtres de la console, qui
      pilotent les contrôles de la page ; état confirmé par le poste), raccourcis traduits (interrupteur du tiroir),
      calage d'image (zone libre de la console + calage au pixel de la page)
- [x] nginx : les 5 en-têtes de sécurité répétés dans `location ~ ^/rd-console` et `location /api/` (ils n'héritaient de rien)
- [x] Bancs : gabarit 205, navigateur 112 (108 + 4 ignorés et annoncés sans WebCodecs) ; option `sansConsole` pour les tests de la barre d'origine ; clavier PC forcé ;
      `RenderDocument` non coupé (Chrome 157 sans tête refusait tout plein écran sous Playwright 1.56.1)
- Retiré : le choix de langue du tiroir (et la clé `langue` du magasin `rd-console`) ; l'écoute d'Entrée et les `aria-label`
  de `05-login.js` (la page le fait, avec un vrai `<label>`) ; les titres de carte écrits en CSS (sauf l'écran d'attente)
- Reste à trancher par Alex : deux boutons « Clavier » sur écran tactile (clavier de l'appareil, de la page ; clavier virtuel,
  de la console) — complémentaires, mais de même libellé
- Toujours non vérifié contre un vrai pair et un vrai hbbs : voir « Version finale 1.0.0 »

## Matrice de non-régression (14 fonctions à protéger)
Connexion ID/clé/hôte · mot de passe mémorisé · résolution + Ajuster · qualité/cadence/codec mémorisés · Ctrl↔Cmd ·
presse-papier texte · presse-papier image/HTML · fichiers · HUD traversant · bannières d'erreur · reprise auto · wake lock ·
diagnostics console · auth Basic + cookie + rate-limit.

## Repéré, hors périmètre (non planifié sauf accord)
- ~~Pas de CSP ; `add_header` perdus dans les `location` authentifiées~~ — réglé par la ligne GitHub (`6ff2694`), étendu aux blocs de la console et de l'API
- `set_real_ip_from 172.18.0.0/16` codé en dur
- Secrets cuits dans l'image (ne jamais la pousser sur un registre public)
- `setup.sh` saute l'extraction des assets si `html/js/dist/index.js.orig` existe (assets périmés après un pull)
- Pas de procédure de sauvegarde/mise à jour ; CI GitHub jamais exécutée (compte verrouillé) → `verify.sh` local fait foi

## Décisions encore ouvertes (défaut retenu)
1. Mise en page réservée (GLKVM) ou superposée → **réservée**
2. Phase 4 : lesquelles → capture/enregistrement canvas + H264/AV1 ; le reste après essai ; terminal seulement si patch 6 accepté
3. Langues → FR + EN
4. Pousser la fusion sur GitHub → **non**, jusqu'à accord d'Alex

## Bilan
(à compléter en fin de phase)
