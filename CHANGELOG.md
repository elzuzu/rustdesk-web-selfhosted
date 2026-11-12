# Journal des versions

## Non publié — fusion des deux lignes de développement

La console de session et la liste des postes (1.0.0, ci-dessous) et la ligne publiée sur GitHub (codecs, entrées, écran de
connexion, sécurité, langue) avaient avancé séparément depuis `e1928dd`. Elles sont réunies. Règle de la fusion : **la page fait,
la console présente** — une seule implémentation par fonction, et la console pilote les contrôles de la page au lieu de les refaire.

### Apporté par la ligne GitHub
- **Codecs** H264 et AV1 en plus de H265 et VP9, sondés et annoncés au pair ; le décodeur suit le flux reçu.
- **Entrées** : tactile (un doigt la souris, deux la molette), molette cumulée, capture du pointeur, clavier de l'appareil.
- **Clavier** : raccourcis **traduits** entre PC et Mac (plus une simple permutation Ctrl/Cmd), AltGr, relâchements exacts.
- **Presse-papier** : distant vers local sans bouton ; local vers distant sur accord (« Presse-papier automatique »).
- **Écran de connexion** : en-tête, un seul champ, mot de passe incorrect redemandé, mémorisation au choix, **2FA**.
- **Sécurité** : politique de contenu (CSP), `Referrer-Policy`, `Permissions-Policy`, en-têtes répétés dans chaque `location`
  (y compris, désormais, celles de la console et de l'API de la flotte) ; message du pair échappé (correctif 6 du bundle).
- **Session** : plus de coupure en onglet caché, couleurs exactes (BT.601), image calée au pixel physique.
- **Sources** : la page est découpée dans `web/src/` et assemblée par `scripts/build-page.py` ; application installable.

### Arbitrages (une implémentation par fonction)
- **Écran de connexion** : structure, textes et comportement de la page ; l'apparence (carte, contraste mesuré, téléphone) vient
  de la console. `web/js/05-login.js` ne garde que « Aller » sur le clavier mobile et le focus initial.
- **Langue** : un seul réglage, celui de l'écran de connexion (`rd-prefs.lang`). La console le suit ; le choix de langue du
  tiroir est **retiré** (changer de langue en session aurait laissé la page à moitié traduite).
- **Plein écran** : le bouton de la console clique celui de la page — une seule capture du clavier, un seul message.
- **Actions, écrans, options du poste** : présentés par la fenêtre « Poste » ; les menus `<select>` de la page restent dans la
  barre sans s'afficher, et reparaissent si la console ne se monte pas. L'état d'une option (confidentialité, blocage de la
  saisie) est celui que **le poste a confirmé**, plus celui que l'on suppose après un clic.
- **Presse-papier automatique** : nouvel interrupteur dans « Poste », qui pilote la fonction de la page.
- **Raccourcis** : l'interrupteur « Traduire les raccourcis » remplace « Ctrl devient Cmd » ; grisé, avec la raison, entre deux
  postes de même famille.
- **Calage de l'image** : la zone libre entre les barres (console) passe par le calage au pixel physique (page) ; la vue 1:1 reste.
- **Limitation de débit** : 60 requêtes/min avec rafale de 100 (mesuré le 2026-09-15), au lieu de 20/min et 40.

### Copier-coller de fichiers, comme avec le client natif
- **De la machine locale vers le poste** : un fichier copié ici se colle (`Ctrl+V` / `Cmd+V`) là où se trouve le curseur du poste
  distant. **Du poste vers la machine locale** : un fichier copié là-bas se télécharge ici d'un clic (un navigateur ne peut pas
  déposer un fichier dans le presse-papier du système). C'est le presse-papier de fichiers de RustDesk (`Cliprdr`).
- **Un collage n'ouvre plus jamais le panneau Fichiers.** Si le poste ne connaît pas ce presse-papier, la page le dit à l'écran
  (système et version du poste) et s'arrête là ; le panneau reste accessible par son bouton.
