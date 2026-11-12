#!/usr/bin/env bash
# Rejoue en local l'integralite des controles de .github/workflows/ci.yml.
#
# Pourquoi ce script existe : Actions n'est pas toujours disponible — compte
# verrouille, dépôt cloné hors ligne, contribution avant ouverture de PR. Les
# controles ne doivent pas dependre de l'infrastructure d'un tiers pour etre
# executables.
#
# Ne touche PAS a ton arborescence : tout se fait sur une copie temporaire, de
# sorte qu'un .env, un .htpasswd ou un deploiement en place restent intacts.
#
# Usage : ./scripts/verify.sh [--sans-docker]
#
#   --sans-docker : s'arrete avant la construction des images. Tout le reste
#     tourne — syntaxe, extraction et correctifs, banc du gabarit, banc
#     navigateur s'il est disponible — et le format de fil d'authentification est
#     controle sur le bundle patche lui-meme (la CI le refait DANS l'image). Pour
#     une machine sans Docker, ou pour une boucle de travail plus courte.
set -euo pipefail
cd "$(dirname "$0")/.."
SOURCE=$(pwd)
SANS_DOCKER=0
case "${1:-}" in
  "")            ;;
  --sans-docker) SANS_DOCKER=1 ;;
  -h|--help)     sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)             printf '\033[31m  ✗ argument inconnu : %s (voir --help)\033[0m\n' "$1" >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { printf '\033[31m  ✗ un seul argument attendu (voir --help)\033[0m\n' >&2; exit 2; }

vert()  { printf '\033[32m%s\033[0m\n' "$*"; }
rouge() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
titre() { printf '\n\033[1m── %s\033[0m\n' "$*"; }

manque=0
for c in python3 tar; do command -v "$c" >/dev/null || { rouge "  ✗ $c manquant"; manque=1; }; done
if [ "$SANS_DOCKER" -eq 0 ]; then
  command -v docker >/dev/null || { rouge "  ✗ docker manquant (ou --sans-docker)"; manque=1; }
  docker info >/dev/null 2>&1 || { rouge "  ✗ demon Docker injoignable (ou --sans-docker)"; manque=1; }
fi
[ "$manque" -eq 0 ] || exit 1

T=$(mktemp -d)
nettoyer() {
  if [ "$SANS_DOCKER" -eq 0 ]; then
    docker rm -f rdweb-verify rdweb-verify-seul rdfleet-verify >/dev/null 2>&1 || true
    docker network rm rdverify-net >/dev/null 2>&1 || true
    docker rmi -f rustdesk-web:verify rustdesk-tls:verify rustdesk-fleet:verify >/dev/null 2>&1 || true
  fi
  rm -rf "$T"
}
trap nettoyer EXIT

titre "Copie de travail"
tar -cf - --exclude=.git --exclude=html --exclude=node_modules . | (cd "$T" && tar -xf -)
cd "$T"
echo "  ✓ $T"

titre "Syntaxe des scripts shell"
for s in setup.sh scripts/*.sh; do bash -n "$s"; done
vert "  ✓ tous les scripts se parsent"

titre "Syntaxe Python des outils"
python3 -m py_compile scripts/relay-probe.py scripts/build-page.py
vert "  ✓ scripts/relay-probe.py, scripts/build-page.py"
python3 -I -m py_compile fleet/server.py scripts/online-probe.py
vert "  ✓ fleet/server.py, scripts/online-probe.py"

titre "Service flotte : tests unitaires"
# Contre un FAUX hbbs TCP : le cadrage hbb_common, le bitmap MSB-first, le cache de 10 s, l'API, la garde CSRF, la validation.
python3 -I -m unittest discover -s fleet -v > "$T/fleet.log" 2>&1 || true
n=$(sed -n 's/^Ran \([0-9][0-9]*\) tests\{0,1\} in.*/\1/p' "$T/fleet.log" | tail -1)
tail -3 "$T/fleet.log" | grep -q '^OK' || { rouge "  ✗ tests du service flotte :"; tail -25 "$T/fleet.log"; exit 1; }
PLANCHER_FLOTTE=19
[ "${n:-0}" -ge "$PLANCHER_FLOTTE" ] || { rouge "  ✗ service flotte : $n tests, plancher $PLANCHER_FLOTTE"; exit 1; }
vert "  ✓ service flotte ($n tests, plancher $PLANCHER_FLOTTE)"

