#!/usr/bin/env bash
# Verifie que chaque bloc <script> inline de la page se parse.
#
# Pourquoi ce controle existe : un bloc <script> qui ne se parse pas n'est pas
# degrade, il est ABANDONNE EN ENTIER par le navigateur. Comme tout l'etat de
# l'application (window.RD, onGlobalEvent, onRgba, la reprise audio) tient dans
# un seul bloc, une virgule de travers suffit a livrer un client entierement
# mort — sans le moindre message au chargement de la page. C'est exactement ce
# qui est arrive, et rien dans la chaine ne l'avait vu.
#
# Usage : ./scripts/check-syntax.sh [fichier.html ...]
#         par defaut, web/index.html.template
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "  ⚠ node absent — controle de syntaxe JavaScript ignore"
  echo "    (la CI le fait ; en local, installe node pour l'avoir avant de committer)"
  exit 0
fi

FICHIERS=("$@")
[ ${#FICHIERS[@]} -eq 0 ] && FICHIERS=("web/index.html.template")

TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
echec=0

for src in "${FICHIERS[@]}"; do
  [ -f "$src" ] || { echo "  ✗ $src introuvable"; echec=1; continue; }

  # Les blocs porteurs d'un src= referencent le bundle : rien a verifier ici.
  n=$(python3 - "$src" "$TMPD" <<'PY'
import re, sys, os, hashlib
src, tmpd = sys.argv[1], sys.argv[2]
html = open(src, encoding="utf-8").read()
blocs = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S)
tag = hashlib.sha1(src.encode()).hexdigest()[:8]
for i, b in enumerate(blocs):
    open(os.path.join(tmpd, f"{tag}-{i}.js"), "w", encoding="utf-8").write(b)
print(len(blocs))
PY
)
  tag=$(printf '%s' "$src" | shasum | cut -c1-8)
  echo "  $src — $n bloc(s) inline"
  for f in "$TMPD/$tag"-*.js; do
    [ -f "$f" ] || continue
    i=$(basename "$f" .js); i=${i##*-}
    if err=$(node --check "$f" 2>&1); then
      printf '    ✓ bloc %s\n' "$i"
    else
      printf '    ✗ bloc %s\n' "$i"
      # Les numeros de ligne portent sur le bloc extrait, pas sur le fichier :
      # on affiche l'extrait fautif pour que ce soit exploitable tel quel.
      echo "$err" | sed 's/^/      /' | head -12
      echec=1
    fi
  done
done

[ "$echec" -eq 0 ] || { echo "  ✗ syntaxe JavaScript invalide — la page serait entierement inerte"; exit 1; }
echo "  ✓ syntaxe JavaScript valide"
