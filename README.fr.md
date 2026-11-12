# RustDesk Web — client web auto-hébergé

*[English version](README.md)*

Un client web RustDesk fonctionnel, servi par nginx, avec TLS automatique et sans
dépendance à un tunnel ou à un service tiers. Souris, clavier, presse-papier,
audio, résolution dynamique et décodage vidéo **matériel** via WebCodecs.

> *Projet indépendant, non affilié au projet RustDesk ni à Purslane Ltd.*

## Pourquoi ce dépôt existe

Le client web auto-hébergé est officiellement une fonction de RustDesk Server
**Pro**. La version open source (V1) a été retirée du dépôt public entre juillet
2025 et la version 1.4.4 : `flutter/web/` n'existe plus sur `master` ni sur aucun
tag récent — l'interface Dart reste ouverte, la couche de connexion JS/WASM non.

Il subsiste une image communautaire, [`pmietlicki/rustdesk-web-client`](https://hub.docker.com/r/pmietlicki/rustdesk-web-client),
qui contient les fichiers compilés. Elle sert l'application Flutter avec un pont
JavaScript qui n'expose que dix fonctions là où cette application en appelle
plusieurs dizaines : la connexion échoue avant d'aboutir. Ce dépôt repart donc du
**client V1 autonome** présent dans la même image — la partie qui est cohérente
avec elle-même — corrige quatre défauts de son bundle, et **réimplémente tout ce
qui manquait** : le client d'origine ne câble que l'affichage.

## Ce qui fonctionne

| | |
|---|---|
| Vidéo | H265 ou H264 **matériel** des deux côtés via WebCodecs, puis AV1, VP9, et le logiciel en dernier recours ; couleurs exactes, affichage au pixel près quand les tailles le permettent |
| Souris | déplacement, clics gauche/droit, coordonnées mises à l'échelle ; un glisser terminé hors de l'image relâche quand même le bouton |
| Molette, trackpad | les pixels sont cumulés en crans : un trackpad ne défile plus dix fois trop vite |
| Tactile | un doigt pilote la souris (toucher, glisser, appui long = clic droit), deux doigts font défiler ; un bouton sort le clavier de l'appareil |
| Plein écran | avec capture du clavier sur Chromium : Échap, Alt+Tab, Cmd+W partent au poste distant |
| Clavier | texte, accents, dispositions non-US, touches mortes, caractères AltGr, touches de contrôle |
| Raccourcis PC ↔ Mac | traduits vers la combinaison de même effet (copier, déplacements par mot et par ligne, Début/Fin, Alt+F4…), ou transmis bruts pour un terminal distant |
| Presse-papier | texte, **images et texte enrichi** dans les deux sens ; une copie distante arrive seule dans le presse-papier local, et le local peut suivre automatiquement (sur accord, Chromium) |
| Fichiers | **copier ici, coller là-bas** : un fichier copié sur ta machine se colle (`Ctrl+V` / `Cmd+V`) là où se trouve le curseur du poste distant, comme avec le client natif ; un fichier copié sur le poste se télécharge ici d'un clic. Et le panneau distant : naviguer, téléverser, télécharger, créer, renommer, supprimer |
| Résolution | menu des modes réellement supportés, « ajuster à la fenêtre » |
| Écrans | un sélecteur pour passer d'un moniteur du poste distant à l'autre, affiché s'il en a plusieurs |
| Actions distantes | Ctrl+Alt+Suppr, verrouillage, redémarrage, son distant coupé, presse-papier suspendu, mode confidentialité, blocage de la saisie locale |
| 2FA | un pair qui exige un code de vérification le demande, au lieu d'échouer sur « Login Error » |
| Curseur | le vrai curseur distant, avec son point chaud |
| Audio | Opus, avec réveil du contexte au premier geste |
| Déploiements sans coupure | la couche TLS patiente pendant un redémarrage du conteneur au lieu d'échouer |
| Onglet caché | la session survit à un changement d'onglet : la lecture ne dépend plus de minuteurs que le navigateur ralentit |
| Reprise automatique | une session coupée se relance seule, avec délai croissant — pas de retour au formulaire |
| Réglages | qualité, plafond de cadence et codec sont **mémorisés** et réappliqués à chaque session, reprise automatique comprise |
| Barre de réglages | se replie en une petite poignée : le coin haut-droit de l'écran distant reste cliquable |
| Connexions récentes | les dix derniers postes, par nom et ID, sous le champ de connexion |
| Langue | français ou anglais, selon le navigateur ou le choix fait sur l'écran de connexion |
| Installable | un manifeste d'application : la page s'installe comme une application, dans une fenêtre sans onglets |
| Veille écran | l'écran ne se verrouille pas tant qu'une session est active, comme YouTube en lecture |
| Mesure | percentiles p50/p95/p99 de latence et de décodage, en surimpression |
| Accès | authentification Basic + cookie de session de 90 jours |
| Durcissement | politique de contenu, aucune requête vers un tiers, texte du pair jamais injecté comme du HTML |

**Non supporté** : coller un fichier du Mac dans le Finder local. Voir
[Transfert de fichiers](#transfert-de-fichiers) — ce n'est pas une limite de ce
dépôt, mais du web lui-même.

## Prérequis

- `docker`, le plugin `docker compose` v2, `python3`, `curl`, `openssl`, `tar`
- **Linux, macOS ou Windows.** Une seule valeur change selon la plateforme :
  `RD_BACKEND_HOST`, l'adresse par laquelle le conteneur web joint hbbs/hbbr.
  `setup.sh` détecte la plateforme et propose la bonne valeur.

  | Plateforme | Valeur | Vérifié |
  |---|---|---|
  | Linux, hbbs/hbbr en `network_mode: host` | `172.17.0.1` | oui |
  | macOS (OrbStack, Docker Desktop) | `host.docker.internal` | oui, sur OrbStack |
  | Windows (Docker Desktop) | `host.docker.internal` | par symétrie, non testé |
  | serveur RustDesk sur une autre machine | son nom ou son IP | — |

  Sur macOS, `172.17.0.1` **ne joint pas l'hôte** — il ne fonctionne qu'entre
  conteneurs. `network_mode: host` pour Caddy fonctionne en revanche : OrbStack
  et Docker Desktop reportent le port 443 sur la machine.
- Un serveur RustDesk **OSS** (hbbs/hbbr) joignable, ports WebSocket 21118 et
  21119 accessibles depuis le conteneur web
- Un nom de domaine pointant en **A direct** vers cette machine, sans proxy.
  Plusieurs noms pour le même site : `setup.sh` demande les « autres noms »
  (`RD_DOMAIN_ALIASES`), et Caddy délivre un certificat à chacun
- Le port **443** ouvert dans le pare-feu local **et** chez ton hébergeur
  (security list OCI, security group AWS…). Le port 80 peut rester fermé :
  le certificat s'obtient par TLS-ALPN-01, qui n'utilise que le 443.

## Installation

```bash
git clone https://github.com/elzuzu/rustdesk-web-selfhosted.git
cd rustdesk-web-selfhosted
./setup.sh
```

L'assistant demande le domaine, les identifiants d'accès, l'hôte de ton serveur
RustDesk et sa clé publique, puis génère la configuration, extrait et corrige les
assets, construit les images et vérifie que tout répond. Le relancer est sans
danger : il reprend tes réponses précédentes.

### Configuration du serveur RustDesk

Deux exigences côté hbbs, sans lesquelles le client web ne fonctionnera pas :

```yaml
command: hbbs --mask 192.168.0.0/16 -k _   # PAS de -r / -R
command: hbbr -k _
```

- **Pas de `-r`/`-R`** : si hbbs impose un relais, le navigateur tentera un
  `wss://` vers un hôte sans TLS et la session échouera. Sans ce drapeau, hbbs
  renvoie un relais vide et le client retombe sur `/ws/relay` de la même origine.
- **`-k _` est indispensable** : sans clé, `hbbr` est un **relais ouvert** que
  n'importe qui sur Internet peut utiliser.

Et sur le **poste contrôlé**, retirer tout `relay-server` explicite : il serait
propagé au navigateur et provoquerait le même échec.

## Architecture

```
navigateur ──HTTPS 443──► Caddy ──► nginx ─┬── /            page + assets
                          (TLS)             ├── /ws/id    ──► hbbs 21118
                                            └── /ws/relay ──► hbbr 21119
```

Deux conteneurs. Configuration et assets sont cuits dans les images ; seul le
volume `caddy-data` persiste hors image, pour conserver les certificats entre
redémarrages.

| Service | Base | Rôle |
|---|---|---|
| `web` | `nginx:alpine` | assets, authentification, proxy WebSocket |
| `tls` | `caddy:2-alpine` | terminaison TLS 443, ACME automatique |

## Les six correctifs du bundle

`scripts/patch-assets.sh` les réapplique de façon idempotente à partir de
`html/js/dist/index.js.orig`. Sans eux, rien ne fonctionne :

1. **Routage WebSocket** — le client vise `wss://<hôte>:21118` et `:21119`, des
   ports qu'aucun proxy HTTP standard ne relaie. Routé par chemin sur la même origine.
2. **`get_conn_status`** — cas absent du pont ; il renvoyait `""`, et
   `JSON.decode("")` levait une exception à chaque sondage, noyant la boucle
   asynchrone et empêchant toute connexion d'aboutir.
3. **`getByName`** — ne lève plus, conserve la sémantique `null → ""`.
4. **Garde-fou de version** — hbbs OSS ne renseigne pas `RelayResponse.version` ;
   le client refusait alors la session. Le champ n'est utilisé nulle part ailleurs.
5. **Décodeur zstd exposé** — les blocs de fichiers descendants arrivent
   compressés. Le bundle embarque déjà un décodeur wasm, mais au périmètre du
   module ; on l'expose plutôt que d'en embarquer un second, de deux façons :
   `window.__rdUnzstd` (la fonction du bundle, dimensionnée pour un bloc de fichier
   de 128 Kio) et `window.__rdZstdDecoder` (le décodeur lui-même, pour que la page
   choisisse la taille de destination — voir
   [Presse-papier riche](#presse-papier-riche--ce-qui-marche-et-où)).
6. **Texte du pair injecté comme du HTML** — l'écran d'attente écrivait le message
   d'erreur par `innerHTML`, et ce message vient du pair (`LoginResponse.error`).
   Un pair hostile pouvait exécuter du script dans la page, qui détient les mots
   de passe mémorisés. Le texte est maintenant échappé.

## Transfert de fichiers

Le client d'origine n'en a **rien** : les codecs protobuf `FileAction`,
`FileResponse` et `Cliprdr` sont présents dans le bundle, mais sans un seul
appelant — 13 occurrences chacun, soit exactement le passe-partout généré par
`ts-proto`. Le répartiteur de messages ne connaît que dix branches, aucune liée
aux fichiers.

Ce dépôt ajoute un panneau **Fichiers** dans la barre : navigation, téléversement
(bouton, glisser-déposer d'un fichier ou d'un dossier, `Ctrl+V`), téléchargement,
création de dossier, renommage, suppression.

### Comment, et pourquoi ainsi

Le transfert passe par une **seconde connexion**, ouverte à la demande. Ce n'est
pas un choix esthétique : sur le pair, `file_action` n'est traité que si
`self.file_transfer.is_some()`, champ posé uniquement par
`LoginRequest.file_transfer`. En session distante ordinaire, toute `FileAction`
est ignorée **en silence** — ni erreur, ni accusé. Cette connexion n'ouvre aucun
flux vidéo et disparaît avec la session.

Deux détails du protocole qu'il faut connaître avant de toucher à ce code :

- **`all_files` avant `send`.** Les blocs ne portent qu'un `file_num`, jamais un
  nom. Seul un `FileAction.all_files` préalable donne la liste — dans l'ordre
  exact où les blocs arriveront, les deux passant par `get_recursive_files`.
  Un chemin de *fichier* y produit une entrée unique au **nom vide** : le nom se
  dérive du chemin.
- **`remove_dir{recursive:true}` n'efface pas les fichiers.** Côté pair il
  appelle `remove_all_empty_dir`, qui ne retire que les répertoires vides. Il
  faut donc énumérer, effacer chaque fichier, puis retirer l'arborescence vidée.

### Presse-papier riche : ce qui marche, et où

Le texte brut circule dans les deux sens sur tous les navigateurs. Les **images**
et le **texte enrichi** (HTML de Word ou d'Excel) demandent davantage, et la
portée n'est pas la même selon le sens.

**Navigateur → poste distant.** Colle une image dans la session : elle part dans
le presse-papier distant, plus au téléversement. Ce sens ne demande aucune
permission — l'événement `paste` porte déjà les octets — et fonctionne donc
partout. Conditions :

- Le pair doit être en **RustDesk 1.3.0 ou plus**, seule version à comprendre
  `multi_clipboards`. Un pair connu comme plus ancien en est averti et rien n'est
  envoyé : le collage rejoué collerait sinon son *ancien* presse-papier. Une version
  inconnue part quand même, et est journalisée.
- L'image doit tenir dans **8 Mio en PNG**. La limite porte sur ce qui *part*, pas
  sur la source : un JPEG de quelques Mio peut être plusieurs fois plus lourd une
  fois reconverti (un navigateur ne fournit pas toujours du PNG, et annoncer un
  format faux livrerait au pair des octets illisibles). Trop lourde, l'image est
  réduite — trois fois au plus, jamais sous 64 px — au lieu d'être refusée, et un
  retour le dit. Au-delà de 64 Mio, la source n'est même pas décodée.
- Le collage distant (`Cmd+V`) est rejoué après 150 ms plus 250 ms par Mio entier,
  plafonné à 2,5 s. C'est une **heuristique** : le poste distant doit avoir reçu et
  écrit l'image avant qu'on lui dise de coller, et rien ne confirme qu'il l'a fait.

La touche de collage se reconnaît à sa lettre, ou — sous une disposition non
latine comme le cyrillique — à la touche physique.

**Poste distant → navigateur.** Copier sur le poste distant suffit : ce qui en
arrive est écrit dans le presse-papier local **tout de suite, sans bouton ni
message**. C'est possible parce qu'une copie distante est presque toujours
déclenchée par un geste *dans cette page* — `Ctrl+C`, un clic sur un menu — qui
ouvre pour quelques secondes le droit d'écrire du navigateur, et le contenu
revient en bien moins d'une.

Quand le navigateur refuse — la page n'a pas le focus, ou il est plus strict — le
bouton vert d'avant (« Image reçue ⇩ », « Texte reçu ⇩ ») apparaît près de la
poignée des réglages, et le dépôt est repris de lui-même à ton prochain clic ou
appui de touche dans la page. Il n'est **pas** repris si la page a perdu le focus
entre-temps : tu as pu copier autre chose ailleurs, et l'écraser avec un contenu
plus ancien serait une faute. Le texte simple des anciens pairs prend le même
chemin ; le bundle le posait par `execCommand("copy")` hors de tout geste, ce que
les navigateurs refusent sans rien dire.

Le décodage et la conversion en PNG se font dans une tâche à part, jamais sur la
boucle de messages (qui acquitte aussi chaque trame vidéo). Un emplacement par
type : un texte arrivé après une image ne l'efface pas. Le dépôt automatique est
**testé sur Chromium** ; Firefox devrait l'accepter dans sa propre fenêtre
d'activation, Safari est plus strict et montrera le plus souvent le bouton.

**Presse-papier automatique (navigateur → poste distant, sur accord).** `Ctrl+V`
a toujours marché : l'événement `paste` porte le contenu. Mais « Coller » dans un
menu du poste distant, ou un clic du milieu, n'en produisent aucun : le
presse-papier distant n'avait pas ce que tu venais de copier ici. **Actions →
Presse-papier automatique** règle cela : une fois la permission du navigateur
accordée, le presse-papier local est lu à chaque retour sur la page et envoyé
s'il a changé — ce que fait le client natif. `Ctrl+V` colle alors immédiatement,
le contenu étant déjà là-bas. C'est désactivé par défaut, parce que cela envoie
ce que tu as copié, mots de passe compris, au poste distant dès que la page
reprend le focus. Chromium seulement : Firefox et Safari redemandent à chaque
lecture.

Une image venue du poste distant par l'ancien message `clipboard` est
interceptée avant le bundle, dont la branche décode le contenu en texte sans
condition — sans cela, elle collerait du charabia.

**Images très compressibles.** Le décodeur du bundle dimensionne sa sortie à 30 fois
la taille compressée. Au-delà de ce taux — une capture d'un bureau presque uni — il
rend un résultat *vide*, sans lever d'erreur ni rien journaliser, ce qui devenait
une image blanche collée en silence. La page lit désormais la taille dans l'en-tête
de la trame zstd (ou largeur × hauteur × 4) et traite un résultat vide comme une
erreur.

**Quand une image ne passe pas.** Chaque échec affiche maintenant un message en bas
de page, et la console (lignes `[presse-papier]`) en donne la cause. Une entrée reçue
est journalisée ainsi : `format 21 (rgba), compress=oui, N o recus -> M o bruts,
WxH` — cette ligne dit sous quelle forme le pair envoie réellement. Ce que le
navigateur ne peut pas trancher : si le pair écrit son presse-papier de façon
synchrone (le délai de rejeu ci-dessus est une supposition), et ce qu'il fait de
`custom_image_quality` combiné à un préréglage de qualité.

### Copier-coller de fichiers

C'est le presse-papier de fichiers de RustDesk lui-même (messages `Cliprdr`), pas un
transfert déguisé : rien n'est lu ni envoyé tant que l'application d'en face ne colle pas.

- **De ta machine vers le poste distant.** Copie un ou plusieurs fichiers ou dossiers
  dans le Finder ou l'Explorateur, puis `Ctrl+V` / `Cmd+V` dans la session : ils arrivent
  là où se trouve le curseur du poste (dossier du Finder, bureau…). La page les annonce,
  rejoue la frappe de collage, puis sert la liste et le contenu à la demande du poste.
  Un dossier part avec toute son arborescence, sous-dossiers vides compris.
- **Du poste distant vers ta machine.** Copie des fichiers ou des dossiers sur le poste :
  un bouton vert « Fichier copié ⇩ » (ou « Dossier copié ⇩ ») apparaît, même barre repliée.
  Un clic les télécharge : chaque fichier tel quel, chaque dossier en une archive `.zip`
  qui le reconstitue à l'ouverture — un téléchargement est un fichier, un navigateur ne
  sait pas déposer une arborescence. Rien n'est téléchargé sans ce clic — copier sur le
  poste ne remplit pas ton disque.
- **Conditions.** Le poste doit connaître ce presse-papier (`has_file_clipboard` dans ce
  qu'il annonce, RustDesk 1.3.8 ou plus récent sous macOS et Linux, transfert de fichiers
  autorisé chez lui). La page annonce pour cela la version 1.3.9 à la connexion ; avant,
  elle n'en annonçait aucune, et le poste la traitait en très vieux client (pas de
  fichiers, et un presse-papier distant → local réduit au texte).
- **Poste Windows.** Un PC répond `has_file_clipboard: false` à tout client qui n'est pas
  lui-même sous Windows — donc à un navigateur sur Mac ou Linux — tout en acceptant ses
  fichiers : la page s'en sert quand même, comme le client natif, qui ne regarde que la
  présence de l'annonce.
- **Un collage n'ouvre jamais le panneau Fichiers.** Si le poste ne connaît pas ce
  presse-papier, la page le dit à l'écran avec ce qu'il est (système, version) et rien
  d'autre ne se passe. La console du navigateur garde la ligne `[fichiers] presse-papier
  de fichiers …` écrite au début de chaque session : système, version et annonce du poste.
- **Limites.** Un collage porte 10 000 éléments au plus (au-delà il est refusé en entier,
  jamais tronqué) et des chemins de 259 caractères au plus (un élément plus long est
  laissé de côté, et la page le dit). Coller un dossier demande un navigateur qui en donne
  le contenu à la page : Chrome et Edge le font ; ailleurs la page dit qu'elle ne peut pas
  le lire. Un fichier reçu du poste fait 2 Gio au plus ; l'archive d'un dossier, 4 Gio et
  65 535 éléments au plus (au-delà : panneau Fichiers).

### Ce qui ne sera jamais possible

**Coller dans le Finder local un fichier copié sur le poste distant.** Un navigateur
ne peut écrire dans le presse-papier du système que `text/plain`, `text/html` et
`image/png` ; il n'existe aucun chemin vers `CF_HDROP` (Windows) ni
`NSFilenamesPboardType` (macOS). Les *web custom formats* de Chrome restent
d'onglet à onglet. D'où le téléchargement d'un clic dans ce sens-là : c'est le plus
court chemin qu'un navigateur autorise.

Diagnostic dans la console : `rdFiles()`.

## Ce qui a été réimplémenté

Le client V1 ne câble **que l'affichage**. Tout le reste vit dans `web/src/`,
assemblé en une page par `scripts/build-page.py` (voir
[Organisation des sources](#organisation-des-sources)), via `window.curConn` et `setByName`, **sans jamais
patcher le bundle** : les deux fonctions que le pont attend de l'hôte
(`onGlobalEvent`, `onRgba`), la couche souris et clavier, le presse-papier
sortant, la résolution, le curseur, et le décodeur WebCodecs.

### Trois pièges, si tu modifies ce code

- **`jsonfyForDart` sérialise chaque valeur séparément.** Tout champ composite reçu
  dans `onGlobalEvent` est une chaîne JSON à reparser, pas un objet.
- **Le login envoie `video_ack_required: true`.** Toute substitution de
  `handleVideoFrame` doit appeler `sendVideoReceived()`, sinon le flux se fige
  après quelques trames.
- **`curConn` est remplacé à chaque connexion**, et `reconnect()` réutilise
  l'instance avec un `_ws` neuf. Les substitutions doivent être réappliquées.

## Réglages, barre et écran de connexion

**Réglages mémorisés.** La qualité, le plafond de cadence et le codec sont gardés
dans le navigateur (`rd-prefs`, dans `localStorage`) et réappliqués à chaque début
de session, reprise automatique comprise — le ratio de qualité n'était envoyé
qu'une fois par chargement de page. Si tu n'as jamais choisi de qualité, rien n'est
poussé : le sélecteur affiche celle que le bundle utilise réellement. Un codec
forcé qui cesse de marcher (H265 sur une machine qui l'a perdu) redevient
automatique, avec un message.

**Barre repliable.** La barre de réglages est **repliée par défaut** en une petite
poignée ⚙ en haut à droite : la barre de menus et les boutons de fenêtre du poste
distant restent cliquables. Un clic sur la poignée la déplie ; le choix est
mémorisé. Un presse-papier reçu montre son bouton sans déplier la barre. Limites :
le canvas distant avale `Tab`, la barre ne se manie donc qu'à la souris ; et la
poignée recouvre encore quelques pixels de ce coin. Pour retrouver l'ancienne barre
toujours ouverte, déplie-la une fois.

**Connexions récentes.** Les dix derniers ID apparaissent sous le champ ID, le plus
récent d'abord. Une entrée est enregistrée quand une session **aboutit**, pas au
clic sur Connect : les fautes de frappe ne s'accumulent pas. Un clic remplit le
champ (chiffres seuls — le bundle n'enlève pas les espaces) et donne le focus à
Connect ; `Suppr` sur une entrée focalisée la retire, la croix aussi à la souris,
« Effacer » vide la liste. Ce qui est stocké (`rd-recent`) : l'ID, un horodatage,
et le nom de poste annoncé par le pair — jamais un hôte de serveur, jamais un mot
de passe (l'entrée `peers` du bundle porte les mots de passe mémorisés).

**Mots de passe mémorisés.** Le bundle garde le mot de passe d'un poste **en
clair** dans le stockage du navigateur. La page l'imposait ; c'est maintenant la
case « Mémoriser les mots de passe sur cet appareil » de l'écran de connexion,
cochée par défaut. La décocher efface aussitôt les mots de passe stockés et
empêche le bundle d'en garder de nouveaux. À décocher sur toute machine qui n'est
pas la tienne. La liste est amorcée une
seule fois à partir des ID que le bundle connaissait déjà.

**Console de session et liste des postes.** Voir les deux sections ci-dessous.

## La console de session

Une barre haute, un tiroir **Réglages de session** à gauche, des fenêtres flottantes pour les outils et une barre de statut en
bas — la disposition de la console GL.iNet GLKVM, reprise pour RustDesk. Chaque contrôle que le client avait déjà y est
toujours, déplacé (pas réécrit) dans cette disposition, avec son réglage mémorisé et son comportement inchangés. GLKVM est une
*référence* de disposition et de réglages, pas une dépendance : rien de GL.iNet ne tourne ici, et il n'y a pas de WebRTC — ce
client parle le protocole propre de RustDesk à votre hbbs/hbbr.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ⚙ Session  ▭ 123 456 789  ▭ Postes  🔧 Toolbox  ⏻ Poste  ? Aide  ⌨ Clavier │ 📁 Fichiers  ▮ Stats  ⛶ Plein écran  ⏏ Quitter │
├───────────────┬──────────────────────────────────────────────────────────────────────────────┤
│ Réglages de   │                                                                              │
│ session       │                         l'écran distant                                      │
│ ▾ Vidéo       │                                                                              │
│ ▾ Audio       │              (HUD p50/p95/p99 conservé, clics traversants)                   │
│ ▾ Clavier     │                                                                              │
│ ▾ Souris      ├──────────────────────────────────────────────────────────────────────────────┤
│ ▾ Affichage   │  clavier virtuel (facultatif)                                                │
├───────────────┴──────────────────────────────────────────────────────────────────────────────┤
│ ● 28 ms  H.265 1920×1080 │ 4664 kbit/s │ 60 i/s   [Relais] [Chiffré]                         │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

La barre est repliée par défaut en une petite poignée (comme avant) ; dépliez-la pour atteindre les boutons. L'image distante
est calée *entre* les barres au lieu de passer dessous. Sur un écran étroit, le tiroir devient une feuille basse et la barre
ne garde que ses icônes.

| GLKVM | Ici | Remarques |
|---|---|---|
| Video › Quality, Latency, View | **Qualité**, plafond d'images/s, **codec**, **Vue** (ajustée / 1:1 avec défilement), résolution distante, ajuster à la fenêtre | Transfer (WebRTC/FEC/Native/Direct), mode Smart, EDID, Orientation : sans objet — voir plus bas |
| Audio › Speaker | **Son du poste** (`disable-audio` : le poste n'envoie plus d'audio) | Micro et caméra : non repris |
| Keyboard | **Raccourcis traduits PC ↔ Mac** (désactivable ; grisé entre deux postes de même famille), **clavier virtuel** (AZERTY/QWERTY selon la langue, Ctrl/Alt/Maj/Cmd collants), touches Impr. écran / Menu / Pause | Le *Bad link mode* n'a pas lieu d'être : ce client envoie des événements de touche discrets |
| Mouse | Mode **absolu / relatif** avec sensibilité, **bouton principal**, **vitesse** et **sens** de défilement (4 modes), **anti-veille**, boutons Retour/Avance | Le mode relatif exige un pair ≥ 1.4.5 (grisé avec la raison sinon) |
| Toolbox › Clipboard, Shortcut | Envoyer du texte (copier vers le poste, ou **le taper** — utile à un écran de connexion), raccourcis selon l'OS du poste et les vôtres (validés, mémorisés), **capture d'écran et enregistrement vidéo** | OCR, Wake-on-LAN, terminal : non repris |
| Accessories (alimentation) | Menu **Poste** : Ctrl+Alt+Suppr, verrouiller, **redémarrer (deux clics)**, choix de l'écran, confidentialité, blocage des entrées, verrouillage en fin de session, presse-papier partagé, curseur dans l'image | Grisé avec la raison quand l'OS du poste ne sait pas le faire |
| Toolbar › Switch Port, Fullscreen, Stats, Collapse | Sélecteur de **Postes**, **plein écran avec verrouillage du clavier**, **statistiques de connexion** (4 courbes en direct), replier | Pas de perte de paquets à tracer : la liaison est TCP, une perte se voit en latence |
| Help › export logs | **Aide** : test du relais, **export du journal sans aucun secret**, version et lien vers la source | |
| Settings › Preferences | **Thème** (auto / clair / sombre), barre de statut, plein écran épuré | La **langue** se choisit sur l'écran de connexion (un seul réglage pour la page et la console) |

**Ce qui n'est volontairement pas là**, parce que c'est du *matériel* GLKVM ou un autre transport : Virtual Media (ISO / disque
USB), Accessories (Fingerbot, carte ATX), EDID et identité USB, Apps Center (Tailscale / ZeroTier / NetBird), mise à jour du
firmware, caméra USB, transports WebRTC / FEC / Native / Direct. Et, hors périmètre d'une instance personnelle : comptes
multiples, SSO (LDAP/OIDC), 2FA, journal d'audit, alertes e-mail, invitations.

**Design et accessibilité.** Thèmes clair et sombre construits avec des jetons `oklch()` et `light-dark()` ; le texte atteint
4,5:1 et les bordures de composants 3:1 dans les deux thèmes (la suite de tests le mesure dans un vrai navigateur) ;
`prefers-reduced-motion`, `prefers-contrast`, couleurs forcées, cibles tactiles de 44 px et zones sûres sont respectés ; les
interrupteurs sont des cases natives (`role="switch"`), le thème est un groupe radio ARIA piloté aux flèches, chaque champ est
nommé et décrit ; polices du système et icônes SVG inline uniquement — aucune requête externe. Une console qui ne démarre pas
laisse la barre d'origine exactement comme elle était.

**Où est le code.** `web/js/*.js` et `web/css/console.css`, assemblés en `html/rd-console.js` / `rd-console.css` par
`scripts/build-web.sh` (chaque source est une IIFE, enveloppée dans un `try/catch`, et vérifiée comme script classique). Le
gabarit n'est touché qu'à trois endroits : sept repères `data-rd`, la mesure `zoneImage()` et la vue 1:1 dans `fitCanvas`.
Les choix de la console vivent dans `rd-console` (distinct de `rd-prefs`) ; vos raccourcis dans `rd-raccourcis`.

**Non vérifié sur un vrai pair** (les bancs simulent une session) : la souris relative et les boutons Retour/Avance reposent sur
le source du pair RustDesk (un clic agit là où est déjà le curseur ; le type 5 est le déplacement relatif, ±10000, pair ≥ 1.4.5),
les demandes de redémarrage et de verrouillage, et l'effet du mode confidentialité / blocage des entrées sur un pair macOS. Les
captures et enregistrements viennent du canvas de la page : sur le repli de décodage logiciel (WebGL), une capture peut être
vide et l'enregistrement aussi.

## Liste des postes (service facultatif)

Une page d'accueil, **Mes postes**, avant le formulaire de connexion : vos postes avec un nom, une note, des étiquettes, une
étoile d'épinglage, l'heure de la dernière connexion et — quand votre hbbs le permet — un point vert **en ligne** ; une
recherche (à partir de quatre postes) ; ajout, modification, retrait ; export et import JSON. En session, **Postes** passe à un
autre (il quitte la session, puis ouvre l'autre avec son mot de passe mémorisé). Un poste auquel vous vous connectez s'ajoute
tout seul, nommé d'après son hôte.

C'est un **petit service de ce dépôt** (`fleet/server.py`, bibliothèque standard de Python, SQLite), **facultatif** : sans lui, le
client est exactement ce qu'il était — le formulaire et les dix dernières connexions. Il ne voit jamais de mot de passe de poste
(le navigateur les garde), n'a pas d'authentification propre (il n'écoute qu'à l'intérieur de Docker, derrière l'authentification
Basic/cookie de nginx), et son conteneur est en lecture seule, sans privilège, sans port publié.

```bash
./setup.sh                                  # demande « Activer la liste des postes ? » — répondre 1
docker compose --profile fleet up -d        # ou à la main
python3 scripts/online-probe.py 172.17.0.1  # le service voit-il qui est en ligne ?
```

L'état **en ligne** vient du port TCP brut **21115** de hbbs (`OnlineRequest`, que hbbs OSS ne sert pas sur le WebSocket que le
navigateur sait parler). Si 21115 est filtré, la liste marche quand même et affiche *inconnu* — jamais « hors ligne » : le
service ne prétend pas savoir. Après un redémarrage de hbbs, tous les postes paraissent hors ligne le temps de se réenregistrer
(jusqu'à 30 s). Détails, API et dépannage : [docs/FLOTTE.md](docs/FLOTTE.md).

## Codec

Le client d'origine ne déclare **aucune** capacité de décodage : le serveur
retombe alors sur VP9 logiciel, y compris quand la machine contrôlée dispose d'un
encodeur matériel. Ce dépôt sonde ce que le navigateur sait décoder via WebCodecs
— H265, H264, AV1, VP9 —, déclare le tout dans `supported_decoding` après
`peer_info`, et préfère le meilleur, dans l'ordre du mode « auto » du pair : H265,
H264, AV1, VP9.

Le pair a le dernier mot. H265 et H264 n'existent chez lui qu'avec un encodeur
matériel, et les premières trames d'une session sont toujours du VP9, émises
avant qu'il ait lu la déclaration. Le décodeur **suit donc le flux réellement
reçu**, pas celui qui a été demandé. Un codec qui échoue trois fois est écarté
pour toute la vie de la page et le suivant est essayé ; le décodage logiciel est
le dernier barreau, plus le premier repli.

H264 et AV1 sont couverts par les bancs de test (négociation, bascule, repli)
mais n'ont **pas été mesurés face à un vrai pair**, contrairement à H265.

Vérification côté machine contrôlée, pendant une session web :

```
usable: h265=true → encoder: H265 → new encoder: HWRAM(hevc_videotoolbox, …)
```

> La négociation porte sur l'**intersection de toutes les connexions actives** :
> une session native ouverte en parallèle peut faire retomber les deux en VP9.
> Pour toute mesure, n'ouvrir qu'une session.

Un sélecteur dans la barre permet de forcer `h265`, `h264`, `av1`, `vp9` ou le
décodage logiciel. Un codec forcé est le seul déclaré ; si le pair ne sait pas
l'encoder, il répond en VP9 et la surimpression affiche le codec réellement utilisé.

## Actions distantes, écrans, 2FA

Le bundle sait déjà envoyer Ctrl+Alt+Suppr, verrouiller la session distante,
changer d'écran et basculer les options de session ; rien dans son interface ne
les appelait. Le menu **Actions** de la barre le fait.

- Le **mode confidentialité** et le **blocage de la saisie locale** dépendent du
  pair (plateforme, permissions, service installé). Le pair répond par un
  `BackNotification`, que le bundle décode sans rien en faire : la page le lit,
  dit si la demande a été acceptée, et ne coche l'option que dans ce cas. Un mode
  confidentialité refusé est aussi retiré des options du bundle pour ce pair, qui
  le redemanderait sinon à chaque connexion.
- **Redémarrer** demande confirmation. La session tombe ; la reprise automatique
  abandonne après une minute environ, il faut donc recharger la page une fois la
  machine revenue.
- **Écrans** : le sélecteur apparaît quand `peer_info` annonce plus d'un écran.
  La page ne change d'état qu'à la confirmation du pair.
- **2FA** : sur `2FA Required`, la page demande le code à six chiffres et
  l'envoie en `auth_2fa`. Non testé face à un vrai pair en 2FA ; « faire confiance
  à cet appareil » n'est pas implémenté, le code est donc demandé à chaque connexion.

## Organisation des sources

```
web/src/page.html          le squelette : en-tête, balises du bundle, lignes d'inclusion
web/src/style.css          tous les styles
web/src/00-stockage.js     garde-fous du stockage, hôte et clé cuits par le déploiement
web/src/10-diagnostic.js   diagnostic des liaisons, état partagé, curseur distant
web/src/20-rdlib.js        RDLib : logique pure, sans DOM — ce que le banc Node teste directement
web/src/30-session.js      entrées, vidéo, presse-papier, barre, écran de connexion
web/src/40-fichiers.js     le panneau de fichiers
```

`python3 scripts/build-page.py` les assemble en `web/index.html.template`, qui
n'est **pas versionné** : `setup.sh`, `verify.sh`, la CI et les deux bancs de test
le reconstruisent avant de s'en servir. La page servie reste un seul fichier de
blocs en ligne — seules les sources sont découpées.

## Clavier : un PC devant un Mac

RustDesk transmet les modificateurs un pour un : `Ctrl+C` arrive en `Control+C`
sur le Mac, où copier est `Cmd+C`. Permuter Ctrl et Cmd règle les lettres et casse
le reste : `Ctrl+←` (mot précédent sur PC) devenait `Cmd+←` (début de ligne),
`Ctrl+Tab` ouvrait le sélecteur d'applications, Début et Fin ne bougeaient pas le
curseur. Les raccourcis sont maintenant **traduits** vers la combinaison qui a le
même effet de l'autre côté :

| Sur le clavier PC | Envoyé au Mac | Effet |
|---|---|---|
| `Ctrl` + lettre | `Cmd` + lettre | copier, coller, enregistrer, chercher, tout sélectionner… |
| `Ctrl+←/→/↑/↓`, `Ctrl+Retour arrière`, `Ctrl+Suppr` | `Option` + la même | se déplacer ou effacer mot par mot |
| `Début` / `Fin` | `Cmd+←` / `Cmd+→` | début / fin de ligne |
| `Ctrl+Début` / `Ctrl+Fin` | `Cmd+↑` / `Cmd+↓` | début / fin du document |
| `Ctrl+Y` | `Cmd+Maj+Z` | rétablir |
| `Ctrl+Tab`, `Ctrl+Espace` | inchangés | onglet suivant, complétion |
| `Alt+F4` / `Ctrl+F4` | `Cmd+Q` / `Cmd+W` | quitter / fermer l'onglet |
| `Alt+Tab` | `Cmd+Tab` | changer d'application |
| `Alt+←` / `Alt+→` | `Cmd+[` / `Cmd+]` | page précédente / suivante |
| `Ctrl+Inser`, `Maj+Suppr`, `Maj+Inser` | copier, couper, coller | les autres touches de presse-papier du PC |
| `Ctrl+Maj+Échap` | `Cmd+Option+Échap` | forcer à quitter |
| Touche Windows | `Control` | |
| `Ctrl` + clic | `Cmd` + clic | sélection multiple (un `Ctrl` + clic est un clic droit sur Mac) |

`Maj` est toujours conservé : toutes les variantes de sélection suivent. Le sens
est choisi d'après les deux plateformes : un clavier Mac devant un poste Windows
ou Linux reçoit la table inverse, et rien n'est traduit entre deux postes de la
même famille — le bouton de la barre (**PC→Mac**, **Mac→PC**) n'apparaît que s'il
y a quelque chose à traduire. Un clic le passe en mode **brut**, où chaque touche
part telle quelle : c'est ce qu'il faut dans un terminal distant (`Ctrl+C` = SIGINT).

Trois autres corrections sur le même chemin :

- **AltGr.** Windows présente AltGr comme `Ctrl+Alt` : `@`, `#`, `€`, `{` d'un
  clavier français ou suisse partaient comme des raccourcis et n'étaient jamais
  tapés. Ce sont des caractères.
- **Relâchement.** Lâcher `Ctrl` avant la lettre est courant ; le relâchement de
  la lettre arrivait alors sans `Ctrl`, passait pour du texte, et rien ne partait
  — le Mac gardait `Cmd+C` enfoncé. Le relâchement rejoue exactement ce qui a été
  enfoncé.
- `Alt+Tab`, `Alt+F4`, `Ctrl+W` et `Ctrl+T` n'atteignent la page qu'en **plein
  écran** sur Chromium ; sinon le système local les garde.

Ce qui reste différent : le sélecteur d'applications ne peut pas être tenu ouvert
(chaque `Alt+Tab` est un `Cmd+Tab` complet), et `F2`, `Suppr` sur un fichier ou
`Impr écran` n'ont pas d'équivalent Mac unique et partent tels quels.

## Entrées : tactile, molette, plein écran

- **Tactile.** Un doigt est la souris : un toucher est un clic gauche à l'endroit
  touché, toucher puis glisser tient le bouton, un appui long immobile est un clic
  droit. Deux doigts qui glissent ensemble font défiler, dans le sens « naturel ».
  Le bouton **Clavier**, affiché sur les appareils tactiles, sort le clavier de
  l'appareil. Testé dans l'émulation tactile de Chromium, pas sur une tablette réelle.
- **Molette.** Le pair compte en crans. Un cran part tous les 100 px de défilement
  cumulé : une molette de souris ne change pas, un trackpad est assagi.
- **Plein écran.** Sur Chromium, l'API Keyboard Lock donne au poste distant les
  raccourcis que le navigateur ou le système gardent d'ordinaire ; maintenir Échap
  pour sortir. Firefox et Safari passent en plein écran sans cette capture.

## Durcissement du déploiement

- nginx n'**hérite pas** des `add_header` du niveau `server` dans un bloc
  `location` qui en déclare un. Les trois blocs qui posent le cookie de session
  partaient donc sans `X-Frame-Options` ni `nosniff`. Les en-têtes y sont
  maintenant répétés, et un test échoue si l'un d'eux disparaît.
- Une politique de contenu interdit tout script, image ou connexion vers un autre
  hôte. Elle garde `'unsafe-inline'` : la page est faite de blocs en ligne et le
  formulaire du bundle utilise des attributs `onclick`. Le banc navigateur tourne
  sous cette politique exacte, lue dans `nginx.conf.template`.
- HSTS est envoyé par Caddy, là où TLS se termine.

## Vérifier une modification

```bash
./scripts/verify.sh                 # toute la chaîne ; exige Docker
./scripts/verify.sh --sans-docker   # tout sauf les images
```

`verify.sh` rejoue toute la chaîne — syntaxe shell, JavaScript en ligne, extraction
et correctifs des assets, banc du gabarit, banc navigateur quand Chromium est
disponible, format de fil d'authentification **dans l'image construite**, et un
conteneur qui doit réellement répondre 204 / 401 / 404. Tout se fait sur une copie
temporaire : ton `.env`, ton `.htpasswd` et un éventuel déploiement en place ne sont
pas touchés. `--sans-docker` s'arrête avant les images et contrôle le format de fil
sur le bundle corrigé lui-même (la CI le refait dans l'image, et c'est ce contrôle
qui fait foi).

Les deux bancs se lancent aussi seuls, après `extract-assets.sh` et
`patch-assets.sh` :

```bash
node scripts/test-template.mjs --require-vendor          # Node seul, sans dépendance
NODE_PATH=$(npm root -g) node scripts/test-browser.mjs   # vrai Chromium, via Playwright
python3 -I -m unittest discover -s fleet -v              # le service de la liste des postes, contre un faux hbbs
```

`verify.sh` refuse aussi un banc qui joue moins de tests que son plancher (149 / 86 / 19 aujourd'hui) : un test supprimé ou
ignoré en silence ne peut plus faire passer le contrôle. Lancez le banc navigateur avec et sans décodage matériel — il doit
passer sur les deux chemins. `RD_TEST_FILTRE=texte` ne joue que les tests du navigateur dont le nom contient `texte`.

Le banc du gabarit charge ensemble les cinq scripts de la page dans un seul
contexte, garde les contrats que d'autres outils lisent dans la page, et exerce le
câblage du presse-papier, de la session et de la barre sur un DOM fictif, avec le
vrai décodeur zstd du bundle. Le banc navigateur mesure ce qu'un DOM fictif ne peut
pas : où le pointeur tombe réellement, ce que le vrai `ClipboardItem` accepte, le
focus, et le vrai formulaire de connexion du bundle. Sans Playwright ni navigateur,
il s'ignore avec un message ; `--require-browser` le fait échouer à la place (la CI
le passe).

Les mêmes étapes tournent en intégration continue, mais ce script n'en dépend
pas : un dépôt cloné doit être vérifiable hors ligne, et la boucle est plus
courte que de pousser pour savoir.

## Onglet caché : pourquoi la session tombait en timeout, et ce qui a changé

**La cause.** Le bundle lit chaque message en *interrogeant* son tampon par
`setTimeout(…, 1)`. Dans un onglet caché, le navigateur ralentit les minuteurs :
une fois par seconde d'abord, puis **une fois par minute** au bout de cinq
minutes. Pendant ce temps la page ne lit rien : elle ne répond plus aux sondes du
poste distant et n'acquitte plus les trames vidéo — et le pair ferme toute
liaison restée muette 30 secondes (`connection.rs` :
`last_recv_time.elapsed() >= SEC30` → `"Timeout"`). Les messages, eux, arrivent
toujours : l'événement `message` d'un WebSocket n'est pas ralenti. Un second
défaut s'y ajoutait : le « Timeout » de 12 secondes du bundle était mesuré quand
le minuteur en retard se réveillait enfin, si bien qu'une page qui avait
seulement dormi déclarait morte une liaison vivante.

**La correction.**

- La lecture est pilotée par l'**arrivée** d'un message, plus par un minuteur. Le
  remplacement se fait sur la classe de liaison du bundle : la connexion de
  transfert de fichiers en profite aussi. Un minuteur ne reste qu'en filet, et un
  minuteur en retard est reconnu comme « la page dormait », pas comme un silence.
- Tant que l'onglet est caché, les trames sont **acquittées sans être décodées**
  et la page demande 5 images par seconde au pair. Le retour rétablit ton plafond
  de cadence et redemande une image-clé : l'image revient, à jour, en une
  fraction de seconde. Personne ne regardait : cela ne fait qu'enlever de la charge.
- La session tient un **verrou Web Locks**, qui empêche Chrome et Edge de *geler*
  l'onglet (économie d'énergie, onglets en veille).

**Ce qui peut encore couper une session.** Un onglet que le navigateur
**décharge** pour récupérer de la mémoire (économiseur de mémoire de Chrome,
onglets en veille d'Edge réglés pour décharger) est entièrement retiré ; au
retour la page se recharge, et il ne reste que la reprise automatique. Exclure le
site dans les réglages de performances du navigateur si cela arrive. Un
ordinateur mis en veille coupe toutes les liaisons, quoi que fasse la page.

Vérifié dans les bancs, y compris sur la vraie classe de liaison du bundle,
minuteurs neutralisés. **Pas** vérifié sur une vraie session cachée dix minutes.

## Qualité d'image sans coût supplémentaire

- **Couleurs.** RustDesk convertit l'écran en YUV avec libyuv, donc en BT.601, et
  n'en écrit rien dans le flux. Sans indication, le navigateur suppose BT.709 : le
  vert pur revenait en (0, 216, 2), le rouge pur en (255, 26, 1). Le décodeur
  reçoit maintenant la matrice. Mesuré dans Chromium sur VP9, H264 et AV1 — le
  vert revient en (0, 255, 2). Le coût est nul : c'est le même calcul avec
  d'autres coefficients, et un flux qui porte une étiquette de couleur garde la
  priorité.
- **Netteté.** Quand l'image est à quelques pour cent d'un nombre entier de
  pixels physiques par pixel distant, elle y est calée et dessinée sans
  interpolation. Une image de 1920 pixels affichée sur 1905 était rééchantillonnée
  en entier pour un gain de place invisible ; sur un écran à 125 % ou 150 %, elle
  tombe maintenant exactement sur les pixels physiques.
- **« Ajuster »** choisit la résolution distante en pixels *physiques*. Sur un
  écran à 150 %, il prenait une image un tiers trop petite, puis l'agrandissait.

La meilleure qualité pour la moindre charge est donc : cliquer sur **Ajuster**,
pour que la résolution distante corresponde à ta fenêtre. Moins de pixels à
encoder, aucun à interpoler.

Ce qui a été regardé et **pas** fait, parce que cela coûte : la chrominance 4:4:4
(texte coloré plus net, moitié plus de données environ), et un ratio de qualité
plus élevé — la page demande déjà 1,5, le « meilleur » de RustDesk.

## Dépannage : `invalid key` sur le relais

hbbr journalise `Relay authentication failed from … - invalid key` et le
navigateur n'obtient jamais de session. hbbr ne dit **rien** au client, il se
contente de fermer : côté navigateur on ne voit qu'un `1006`.

**Commence par ceci, sur la machine du serveur — c'est fait pour trancher :**

```bash
./scripts/relay-doctor.sh            # tableau lisible
./scripts/relay-doctor.sh --json     # à coller dans un rapport
```

Marche à suivre complète, pas à pas, avec le remède de chaque verdict :
**[docs/DEPANNAGE-RELAIS.md](docs/DEPANNAGE-RELAIS.md)**.

Il relève la clé effective de hbbs et celle de hbbr, la dérive du fichier de
clé, compare avec ce que la page enverra, teste la joignabilité de 21118 **et**
21119, lit la configuration du poste contrôlé s'il est sur cette machine, puis
envoie une vraie trame `RequestRelay` sur `/ws/relay`. Le verdict est binaire.

### « Mais le client natif marche »

Ce n'est pas un contrôle valide, et c'est le faux témoin qui coûte le plus de
temps. Le client natif perce le NAT et établit une liaison **directe** : il ne
touche hbbr quasiment jamais. Le client web n'a pas d'UDP, **il passe par le
relais à 100 %**. « Natif OK, web KO » est exactement la signature attendue d'un
désaccord de clé entre hbbs et hbbr.

### Ce que hbbr fait, et comment le lire

Le contrôle tient en une ligne de `relay_server.rs` :
`if !key.is_empty() && rf.licence_key != key { … return; }` — égalité stricte.
Ensuite il n'y a que deux chemins, et leur durée les distingue :

| Durée de vie de la liaison | Signification |
|---|---|
| **moins d'une seconde** | clé refusée : `return` immédiat, sans un mot au client |
| **une trentaine de secondes** | clé acceptée, mais le pair n'est jamais arrivé (`sleep(30)`) |

Un relais a **deux jambes**, authentifiées séparément : le navigateur d'un
côté, le poste contrôlé de l'autre. Une clé fausse **sur le poste** ne produit
donc pas l'échec immédiat mais l'attente de 30 s. Les deux se ressemblent à
l'écran et n'ont pas la même cause.

### Les quatre causes, par fréquence

1. **hbbs et hbbr ne partagent pas leur répertoire de clés.** Avec `-k _`,
   chacun exécute `gen_sk(300)` : après une attente, si le fichier manque
   toujours, il **génère sa propre paire**, sans un mot dans les journaux. Sous
   Docker c'est un volume non partagé ; en natif, deux processus lancés depuis
   deux répertoires différents — le fichier de clé est cherché dans le
   **répertoire de travail**, pas à un chemin fixe.
   Vérification en une ligne : les deux `Key:` ci-dessous doivent coïncider.
2. **La valeur donnée à `setup.sh` n'est pas celle du serveur.** Depuis cette
   version, `setup.sh` la relève tout seul ; ne la retape jamais.
3. **La clé privée collée à la place de la publique.** `id_ed25519` est du
   base64 nu, sans `BEGIN` ni `PRIVATE` : rien ne la distingue à l'œil.
   `setup.sh` la reconnaît désormais à sa taille (64 octets) et propose la
   publique correspondante — qui en est littéralement la moitié haute.
4. **`localStorage` périmé ou vide.** Le bundle envoie
   `localStorage.getItem("key") || void 0` : un stockage vide n'envoie pas une
   clé vide, il **omet le champ**, et hbbr rejette pareil. Dans la console de la
   page : `rdRelayTest()` pour le verdict, `rdRelayReset()` pour réécrire la clé
   depuis la page et recharger.

### Relever la clé effective — la bonne commande

```bash
docker logs hbbs 2>&1 | grep 'Key:'      # Docker
docker logs hbbr 2>&1 | grep 'Key:'      # les deux doivent coïncider
journalctl -u hbbs | grep 'Key:'         # systemd
```

> **N'utilise pas `docker exec hbbs cat /root/id_ed25519.pub`.** Cette commande,
> qu'on trouve partout et que ce dépôt a lui-même recommandée, **ne peut pas
> fonctionner** — pour deux raisons indépendantes. L'image
> `rustdesk/rustdesk-server` n'a **ni shell, ni `cat`, ni `ls`** : `docker exec`
> y répond `executable file not found in $PATH`. Et le fichier `.pub` **n'existe
> souvent pas** : hbbs relit `id_ed25519` et dérive la clé publique de ses 32
> derniers octets (`common.rs`), il n'a jamais besoin de relire le `.pub`.
> La clé annoncée au démarrage, elle, est toujours la bonne : c'est celle que le
> processus applique vraiment.

Si tu n'as accès qu'au fichier, dérive-la sans conteneur :

```bash
python3 -c "import base64,sys;k=base64.b64decode(open(sys.argv[1],'rb').read().strip());print(base64.b64encode(k[32:]).decode())" data/id_ed25519
```

> **Ne pas « corriger » les tags protobuf de `RequestRelay`.** Cela a maintenant
> été tenté et annulé deux fois. Le `rendezvous.proto` officiel dit `uuid = 2`,
> `licence_key = 6` — exactement ce que le bundle envoie déjà. Les réassigner
> casse aussi le client natif, puisque hbbr lit alors l'uuid là où il attend la
> clé. Et hbbr n'authentifie pas les clients WebSocket autrement que les clients
> TCP bruts : `make_pair_` est générique sur le flux, et le contrôle de la clé a
> lieu **avant** toute distinction `is_ws()`.

## Où tourne ton serveur

`setup.sh` ne devine plus : il essaie les candidats et retient celui qui ouvre
**21118 et 21119**. Ce tableau sert à comprendre son choix, ou à s'en passer.

| Condition | Relever la clé | `RD_BACKEND_HOST` |
|---|---|---|
| Linux + Docker, `network_mode: host` | `docker logs hbbs \| grep 'Key:'` | `172.17.0.1` |
| Docker Desktop / OrbStack / Colima | idem | `host.docker.internal`, `host.lima.internal` |
| Binaires natifs | `journalctl -u hbbs \| grep 'Key:'`, ou dérivation depuis le `id_ed25519` du répertoire de travail | `172.17.0.1` ou `127.0.0.1` |
| Serveur sur une autre machine | à relever là-bas | son nom ou son IP |

Deux avertissements qui coûtent des heures :

- **`network_mode: host` sous Docker Desktop ne désigne pas macOS**, mais la VM
  Linux interne. `host.docker.internal` ne joindra pas des conteneurs lancés
  ainsi ; publie les ports, ou fais tourner le client web sur la même machine.
- **Le port 21118 n'identifie pas hbbs.** Le *client* RustDesk écoute lui aussi
  dessus pour ses liaisons directes en réseau local. Sur une machine qui héberge
  le serveur et fait tourner le client, 21118 est ambigu ; **21119 ne l'est pas**.

Exemple minimal pour hbbs/hbbr, avec le point qui compte — **un seul `data/`,
monté dans les deux** :

```yaml
services:
  hbbs:
    image: rustdesk/rustdesk-server
    command: hbbs -k _
    volumes: [./data:/root]          # le MÊME que hbbr
    network_mode: host
    restart: unless-stopped
  hbbr:
    image: rustdesk/rustdesk-server
    command: hbbr -k _
    volumes: [./data:/root]          # le MÊME que hbbs
    network_mode: host
    restart: unless-stopped
```

## Sécurité

- Authentification Basic sur la page et les assets, avec limitation de débit.
- Cookie de session de 90 jours, `HttpOnly` + `Secure` + `SameSite=Lax`, posé
  uniquement en réponse à une requête déjà authentifiée. **Changer le mot de passe
  régénère le jeton**, ce qui déconnecte les navigateurs déjà autorisés.
- L'image source n'est jamais exécutée ; seuls ses fichiers statiques sont servis.
- Aucun secret dans le dépôt : `setup.sh` génère `.env` et `.htpasswd` localement,
  tous deux ignorés par Git.

> **Les routes `/ws/id` et `/ws/relay` ne sont pas derrière l'authentification.**
> C'est nécessaire : le navigateur ne présente pas d'identifiants sur une poignée
> de main WebSocket de façon fiable. Conséquence à mesurer : **ce proxy rend
> hbbs et hbbr joignables publiquement même s'ils n'écoutent que sur une interface
> privée.** Ce qui protège ton serveur est `-k _`, pas le mot de passe de la page —
> et cela implique de traiter la **clé publique du serveur comme un secret**,
> puisque quiconque la détient peut utiliser ton relais sans jamais voir la page.

Durcissements raisonnables non inclus : fail2ban sur les 401 de nginx, restriction
du port 443 par IP si ton usage le permet.

## Assets et provenance

Les fichiers statiques du client — 59 fichiers, 2,5 Mo — sont versionnés dans
`assets/rustdesk-web-assets.tar.gz`, avec leur empreinte SHA-256 dans
`assets/SHA256SUMS`. L'installation est donc **hors ligne et ne dépend d'aucun
tiers** : rien n'est téléchargé au moment de l'installation.

Seul le sous-ensemble réellement servi est conservé. L'application Flutter livrée
dans la même image d'origine (`canvaskit`, `main.dart.js`, `assets/` — 26 Mo) ne
fonctionne pas et n'est jamais utilisée.

`setup.sh` les décompresse pour toi ; il n'y a rien de plus à lancer.

Si tu préfères auditer l'archive plutôt que la croire sur parole, cette commande
**facultative** re-dérive les mêmes fichiers depuis l'image communautaire
d'origine — épinglée par digest, jamais exécutée — et signale toute divergence :

```bash
./scripts/extract-assets.sh --verify-provenance   # necessite Docker et le reseau
```

## Licences

Le code de ce dépôt est sous **MIT**.

Il **redistribue** en revanche les fichiers compilés du client (voir ci-dessus).
Ils proviennent du client RustDesk, sous **AGPL-3.0** ; la source correspondante
est le dépôt RustDesk au commit depuis lequel l'image communautaire a été
construite, référencé dans `scripts/extract-assets.sh`. ogv.js et yuv-canvas
portent leurs propres licences, incluses dans l'archive.

Ce que ton navigateur exécute est en revanche un ouvrage dérivé du client RustDesk,
sous **AGPL-3.0**. Son article 13 impose à l'**opérateur** d'un service accessible
par le réseau d'en proposer les sources correspondantes : ce dépôt, avec le digest
épinglé dans `scripts/extract-assets.sh` et les correctifs de `patch-assets.sh`,
constitue cette source. Si tu exposes ce service publiquement, garde un lien vers
ce dépôt accessible depuis ton déploiement.

## Soutenir le projet

Ce dépôt est maintenu bénévolement. Si son contenu t'a fait gagner du temps :

```
ETH et chaînes compatibles EVM (Base, Arbitrum, Optimism, Polygon)
0x8eb20ec53380F3C6F8A12dfa9A8459298d2759c4
```

Vérifie la chaîne avant d'envoyer. Aucun don n'ouvre droit à un support ou à une
priorité de traitement.