titre "Assemblage de la page"
# web/index.html.template est un produit de web/src/ : tout ce qui suit le lit.
rm -f web/index.html.template
python3 scripts/build-page.py

titre "Le piege retire doit rester retire"
# « docker exec hbbs cat /root/id_ed25519.pub » a ete la seule instruction que
# ce depot donnait pour relever la cle, et elle ne peut pas fonctionner :
# l'image du serveur n'a pas de shell, et le fichier .pub n'est jamais relu par
# hbbs donc il manque le plus souvent. Elle a envoye les utilisateurs chercher
# leur cle ailleurs — c'est-a-dire droit dans les causes 2 et 3.
#
# On la refuse la ou elle serait EXECUTEE : dans un bloc de code, ou dans un
# message de la page. La citer en prose pour expliquer pourquoi elle est fausse
# reste evidemment permis, et c'est ce que font les README.
python3 - <<'GARDE'
import pathlib, re, sys
fautes = []
for f in ("README.md", "README.fr.md"):
    texte = pathlib.Path(f).read_text(encoding="utf-8")
    for bloc in re.findall(r"```.*?```", texte, re.S):
        if "id_ed25519.pub" in bloc:
            fautes.append(f"{f} : « id_ed25519.pub » dans un bloc de code")
gabarit = pathlib.Path("web/index.html.template").read_text(encoding="utf-8")
if "id_ed25519.pub" in gabarit:
    fautes.append("web/index.html.template : la page ne doit pas conseiller le fichier .pub")
if "docker exec hbbs" in gabarit:
    fautes.append("web/index.html.template : « docker exec hbbs » ne fonctionne pas, image sans shell")
for f in fautes:
    print("  \033[31m✗\033[0m " + f)
sys.exit(1 if fautes else 0)
GARDE
vert "  ✓ aucune instruction impossible"

titre "Syntaxe JavaScript du gabarit"
./scripts/check-syntax.sh

titre "Extraction et correctifs du bundle"
./scripts/extract-assets.sh >/dev/null
./scripts/patch-assets.sh
./scripts/build-web.sh

titre "Rendu de la configuration"
printf 'admin:$6$rounds=5000$test$salt\n' > .htpasswd
rendre() { sed -e "s|__RD_DOMAIN__|localhost|g" -e "s|__RD_BACKEND_HOST__|127.0.0.1|g" \
               -e "s|__RD_PUBLIC_KEY__|cle_de_test|g" -e "s|__RD_DEFAULT_PEER_ID__||g" \
               -e "s|__RD_ACME_EMAIL__|ci@example.com|g" -e "s|__RD_SESSION_TOKEN__|jeton_de_test|g" \
               "$1" > "$2"; }
rendre nginx.conf.template     nginx.conf
rendre Caddyfile.template      Caddyfile
rendre web/index.html.template html/index.html
echo "  ✓ nginx.conf, Caddyfile, html/index.html"

titre "Syntaxe JavaScript de la page rendue"
./scripts/check-syntax.sh html/index.html

titre "Correctifs presents dans le bundle"
for m in '/ws/relay' 'get_conn_status' '__rdUnzstd' '__rdZstdDecoder'; do
  grep -q -- "$m" html/js/dist/index.js || { rouge "  ✗ correctif absent : $m"; exit 1; }
  echo "  ✓ $m"
done