- **Poste Windows piloté depuis un Mac ou un Linux.** Un PC répond `has_file_clipboard: false` à un client qui n'est pas sous
  Windows, mais accepte ses fichiers (vérifié dans sa source, 1.3.8 à 1.5.3). La page exigeait « vrai » et retombait sur le
  panneau ; elle fait maintenant comme le client natif. Une ligne `[fichiers] …` en console dit, à chaque session, le système
  du poste, sa version et ce qu'il annonce.
- **La page annonce une version (1.3.9), sa plateforme et l'option de fichiers à la connexion.** Elle n'annonçait aucune version :
  le poste la traitait en client d'avant 1.2.0 — pas de presse-papier de fichiers, et un presse-papier distant → local réduit
  au texte. Conséquences traitées : `CaptureDisplays` après un changement d'écran (sinon le poste capture les deux),
  `TogglePrivacyMode` pour le mode confidentialité.
- Format vérifié contre les tests du pair (RustDesk 1.5.3) : descripteur de 592 octets, dates, plages en entiers non signés.
  Une liste reçue mal formée, trop longue ou dont un nom remonte l'arborescence est rejetée en entier.
- **Les dossiers passent aussi.** Un dossier collé ici part avec toute son arborescence (chaque dossier annoncé avant son
  contenu, comme le fait le client natif ; sous-dossiers vides compris). Un dossier copié sur le poste se télécharge en une
  archive `.zip` qui le reconstitue — un navigateur ne sait pas déposer une arborescence. Le bouton dit « Dossier copié ⇩ »
  ou « N éléments copiés ⇩ ».
