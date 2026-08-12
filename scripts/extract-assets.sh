#!/usr/bin/env bash
# Récupère les assets du client web RustDesk depuis l'image communautaire.
#
# L'image n'est JAMAIS exécutée : on crée un conteneur sans le démarrer,
# on exporte son système de fichiers, on en extrait l'arborescence statique.
# Le serveur qui les servira est le nginx officiel, sous notre configuration.
#
# Pourquoi cette image plutôt qu'un build depuis les sources : le client web
# V1 open source a été retiré du dépôt public de RustDesk entre juillet 2025
# et la version 1.4.4. `flutter/web/` n'existe plus sur master ni sur aucun
# tag récent — l'interface Dart reste ouverte, la couche de connexion non.
# Il n'existe donc aucune source amont plus récente à compiler.
set -euo pipefail
cd "$(dirname "$0")/.."

# Digest épinglé : une étiquette mutable ne garantit rien.
IMAGE="pmietlicki/rustdesk-web-client@sha256:da957e62f4c95179107632b7386735aec35c3ba10976bdb3ac00b747e496a2e6"
TMPC="rdweb-extract-$$"

echo "  téléchargement de l'image source (jamais exécutée)…"
docker pull "$IMAGE" >/dev/null

echo "  extraction sans démarrage…"
docker create --name "$TMPC" "$IMAGE" >/dev/null
trap 'docker rm -f "$TMPC" >/dev/null 2>&1 || true' EXIT

rm -rf html; mkdir -p html
docker export "$TMPC" | tar -x -C /tmp usr/share/nginx/html 2>/dev/null
cp -a /tmp/usr/share/nginx/html/. html/
rm -rf /tmp/usr

# node_modules complet livré dans la racine web : 125 Mo de code mort.
if [ -d html/js/node_modules ]; then
  rm -rf html/js/node_modules
  echo "  node_modules retiré (code mort dans la racine servie)"
fi

# Bundle intact : c'est la base dont part patch-assets.sh.
cp html/js/dist/index.js html/js/dist/index.js.orig

echo "  ✓ assets extraits dans html/ ($(du -sh html | cut -f1))"