# Plancher du nombre de tests : un test supprime ou desactive en silence ne doit
# pas faire passer le controle. A RELEVER quand on ajoute des tests, jamais a
# baisser sans raison ecrite dans le commit.
PLANCHER_GABARIT=202
PLANCHER_NAVIGATEUR=112

titre "Banc du gabarit"
# Meme controle que la CI. Il exige html/js/dist/, produit juste au-dessus.
if command -v node >/dev/null 2>&1; then
  node scripts/test-template.mjs --require-vendor 2>&1 | tee "$T/banc-gabarit.log"
  n=$(sed -n 's/^ℹ tests \([0-9][0-9]*\).*/\1/p' "$T/banc-gabarit.log" | tail -1)
  [ "${n:-0}" -ge "$PLANCHER_GABARIT" ] || { rouge "  ✗ banc du gabarit : ${n:-0} tests, plancher $PLANCHER_GABARIT"; exit 1; }
  vert "  ✓ banc du gabarit ($n tests, plancher $PLANCHER_GABARIT)"
else
  rouge "  ⚠ node absent — banc du gabarit ignore (la CI le fait)"
fi

titre "Banc navigateur"
# Chromium reel : ignore avec un message si Playwright ou le navigateur manque
# (la CI, elle, l'exige). NODE_PATH permet de retrouver un Playwright installe
# globalement (npm root -g).
if command -v node >/dev/null 2>&1; then
  NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null || true)}" node scripts/test-browser.mjs 2>&1 | tee "$T/banc-navigateur.log"
  # Le banc s'ignore (sortie 0) sans Playwright : le plancher ne vaut que s'il a tourne.
  if grep -q "tests navigateur reussis" "$T/banc-navigateur.log"; then
    n=$(sed -n 's|^\([0-9][0-9]*\)/[0-9][0-9]* tests navigateur reussis.*|\1|p' "$T/banc-navigateur.log" | tail -1)
    [ "${n:-0}" -ge "$PLANCHER_NAVIGATEUR" ] || { rouge "  ✗ banc navigateur : ${n:-0} tests reussis, plancher $PLANCHER_NAVIGATEUR"; exit 1; }
    vert "  ✓ banc navigateur ($n tests, plancher $PLANCHER_NAVIGATEUR)"
  fi
else
  rouge "  ⚠ node absent — banc navigateur ignore (la CI le fait)"
fi

if [ "$SANS_DOCKER" -eq 1 ]; then
  titre "Format de fil d'authentification, sur le bundle patche"
  # Sans Docker on ne peut pas lire l'image ; on lit le bundle qui y serait copie.
  # C'est le meme fichier (le Dockerfile fait « COPY html/ »), mais la CI refait
  # ce controle DANS l'image, et c'est celui-la qui fait foi.
  verif_local() {
    n=$(grep -c -F "$1" html/js/dist/index.js || true)
    [ "$n" = "$2" ] || { rouge "  ✗ « $1 » : attendu $2, vu $n"; exit 1; }
    echo "  ✓ « $1 » = $n"
  }
  verif_local 'uint32(18).string(u.uuid)'        1
  verif_local 'uint32(50).string(u.licence_key)' 1
  verif_local 'uint32(18).string(u.licence_key)' 0
  titre "Termine (sans Docker)"
  vert "  Controles passes. Restent pour la CI : les images, l'auth DANS l'image, les sondes HTTP."
  echo "  Ton arborescence n'a pas ete modifiee."
  exit 0
fi

titre "Construction des images"
docker build -q -t rustdesk-web:verify . >/dev/null
docker build -q -t rustdesk-tls:verify -f Dockerfile.tls . >/dev/null
docker build -q -t rustdesk-fleet:verify fleet >/dev/null
vert "  ✓ rustdesk-web:verify, rustdesk-tls:verify, rustdesk-fleet:verify"

