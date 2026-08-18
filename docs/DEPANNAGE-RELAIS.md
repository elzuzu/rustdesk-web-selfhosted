# Dépannage du relais — `invalid key`

Symptôme : `hbbr` journalise
`Relay authentication failed from … - invalid key`, et le navigateur n'obtient
jamais de session. Côté page, on ne voit qu'une déconnexion immédiate.

Ce document se lit dans l'ordre. Chaque étape a un verdict attendu ; dès qu'une
étape tranche, va directement au remède qu'elle nomme. Il est écrit pour être
exécuté tel quel, par un humain ou par un agent.

---

## Avant tout : deux choses qui font perdre du temps

**« Le client natif marche, donc ce n'est pas la clé. »** Faux, et c'est le
piège principal. Le client natif perce le NAT et établit une liaison
**directe** : il ne touche `hbbr` quasiment jamais. Le client web n'a pas d'UDP,
**il passe par le relais à 100 %**. « Natif OK, web KO » est exactement la
signature d'un désaccord de clé entre `hbbs` et `hbbr`.

**`docker exec hbbs cat /root/id_ed25519.pub` ne peut pas fonctionner.** L'image
`rustdesk/rustdesk-server` n'a ni shell ni `cat`, et le fichier `.pub` n'existe
souvent pas — `hbbs` relit `id_ed25519` et dérive la clé publique de ses 32
derniers octets, il n'a jamais besoin du `.pub`. Si tu as relevé ta clé ainsi et
que tu as obtenu une erreur, tu l'as forcément prise ailleurs : c'est peut-être
déjà toute la panne.

---

## Étape 1 — une seule commande, sur la machine du serveur

```bash
cd <dossier du client web>
./scripts/relay-doctor.sh
./scripts/relay-doctor.sh --json     # à coller dans un rapport
```

Il n'a besoin de rien : ni navigateur, ni identifiants, ni poste distant. Il
relève les clés effectives, les compare, teste la joignabilité de 21118 **et**
21119, lit la configuration du poste contrôlé s'il est sur cette machine, puis
envoie une vraie trame `RequestRelay` sur `/ws/relay`.

Trois sondes sont envoyées, et la deuxième valide les deux autres :

| Sonde | Attendu |
|---|---|
| clé configurée | `ACCEPTEE` — la liaison reste ouverte (hbbr attend le pair 30 s) |
| clé témoin, volontairement fausse | `REFUSEE` en quelques dizaines de ms |
| clé vide | `REFUSEE` |

---

## Étape 2 — lire le verdict

### A. « hbbs et hbbr DIVERGENT »

**C'est fini, on sait.** Les deux processus appliquent deux clés différentes.
Avec `-k _`, chacun exécute `gen_sk(300)` : après une courte attente, si le
fichier de clé manque toujours, il **génère sa propre paire**, sans un mot.

Remède :

```bash
docker compose down                    # hbbs ET hbbr
ls -la data/                           # garder UN SEUL id_ed25519
```

Vérifie que les deux services montent le **même** répertoire :

```yaml
  hbbs:
    command: hbbs -k _
    volumes: [./data:/root]            # le MÊME
  hbbr:
    command: hbbr -k _
    volumes: [./data:/root]            # le MÊME
```

En installation native, ce n'est pas un volume mais le **répertoire de travail**
de chaque processus : le fichier de clé y est cherché, pas à un chemin fixe.
Deux lancements depuis deux dossiers différents produisent exactement la même
panne.

Puis :

```bash
docker compose up -d
docker logs hbbs 2>&1 | grep 'Key:'
docker logs hbbr 2>&1 | grep 'Key:'    # les deux doivent coïncider
```

Enfin, régénère la page avec la clé retrouvée : `./setup.sh` la relève tout seul.

### B. « hbbr REFUSE la clé configurée », mais hbbs et hbbr s'accordent

Le serveur est cohérent : c'est la valeur configurée dans la page qui est
fausse. Relance `./setup.sh` — il relève désormais la clé sur le serveur au lieu
de la demander, et refuse une clé privée ou une longueur invalide.

Vérifie aussi la ligne **« clé réellement servie »** du rapport : la
configuration est cuite dans l'image, sans volume monté. Un `html/index.html`
corrigé sur le disque ne change **rien** au service tant qu'il n'y a pas eu de
reconstruction.

### C. « 21118 ouvert, 21119 FERMÉ »

`hbbr` n'est pas joignable depuis le conteneur web. `/ws/id` fonctionnera,
`/ws/relay` non — d'où l'impression que « la connexion démarre puis meurt ».
Vérifie que `hbbr` tourne et que `RD_BACKEND_HOST` le joint.

