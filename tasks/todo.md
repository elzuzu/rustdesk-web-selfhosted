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

## Phase 1 — Socle « console » sans nouvelle fonction (≈ 8 à 10 h)
- [ ] `scripts/build-web.sh` (node --check par source, IIFE obligatoire, try/catch, concat → `html/rd-console.{js,css}?v=hash`)
- [ ] 2 balises dans le gabarit + `data-rd` dans `wireGlobal` + `RD.insets` dans `fitCanvas` (seules modifications des blocs existants)
- [ ] `web/js/00-store.js` (magasin `rd-console`), `web/js/10-shell.js`, `web/css/console.css`
- [ ] nginx : `location ~ ^/rd-console\.` (`try_files $uri =404`, auth + limit_req + cookie répétés) ; vérifier `gzip_types` / `text/javascript`
- [ ] Outillage : `check-syntax.sh`, `test-template.mjs` (corpus + sortie de build dans le même contexte vm), `test-browser.mjs` (build + `data-rd`)
- [ ] Sortie : matrice de non-régression verte, test de repli (console qui échoue → `#rdbar` intact), captures desktop + mobile

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
