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

## Phase 2A / 2B — Fonctions de session (≈ 18 à 22 h)
- [ ] A : Poste (Ctrl+Alt+Suppr, verrouiller, redémarrer, confidentialité, bloquer entrées) · plein écran + Keyboard Lock · moniteur ·
      barre de statut · souris (caractérisation d'abord) · vidéo (vue, latence) · audio muet
- [ ] B : souris relative · rotation (+ `pos()`) · clavier virtuel · raccourcis · statistiques · export · thème · FR/EN · tactile · À propos

## Phase 3 — Flotte d'appareils (≈ 13 à 17 h)
- [ ] 3.0 essai bloquant `scripts/online-probe.py` → hbbs:21115 depuis un conteneur du pont
- [ ] 3.1 `fleet/` (Python stdlib) · 3.2 nginx (`resolver` + `set $fleet`, zone `rdapi`, CSRF) · 3.3 client · 3.4 exploitation + tests

## Phase 4 — À la carte (après go/no-go)
- [ ] enregistrement + capture canvas · H264/AV1 · micro · OCR · mur d'écrans · terminal (si patch 6 accepté)

## Matrice de non-régression (14 fonctions à protéger)
Connexion ID/clé/hôte · mot de passe mémorisé · résolution + Ajuster · qualité/cadence/codec mémorisés · Ctrl↔Cmd ·
presse-papier texte · presse-papier image/HTML · fichiers · HUD traversant · bannières d'erreur · reprise auto · wake lock ·
diagnostics console · auth Basic + cookie + rate-limit.

## Repéré, hors périmètre (non planifié sauf accord)
- Pas de CSP ; `add_header` du niveau `server` nginx probablement perdus dans les `location` authentifiées (déduit, non testé)
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