Attention : **le port 21118 n'identifie pas `hbbs`.** Le *client* RustDesk
écoute lui aussi dessus pour ses liaisons directes en réseau local. Sur une
machine qui héberge le serveur et fait tourner le client, 21118 est ambigu ;
21119 ne l'est pas.

### D. « INTESTABLE »

La liaison n'atteint pas `hbbr`. Ce n'est pas un problème de clé :
`/ws/relay` n'est pas proxifié, ou le proxy renvoie 401/404/502. Regarde le
détail donné par la sonde, il contient la ligne de statut HTTP.

### E. Tout est vert

La clé est bonne côté serveur **et** la sonde l'accepte. Passe à l'étape 3 : le
problème est dans le navigateur, ou sur l'autre jambe du relais.

---

## Étape 3 — le navigateur

Ouvre la page, puis dans la console :

```js
rdRelayTest()     // rejoue les trois mêmes sondes depuis CE navigateur
rdRelayReset()    // réécrit la clé et l'hôte depuis la page, puis recharge
rdDiag()          // état général de la session
```

C'est le seul verdict qui prouve ce que *ce navigateur-là* envoie. Le bundle
lit `licence_key` dans `localStorage` et rien d'autre :

```js
Q.fromPartial({ licence_key: localStorage.getItem("key") || void 0, uuid: t })
```

Le `|| void 0` compte : un `localStorage` vide n'envoie pas une clé vide, il
**omet le champ** — et `hbbr` rejette exactement comme pour une clé fausse. Un
navigateur qui a ouvert la page avant un changement de clé garde l'ancienne
valeur indéfiniment. `rdRelayReset()` corrige ce cas.

---

## Étape 4 — l'autre jambe du relais

Un relais a **deux jambes**, authentifiées séparément : le navigateur d'un côté,
le poste contrôlé de l'autre. Si c'est la clé du **poste** qui ne correspond
pas, la liaison du navigateur ne tombe pas tout de suite — elle vit une
trentaine de secondes puis meurt faute de pair.

| Durée de vie de la liaison relais | Cause |
|---|---|
| moins d'une seconde | clé refusée, jambe navigateur |
| une trentaine de secondes | clé acceptée, mais le pair n'est jamais arrivé |

La clé du poste se lit dans son `RustDesk2.toml` :

| Système | Chemin |
|---|---|
| macOS, démon root **(fait autorité)** | `/var/root/Library/Preferences/com.carriez.RustDesk/RustDesk2.toml` |
| macOS, utilisateur | `~/Library/Preferences/com.carriez.RustDesk/RustDesk2.toml` |
| Linux | `~/.config/rustdesk/RustDesk2.toml` |
| Windows | `%APPDATA%\RustDesk\config\RustDesk2.toml` |

Sur macOS, **le démon root écrase la configuration utilisateur à chaque
lancement de l'interface** : éditer la seconde seule ne sert à rien. Recharger
après correction :

```bash
sudo launchctl kickstart -k system/com.carriez.RustDesk_service
launchctl kickstart -k gui/$UID/com.carriez.RustDesk_server
```

Si le poste est ailleurs, passe son fichier au docteur :

```bash
./scripts/relay-doctor.sh --peer-config /chemin/vers/RustDesk2.toml
```

---

## Ce qu'il faut renvoyer si rien n'aboutit

```bash
./scripts/relay-doctor.sh --json > rapport.json
docker logs hbbs 2>&1 | grep -m1 'Key:'
docker logs hbbr 2>&1 | grep -m1 'Key:'
docker logs --tail 50 hbbr 2>&1
```

Et depuis la console du navigateur, la sortie de `rdRelayTest()`.

Le rapport contient déjà les empreintes de clés tronquées, la topologie
détectée et les temps de chaque sonde — c'est suffisant pour trancher à
distance.

---

## Ce qu'il ne faut PAS faire

**Ne touche pas aux tags protobuf de `RequestRelay`.** Cela a été tenté et
annulé deux fois. Le `rendezvous.proto` officiel dit `uuid = 2`,
`licence_key = 6` — exactement ce que le bundle envoie déjà. Les réassigner
casse aussi le client natif, et `hbbr` n'authentifie pas les clients WebSocket
autrement que les clients TCP bruts : le contrôle de la clé a lieu **avant**
toute distinction `is_ws()`.

**Ne retire jamais `-k _`.** Sans clé, `hbbr` est un relais ouvert à Internet.
Si la sonde témoin (clé volontairement fausse) est `ACCEPTEE`, c'est exactement
ce qui se passe.
