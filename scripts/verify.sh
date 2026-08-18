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
# Usage : ./scripts/verify.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SOURCE=$(pwd)

vert()  { printf '\033[32m%s\033[0m\n' "$*"; }
rouge() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
titre() { printf '\n\033[1m── %s\033[0m\n' "$*"; }

manque=0
for c in docker python3 tar; do command -v "$c" >/dev/null || { rouge "  ✗ $c manquant"; manque=1; }; done
docker info >/dev/null 2>&1 || { rouge "  ✗ demon Docker injoignable"; manque=1; }
[ "$manque" -eq 0 ] || exit 1

T=$(mktemp -d)
nettoyer() {
  docker rm -f rdweb-verify >/dev/null 2>&1 || true
  docker rmi -f rustdesk-web:verify rustdesk-tls:verify >/dev/null 2>&1 || true
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

titre "Syntaxe JavaScript du gabarit"
./scripts/check-syntax.sh

titre "Extraction et correctifs du bundle"
./scripts/extract-assets.sh >/dev/null
./scripts/patch-assets.sh

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
for m in '/ws/relay' 'get_conn_status' '__rdUnzstd'; do
  grep -q -- "$m" html/js/dist/index.js || { rouge "  ✗ correctif absent : $m"; exit 1; }
  echo "  ✓ $m"
done

titre "Construction des images"
docker build -q -t rustdesk-web:verify . >/dev/null
docker build -q -t rustdesk-tls:verify -f Dockerfile.tls . >/dev/null
vert "  ✓ rustdesk-web:verify, rustdesk-tls:verify"

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

titre "Termine"
vert "  Tous les controles passent."
echo "  Ton arborescence n'a pas ete modifiee."