titre "Format de fil d'authentification, DANS l'image"
# Le controle decisif : c'est l'artefact embarque qui compte, pas celui du
# depot. Un bundle aux tags permutes a deja tenu deux heures en production
# pendant que le depot, lui, etait correct.
verif() {
  n=$(docker run --rm rustdesk-web:verify \
        grep -c -F "$1" /usr/share/nginx/html/js/dist/index.js || true)
  [ "$n" = "$2" ] || { rouge "  ✗ « $1 » : attendu $2, vu $n"; exit 1; }
  echo "  ✓ « $1 » = $n"
}
verif 'uint32(18).string(u.uuid)'        1   # RequestRelay.uuid        = champ 2
verif 'uint32(50).string(u.licence_key)' 1   # RequestRelay.licence_key = champ 6
verif 'uint32(18).string(u.licence_key)' 0   # la permutation fautive

titre "L'image sert reellement"
docker run --rm rustdesk-web:verify nginx -t 2>&1 | tail -1 | sed 's/^/  /'
docker run -d --name rdweb-verify -p 18099:80 rustdesk-web:verify >/dev/null
code=""
for _ in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18099/healthz || true)
  [ "$code" = "204" ] && break
  sleep 1
done
[ "$code" = "204" ] || { rouge "  ✗ /healthz : $code"; docker logs rdweb-verify; exit 1; }
echo "  ✓ /healthz = 204"

attendu() {
  c=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:18099$1")
  [ "$c" = "$2" ] || { rouge "  ✗ $1 : attendu $2, vu $c"; exit 1; }
  echo "  ✓ $1 = $c"
}
attendu /                        401   # la page exige une authentification
attendu /js/dist/index.js.orig   404   # les sources non corrigees ne sont pas servies
attendu /rd-console.js           401   # la console est derriere la meme authentification