- Limites : 10 000 éléments et des chemins de 259 caractères par collage ; coller un dossier demande Chrome ou Edge (ailleurs,
  la page dit qu'elle ne peut pas le lire) ; 2 Gio par fichier reçu, 4 Gio et 65 535 éléments par archive de dossier.

### Installation (révélé par un conteneur candidat monté à côté du site en service, le 2026-11-12)
- **Installation neuve : la page répondait 403 à l'utilisateur connecté.** `setup.sh` passe en `umask 077` pour protéger `.env`
  et `nginx.conf` ; tout `html/` sortait donc en 700/600, illisible par les workers nginx (sur une mise à jour : les nouveaux
  fichiers seulement, dont `rd-console.js`). Sans identifiants on voyait toujours 401. `setup.sh` rend l'arborescence lisible
  avant de construire, et une page qui ne répond pas 200 **avec** les identifiants fait désormais échouer l'installation.
- **Plusieurs noms pour le même site** : `RD_DOMAIN_ALIASES` (question « autres noms » de `setup.sh`). Relancer `setup.sh`
  réécrivait le Caddyfile avec un seul nom ; un second nom ajouté à la main cessait de répondre en HTTPS.
- **Mot de passe non mémorisé** : un `.env` où `RD_WEB_PASSWORD` a été vidé (le serveur ne garde que le hachage, dans
  `.htpasswd`) faisait refuser toute mise à jour. `setup.sh` garde alors le `.htpasswd` existant tel quel et fait ses
  contrôles « connecté » avec le cookie de session.
- `verify.sh` rejoue la séquence de `setup.sh` sous `umask 077` et charge la page **avec** le cookie de session.

### Bancs de test
- Gabarit 216 tests, navigateur 114 ; planchers de `verify.sh` relevés. Rejoué sans WebCodecs (`RD_SANS_VIDEODECODER=1`) : 108, et
  4 tests propres à WebCodecs ignorés et annoncés.
- Le banc navigateur ne dépend plus de la machine : clavier PC forcé dans les deux tests de raccourcis (ils échouaient sur un Mac),
  et Chrome est lancé sans couper `RenderDocument` (Playwright 1.56.1 la coupe ; sous Chrome 157 sans tête, tout plein écran
  était alors refusé).

## 1.0.0 — console de session complète et liste des postes

Alignement du client web RustDesk sur l'**interface et les réglages** de la console GL.iNet GLKVM — sans composant GL.iNet et sans
WebRTC : le client parle toujours le protocole RustDesk à votre hbbs/hbbr.

### Console de session
- **Disposition** : barre haute, tiroir « Réglages de session » (Vidéo, Audio, Clavier, Souris, Affichage), fenêtres flottantes,
  barre de statut (codec, résolution, débit, images/s, **santé de la liaison**, **Relais / Chiffré**). Toutes les fonctions
  existantes sont conservées, déplacées et non réécrites.
- **Menu Poste** : Ctrl+Alt+Suppr, verrouiller, **redémarrer** (deux clics), choix de l'**écran**, mode confidentialité, blocage des
  entrées, verrouillage en fin de session, presse-papier partagé, curseur dans l'image. Une fonction impossible sur le poste est
  grisée avec sa raison.
- **Entrées** : souris **relative** (pair ≥ 1.4.5) avec sensibilité, **bouton principal**, **vitesse** et **sens** du défilement,
  boutons **Retour / Avance**, **anti-veille**, touches Impr. écran / Menu / Pause, **clavier virtuel**, **plein écran avec
  verrouillage du clavier**.
- **Toolbox** : envoyer / taper du texte, raccourcis par OS du poste et personnalisés, **capture d'écran**, **enregistrement vidéo**.
- **Statistiques** (4 courbes), **Aide** (test du relais, **journal exportable sans secret**, à propos et lien vers la source).
- **Thèmes** clair / sombre / auto, **français et anglais**, vue **1:1**, accessibilité vérifiée par mesure (contraste 4,5:1 et 3:1,
  mouvement réduit, couleurs forcées, cibles tactiles de 44 px).
- **Écran de connexion** refait (carte adaptative ; il débordait d'un téléphone et dézoomait la page), champs nommés, **Entrée** valide.

### Liste des postes (service facultatif `fleet`)
- Page **Mes postes** (nom, note, étiquettes, favori, dernière connexion, **état en ligne**), recherche, ajout / modification /
  retrait, export / import JSON, sélecteur **Postes** en session, ajout automatique d'un poste connecté.
- Service Python standard + SQLite, conteneur en lecture seule sans privilège, derrière l'authentification de nginx, **garde CSRF**,
  aucun mot de passe de poste côté serveur. L'état en ligne vient de hbbs (TCP 21115) ; inconnu n'est jamais « hors ligne ».
- nginx : `location /api/` (zone de débit séparée, résolution à la requête : le service est facultatif, son absence ne casse rien).

### Outillage
- `scripts/build-web.sh` (sources IIFE, `try/catch` par module, analyse en script classique, version injectée), `scripts/online-probe.py`.
- Bancs : gabarit 149 tests, Chromium 86 tests (chemins matériel **et** logiciel), service 19 tests ; **planchers** dans `verify.sh`.
- `verify.sh` éprouve aussi nginx + service de bout en bout et le cas « service absent » (502, nginx tient).

### Mise à jour depuis une version précédente
```bash
git pull && ./setup.sh        # régénère nginx.conf (nouvelle location) et html/ (rd-console.*) ; répondre à « liste des postes »
```
Sans relancer `setup.sh`, l'ancienne `nginx.conf` sert la console mais pas `/api/` : la page reste fonctionnelle, sans la liste.

### Limites connues
- Non vérifié sur un vrai pair : souris relative, Retour/Avance, redémarrage, verrouillage, confidentialité/blocage sous macOS.
- Capture / enregistrement : sur le repli de décodage logiciel (WebGL), la capture peut être vide.
- Non repris (matériel GLKVM ou hors périmètre) : Virtual Media, accessoires ATX/Fingerbot, EDID, Apps Center, micro/caméra, OCR,
  Wake-on-LAN, terminal, mur d'écrans, comptes multiples / SSO / 2FA / audit.
