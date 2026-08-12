#!/usr/bin/env bash
# Met en place l'arborescence servie (html/) à partir des assets du client.
#
# Par défaut : décompresse l'archive versionnée dans assets/, après
# vérification de son empreinte. Aucun réseau, aucune dépendance externe.
#
# Avec --from-image : re-dérive les mêmes fichiers depuis l'image communautaire
# d'origine et compare l'empreinte. C'est le moyen de vérifier soi-même la
# provenance de l'archive plutôt que de la croire sur parole.
#
# Pourquoi une archive versionnée : le client web V1 open source a été retiré du
# dépôt public de RustDesk entre juillet 2025 et la version 1.4.4. Il n'existe
# aucune source amont plus récente à compiler, et dépendre d'une image tierce
# ferait disparaître ce projet le jour où elle serait retirée de Docker Hub.
set -euo pipefail
cd "$(dirname "$0")/.."

ARCHIVE="assets/rustdesk-web-assets.tar.gz"
IMAGE="pmietlicki/rustdesk-web-client@sha256:da957e62f4c95179107632b7386735aec35c3ba10976bdb3ac00b747e496a2e6"

verifier() {
  local attendu reel
  attendu=$(awk '{print $1}' assets/SHA256SUMS)
  if command -v sha256sum >/dev/null 2>&1; then reel=$(sha256sum "$1" | awk '{print $1}')
  else reel=$(shasum -a 256 "$1" | awk '{print $1}'); fi
  [ "$attendu" = "$reel" ] || { echo "  ✗ empreinte invalide pour $1"; exit 1; }
  echo "  ✓ empreinte vérifiée : ${reel:0:16}…"
}

if [ "${1:-}" = "--from-image" ]; then
  echo "  re-dérivation depuis l'image d'origine (jamais exécutée)…"
  command -v docker >/dev/null || { echo "  docker requis pour --from-image"; exit 1; }
  docker pull -q "$IMAGE" >/dev/null
  TMPC="rdweb-extract-$$"; TMPD=$(mktemp -d)
  trap 'docker rm -f "$TMPC" >/dev/null 2>&1 || true; rm -rf "$TMPD"' EXIT
  docker create --name "$TMPC" "$IMAGE" >/dev/null
  docker export "$TMPC" | tar -x -C "$TMPD" usr/share/nginx/html 2>/dev/null
  SRC="$TMPD/usr/share/nginx/html"

  # Seul ce sous-ensemble est utilisé : l'application Flutter livrée dans la
  # même image (canvaskit, main.dart.js, assets/) ne fonctionne pas et pèse 26 Mo.
  rm -rf html; mkdir -p html/js/dist
  cp -a "$SRC/js/dist/." html/js/dist/
  cp -a "$SRC/ogvjs-1.8.6" html/
  cp -f "$SRC/yuv-canvas-1.2.6.js" html/
  for f in libopus.js libopus.wasm yuv.js yuv.wasm; do
    [ -f "$SRC/$f" ] && cp -f "$SRC/$f" html/js/dist/
  done
  rm -f html/js/dist/index.html

  # Compare avec l'archive versionnée : si elles divergent, l'une des deux ment.
  T2=$(mktemp -d); tar -xzf "$ARCHIVE" -C "$T2"
  if diff -rq "$T2" html >/dev/null 2>&1; then
    echo "  ✓ identique à $ARCHIVE — provenance confirmée"
  else
    echo "  ⚠ DIVERGENCE avec $ARCHIVE :"; diff -rq "$T2" html | head -10
  fi
  rm -rf "$T2"
else
  [ -f "$ARCHIVE" ] || { echo "  $ARCHIVE introuvable"; exit 1; }
  verifier "$ARCHIVE"
  rm -rf html; mkdir -p html
  tar -xzf "$ARCHIVE" -C html
fi

# Notre propre icône : absente de l'image source.
[ -f web/favicon.svg ] && cp -f web/favicon.svg html/

# Bundle intact : c'est la base dont part patch-assets.sh.
cp -f html/js/dist/index.js html/js/dist/index.js.orig

echo "  ✓ html/ en place ($(du -sh html | cut -f1), $(find html -type f | wc -l | tr -d ' ') fichiers)"