# La console avec le cookie de session (jeton de test du rendu ci-dessus) : servie, compressee, revalidee.
cons=$(curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' -H 'Cookie: rdsession=jeton_de_test' http://127.0.0.1:18099/rd-console.js | tr -d '\r')
echo "$cons" | head -1 | grep -q ' 200' || { rouge "  ✗ /rd-console.js avec cookie : $(echo "$cons" | head -1)"; exit 1; }
echo "$cons" | grep -qi '^content-type: .*javascript' || { rouge "  ✗ /rd-console.js : type inattendu"; echo "$cons"; exit 1; }
echo "$cons" | grep -qi '^content-encoding: gzip' || { rouge "  ✗ /rd-console.js n'est pas compresse"; echo "$cons"; exit 1; }
echo "$cons" | grep -qi '^cache-control: no-cache' || { rouge "  ✗ /rd-console.js : Cache-Control no-cache attendu"; echo "$cons"; exit 1; }
echo "  ✓ /rd-console.js = 200, javascript, gzip, no-cache"
cs=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' -H 'Cookie: rdsession=jeton_de_test' http://127.0.0.1:18099/rd-console.css)
[ "$cs" = "200 text/css" ] || { rouge "  ✗ /rd-console.css : $cs"; exit 1; }
echo "  ✓ /rd-console.css = 200 text/css"

titre "nginx sans le service flotte (facultatif : son absence ne doit RIEN casser)"
# Le piege : un « proxy_pass http://fleet:8000 » litteral fait REFUSER LE DEMARRAGE de nginx quand « fleet » n'existe pas. Le
# conteneur ci-dessus tourne sur le reseau par defaut, sans « fleet » : il est deja demarre, c'est la preuve. Ici, l'API doit
# repondre 502 (et vite : resolver_timeout 2s), jamais bloquer ni faire tomber le reste.
debut=$(date +%s)
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -H 'Cookie: rdsession=jeton_de_test' http://127.0.0.1:18099/api/health || true)
duree=$(( $(date +%s) - debut ))
[ "$code" = "502" ] || { rouge "  ✗ /api/health sans service : attendu 502, vu $code"; docker logs rdweb-verify 2>&1 | tail -5; exit 1; }
[ "$duree" -le 6 ] || { rouge "  ✗ /api/health sans service : ${duree}s (resolver_timeout 2s attendu)"; exit 1; }
echo "  ✓ /api/health sans service = 502 en ${duree}s ; la page reste servie"
attendu /api/health              401   # et l'API est derriere la meme authentification
attendu /healthz                 204

titre "nginx + service flotte, de bout en bout"
docker rm -f rdweb-verify >/dev/null 2>&1 || true
docker network create rdverify-net >/dev/null
docker run -d --name rdfleet-verify --network rdverify-net --network-alias fleet -e RD_BACKEND_HOST=127.0.0.1 rustdesk-fleet:verify >/dev/null
docker run -d --name rdweb-verify --network rdverify-net -p 18099:80 rustdesk-web:verify >/dev/null
for _ in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Cookie: rdsession=jeton_de_test' http://127.0.0.1:18099/api/health || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$code" = "200" ] || { rouge "  ✗ /api/health avec le service : $code"; docker logs rdfleet-verify 2>&1 | tail -5; docker logs rdweb-verify 2>&1 | tail -5; exit 1; }
echo "  ✓ /api/health avec cookie = 200"
api() {                          # api METHODE chemin corps [options curl...] -> code HTTP
  local m=$1 c=$2 corps=$3
  shift 3
  if [ -n "$corps" ]; then
    curl -s -o /dev/null -w '%{http_code}' -X "$m" -H 'Cookie: rdsession=jeton_de_test' -H 'Content-Type: application/json' "$@" -d "$corps" "http://127.0.0.1:18099$c"
  else
    curl -s -o /dev/null -w '%{http_code}' -X "$m" -H 'Cookie: rdsession=jeton_de_test' "$@" "http://127.0.0.1:18099$c"
  fi
}
verif_api() { [ "$1" = "$2" ] || { rouge "  ✗ $3 : attendu $2, vu $1"; exit 1; }; echo "  ✓ $3 = $1"; }
verif_api "$(api POST /api/devices '{"id":"123456789","nom":"Mac"}' -H 'X-RD: 1')" 201 "creer un poste (avec X-RD)"
verif_api "$(api POST /api/devices '{"id":"987654321"}')"                      403 "ecriture SANS X-RD refusee (garde CSRF)"
verif_api "$(api GET /api/devices '' -H 'Sec-Fetch-Site: cross-site')"          403 "lecture entre sites refusee"
verif_api "$(api POST /api/devices '{"id":"x"}' -H 'X-RD: 1')"                  400 "ID invalide refuse"
liste=$(curl -s -H 'Cookie: rdsession=jeton_de_test' http://127.0.0.1:18099/api/devices)
echo "$liste" | python3 -I -c "
import json, sys
j = json.load(sys.stdin)
assert [p['id'] for p in j['postes']] == ['123456789'], j
assert j['postes'][0]['en_ligne'] is None, 'hbbs absent : etat INCONNU, jamais hors ligne'
assert j['en_ligne_disponible'] is False
" || { rouge "  ✗ liste des postes inattendue : $liste"; exit 1; }
echo "  ✓ liste : le poste cree, etat en ligne inconnu (hbbs absent), jamais « hors ligne »"
verif_api "$(api DELETE /api/devices/123456789 '' -H 'X-RD: 1')" 200 "supprimer"
docker stop rdfleet-verify >/dev/null
sleep 1
verif_api "$(curl -s -o /dev/null -w '%{http_code}' -m 15 -H 'Cookie: rdsession=jeton_de_test' http://127.0.0.1:18099/api/health)" 502 "service arrete : 502, nginx tient"
attendu /healthz                 204

titre "Termine"
vert "  Tous les controles passent."
echo "  Ton arborescence n'a pas ete modifiee."
