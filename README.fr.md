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
