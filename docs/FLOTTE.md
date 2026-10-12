# Liste des postes — le service « flotte »

Facultatif. Ajoute une page d'accueil **Mes postes** (nom, note, étiquettes, favori, dernière connexion, **état en ligne**) et le
sélecteur **Postes** en session. Sans lui, le client marche exactement comme avant.

## Ce qu'il fait — et ne fait pas

| Fait | Ne fait pas |
|---|---|
| Garde la liste de vos postes (SQLite, volume `fleet-data`) | Ne voit **aucun mot de passe de poste** : le navigateur les garde |
| Demande à hbbs lesquels sont **en ligne** (TCP 21115) | N'ouvre aucune session, ne parle pas au relais |
| Répond en JSON derrière nginx | N'a **aucune authentification propre** : il n'écoute que dans le réseau Docker |

## Architecture

```
navigateur ──HTTPS──► Caddy ──► nginx ──┬── /            page + assets
                                        ├── /ws/id /ws/relay  ──► hbbs / hbbr
                                        └── /api/        ──► fleet:8000 ──┬── SQLite (/data)
                                           (même auth Basic/cookie,       └── TCP 21115 ──► hbbs   (OnlineRequest)
                                            zone de débit séparée)
```

- Le conteneur `fleet` n'est **pas** publié. Lecture seule, `cap_drop: ALL`, `no-new-privileges`, utilisateur 10001, 64 Mio.
- nginx résout `fleet` **à chaque requête** (`resolver 127.0.0.11` + variable). Avec un `proxy_pass` littéral, nginx *refuserait de
  démarrer* dès que le conteneur est absent ; ici l'API répond simplement 502 et la page retombe sur ses dernières connexions.
- Le service vérifie lui-même la **garde CSRF** : toute écriture exige l'en-tête `X-RD: 1` et, quand le navigateur l'envoie,
  `Sec-Fetch-Site: same-origin|none`. Les navigateurs joignent les identifiants Basic aux requêtes entre sites ; sans cette garde, une
  page tierce pourrait modifier votre liste.

## Activer, désactiver

```bash
./setup.sh                                   # question « Activer la liste des postes ? » ; écrit RD_FLEET dans .env
docker compose --profile fleet up -d         # à la main
docker compose --profile fleet stop fleet    # arrêter : la page retombe sur ses dernières connexions
```

`setup.sh` teste ensuite le service et le port 21115 **depuis le conteneur** (c'est ce que verra le service) ; un 21115 injoignable
n'est qu'un avertissement, jamais un critère de choix de l'hôte.

## L'état « en ligne »

hbbs OSS ne répond à `OnlineRequest` que sur son port TCP **brut 21115** (`handle_listener2`, `rendezvous_server.rs`), pas sur le
WebSocket 21118 que le navigateur sait parler. D'où ce service. Trois règles à connaître :

1. **Jamais en 127.0.0.1.** Une source loopback tombe dans la console d'administration de hbbs, pas dans `OnlineRequest`. Le service
   se connecte depuis le réseau Docker à `RD_BACKEND_HOST` (jamais `network_mode: host`).
2. **Inconnu n'est pas hors ligne.** Si hbbs ne répond pas (pare-feu, arrêt), l'état est `null` et la page n'affiche ni point vert ni
   point gris, ni « 0 en ligne ».
3. **Fraîcheur.** Un poste est en ligne s'il s'est enregistré depuis moins de 30 s ; après un redémarrage de hbbs, tous paraissent
   hors ligne le temps de se réenregistrer. Le service met l'état en cache 10 s (plusieurs onglets, une seule question à hbbs).

Vérifier, sans rien deviner :

```bash
python3 scripts/online-probe.py 172.17.0.1                 # depuis l'hôte
docker exec rustdesk-fleet python3 -I -c "import os,sys; sys.path.insert(0,'/app'); import server; print(server.sonder_hbbs(os.environ['RD_BACKEND_HOST'], 21115, ['000000000']))"   # depuis le conteneur
```

Verdict `ok` : l'état en ligne sera affiché. Verdict `injoignable` : ouvrez le port TCP 21115 de hbbs au réseau Docker.

## API (interne : derrière nginx)

| Méthode et chemin | Rôle | Codes |
|---|---|---|
| `GET /api/health` | `{ok, version, postes, hbbs}` | 200 |
| `GET /api/devices` | `{postes: [...], en_ligne_disponible}` — chaque poste porte `en_ligne: true / false / null` | 200 |
| `POST /api/devices` | crée (201) ou met à jour (200) : `{id, nom?, note?, etiquettes?, favori?}` | 400 `id_invalide`…, 409 `liste_pleine` |
| `PUT /api/devices/{id}` | met à jour les seuls champs fournis | 404 `inconnu` |
| `POST /api/devices/{id}/touch` | enregistre la dernière connexion (maintenant) | 404 |
| `DELETE /api/devices/{id}` | retire de la liste (le poste n'est pas touché) | 404 |

Validation : ID `^[A-Za-z0-9][A-Za-z0-9_-]{4,31}$` ; nom ≤ 60 caractères sans caractère de contrôle ; note ≤ 500 ; ≤ 8 étiquettes de
≤ 24 caractères, sans virgule ; `favori` booléen strict ; corps ≤ 8 Kio, `application/json` ; **500 postes au plus**. Un champ inconnu
n'est jamais recopié ; une erreur interne ne renvoie jamais de trace.

## Sauvegarde, migration, désinstallation

- **Sauvegarde** : le bouton *Exporter* de la page (fichier JSON, sans état en ligne) — ou `docker run --rm -v rustdesk-web-selfhosted_fleet-data:/d -v "$PWD":/o alpine cp /d/fleet.db /o/`.
- **Restauration** : *Importer* (seul le valide est repris, sans doublon) — ou recopier `fleet.db` dans le volume.
- **Désinstaller** : `docker compose --profile fleet down` puis `docker volume rm rustdesk-web-selfhosted_fleet-data`. Rien d'autre ne dépend du service.

## Dépannage

| Symptôme | Cause probable | Que faire |
|---|---|---|
| Pas de « Mes postes », formulaire seul | service absent / arrêté / `/api/` renvoie 401, 404, 502 | `curl -u … https://hôte/api/health` ; `docker logs rustdesk-fleet` ; `docker compose --profile fleet ps` |
| Liste visible, aucun point vert ni gris | hbbs ne répond pas sur 21115 depuis le conteneur | `scripts/online-probe.py` ; ouvrir 21115 au réseau Docker |
| Tout « hors ligne » juste après un redémarrage de hbbs | les postes ne se sont pas réenregistrés | attendre ≤ 30 s |
| « Le service de la liste ne répond pas » à l'enregistrement | 403 (garde CSRF) : page ouverte depuis une autre origine, ou en-tête perdu par un proxy | passer par l'adresse HTTPS normale ; vérifier que le proxy amont ne retire pas `X-RD` |
| 429 | zone de débit `rdapi` (120 requêtes/min par IP) dépassée | attendre une minute |
