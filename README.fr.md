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
| Vidéo | H265 **matériel** des deux côtés via WebCodecs, repli VP9 puis logiciel |
| Souris | déplacement, clics gauche/droit, molette, coordonnées mises à l'échelle |
| Clavier | texte, accents, dispositions non-US, touches mortes, touches de contrôle |
| `Ctrl` → `Cmd` | commutable, pour macOS ou pour un terminal distant |
| Presse-papier | distant → navigateur, et navigateur → distant (texte) |
| Fichiers | panneau distant : naviguer, téléverser, télécharger, créer, renommer, supprimer |
| Résolution | menu des modes réellement supportés, « ajuster à la fenêtre » |
| Curseur | le vrai curseur distant, avec son point chaud |
| Audio | Opus, avec réveil du contexte au premier geste |
| Déploiements sans coupure | la couche TLS patiente pendant un redémarrage du conteneur au lieu d'échouer |
| Reprise automatique | une session coupée se relance seule, avec délai croissant — pas de retour au formulaire |
| Veille écran | l'écran ne se verrouille pas tant qu'une session est active, comme YouTube en lecture |
| Mesure | percentiles p50/p95/p99 de latence et de décodage, en surimpression |
| Accès | authentification Basic + cookie de session de 90 jours |

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
- Un nom de domaine pointant en **A direct** vers cette machine, sans proxy
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

## Les cinq correctifs du bundle

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
   module ; on l'expose (`window.__rdUnzstd`) plutôt que d'en embarquer un second.

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

### Ce qui ne sera jamais possible

**Copier un fichier sur le Mac et le coller dans le Finder local.** Un navigateur
ne peut écrire dans le presse-papier du système que `text/plain`, `text/html` et
`image/png` ; il n'existe aucun chemin vers `CF_HDROP` (Windows) ni
`NSFilenamesPboardType` (macOS). Les *web custom formats* de Chrome restent
d'onglet à onglet. Le sens inverse, lui, fonctionne : un fichier copié dans le
Finder arrive bien dans `clipboardData.files`, et `Ctrl+V` le téléverse.

C'est aussi la conclusion de Teleport, Guacamole et Kasm : aucun n'utilise le
presse-papier pour les fichiers, tous ouvrent un canal latéral.

Diagnostic dans la console : `rdFiles()`.

## Ce qui a été réimplémenté

Le client V1 ne câble **que l'affichage**. Tout le reste vit dans
`web/index.html.template`, via `window.curConn` et `setByName`, **sans jamais
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

## Codec

Le client d'origine ne déclare **aucune** capacité de décodage : le serveur
retombe alors sur VP9 logiciel, y compris quand la machine contrôlée dispose d'un
encodeur matériel. Ce dépôt déclare `supported_decoding{prefer:H265}` après
`peer_info` et bascule le décodeur du navigateur sur WebCodecs.

Vérification côté machine contrôlée, pendant une session web :

```
usable: h265=true → encoder: H265 → new encoder: HWRAM(hevc_videotoolbox, …)
```

> La négociation porte sur l'**intersection de toutes les connexions actives** :
> une session native ouverte en parallèle peut faire retomber les deux en VP9.
> Pour toute mesure, n'ouvrir qu'une session.

Un sélecteur dans la barre permet de forcer `h265`, `vp9` ou le décodage logiciel.

## Vérifier une modification

```bash
./scripts/verify.sh
```

Rejoue toute la chaîne — syntaxe shell, JavaScript en ligne, extraction et
correctifs des assets, format de fil d'authentification **dans l'image
construite**, et un conteneur qui doit réellement répondre 204 / 401 / 404. Tout
se fait sur une copie temporaire : ton `.env`, ton `.htpasswd` et un éventuel
déploiement en place ne sont pas touchés.

Les mêmes étapes tournent en intégration continue, mais ce script n'en dépend
pas : un dépôt cloné doit être vérifiable hors ligne, et la boucle est plus
courte que de pousser pour savoir.

## Dépannage : `invalid key` sur le relais

hbbr journalise `Relay authentication failed from … - invalid key` et le
navigateur n'obtient jamais de session. hbbr ne dit rien au client — il se
contente de fermer — d'où la bannière de la page, déduite de la vitesse à
laquelle la liaison est tombée.

**La cause est une clé qui ne correspond pas, et c'est presque toujours l'un de ces trois cas :**

1. **hbbs et hbbr ne partagent pas le même volume `data/`.** Avec `-k _`, chaque
   processus génère sa propre paire de clés au premier démarrage : la clé publiée
   par hbbs n'est alors pas celle que hbbr vérifie. Les deux services doivent
   monter le *même* répertoire. C'est l'exigence documentée : le guide RustDesk
   pour déployer un relais supplémentaire demande de copier la paire
   `id_ed25519` **et** `id_ed25519.pub` sur la machine du relais avant de lancer
   `hbbr -k _`
   ([doc relais](https://rustdesk.com/docs/en/self-host/rustdesk-server-pro/relay/)),
   la clé publique étant celle générée au premier démarrage de hbbs
   ([configuration client](https://rustdesk.com/docs/en/self-host/client-configuration/)).
2. La valeur donnée à `setup.sh` n'est pas celle qu'utilise réellement le serveur.
   Relève-la depuis le serveur, ne la retape pas :
   ```bash
   docker exec hbbs cat /root/id_ed25519.pub    # 44 caractères base64, finit par « = »
   ```
3. Une espace ou un retour à la ligne collé avec la clé. `setup.sh` les retire et
   signale une forme inattendue, mais un navigateur qui s'est connecté avant la
   correction garde l'ancienne valeur dans `localStorage` — recharge une fois
   après avoir corrigé `.env`.

Pour confirmer que c'est bien la clé : une liaison relais qui meurt en **moins
d'une seconde** est une clé refusée ; une qui vit **une trentaine de secondes**
signifie que la clé était bonne et que le poste distant n'est jamais arrivé. Ce
sont les deux chemins distincts de `relay_server.rs` dans hbbr, rien d'autre ne
ferme cette liaison en silence.

> **Ne pas « corriger » les tags protobuf de `RequestRelay`.** Cela a maintenant
> été tenté et annulé deux fois. Le `rendezvous.proto` officiel dit `uuid = 2`,
> `licence_key = 6` — exactement ce que le bundle envoie déjà. Les réassigner
> casse aussi le client natif, puisque hbbr lit alors l'uuid là où il attend la
> clé. Et hbbr n'authentifie pas les clients WebSocket autrement que les clients
> TCP bruts : `make_pair_` est générique sur le flux, et le contrôle de la clé a
> lieu **avant** toute distinction `is_ws()`.

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
