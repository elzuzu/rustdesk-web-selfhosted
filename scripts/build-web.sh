#!/usr/bin/env bash
# Assemble la console de session :
#   web/js/NN-*.js  ->  <sortie>/rd-console.js
#   web/css/*.css   ->  <sortie>/rd-console.css
#
# APPELE PAR setup.sh, verify.sh, la CI et le banc navigateur, APRES
# extract-assets.sh (qui fait « rm -rf html »). Toujours relance : un
# rd-console.js perime serait servi sans le moindre message.
#
# Garde-fous, parce qu'une erreur de syntaxe tue tout le script chargé (c'est la
# lecon du client mort, voir check-syntax.sh) :
#   - chaque source doit etre une IIFE : le banc du gabarit charge tout dans UN
#     contexte, ou un « const » de premier niveau declare deux fois leve ;
#   - chaque source est enveloppee dans un try/catch : un module qui leve au
#     chargement n'empeche pas les autres, et la barre d'origine reste en service ;
#   - la sortie est analysee comme un SCRIPT CLASSIQUE (vm.Script), pas comme un
#     module CommonJS : un « return; » de premier niveau y passerait, alors que
#     le navigateur abandonne le script.
#
# Usage : ./scripts/build-web.sh [repertoire-de-sortie]     (defaut : html)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-html}"
[ -d "$OUT" ] || { printf '\033[31m  ✗ %s absent — lancer ./scripts/extract-assets.sh d abord\033[0m\n' "$OUT" >&2; exit 1; }

python3 - "$OUT" <<'PY'
import glob, os, re, sys
out = sys.argv[1]

def ko(msg):
    print("  \033[31m✗\033[0m " + msg, file=sys.stderr)
    sys.exit(1)

sources = sorted(glob.glob("web/js/[0-9][0-9]-*.js"))
if not sources:
    ko("aucune source web/js/NN-*.js")

# Commentaires et blancs autorises avant l'IIFE ; elle doit ouvrir la source et la fermer.
DEBUT = re.compile(r"\A(?:\s|//[^\n]*\n|/\*.*?\*/)*\(function\s*\(\s*\)\s*\{", re.S)
FIN = re.compile(r"\}\)\(\);?\s*\Z")

# Version : le fichier VERSION du depot, suivie du commit s'il y en a un (affichee dans Aide > A propos).
import subprocess
try: base = open("VERSION", encoding="utf-8").read().strip() or "dev"
except OSError: base = "dev"
try: sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=5).stdout.strip()
except Exception: sha = ""
version = base + ("+" + sha if sha else "")
parts = ["/* GENERE par scripts/build-web.sh — ne pas editer, voir web/js/ */\n",
         "try{ (window.RDConsole = window.RDConsole || {}).version = " + repr(version).replace("'", '"') + "; }catch(e){}\n"]
for f in sources:
    src = open(f, encoding="utf-8").read()
    if not DEBUT.search(src):
        ko(f + " : doit commencer par (function(){ — une IIFE, sans rien au premier niveau")
    if not FIN.search(src):
        ko(f + " : doit finir par })(); — une IIFE, sans rien apres")
    nom = os.path.basename(f)
    parts.append("try{\n" + src.rstrip() + "\n}catch(e){ try{ console.error(\"[console] "
                 + nom + " a leve :\", e); }catch(_){} }\n")
open(os.path.join(out, "rd-console.js"), "w", encoding="utf-8").write("".join(parts))

feuilles = sorted(glob.glob("web/css/*.css"))
open(os.path.join(out, "rd-console.css"), "w", encoding="utf-8").write(
    "".join(open(f, encoding="utf-8").read().rstrip() + "\n" for f in feuilles))
print("  ✓ rd-console.js (%d sources), rd-console.css (%d feuille(s))" % (len(sources), len(feuilles)))
PY

if command -v node >/dev/null 2>&1; then
  node -e 'const vm=require("vm"),fs=require("fs");const f=process.argv[1];try{new vm.Script(fs.readFileSync(f,"utf8"),{filename:f})}catch(e){console.error(String(e.stack).split("\n").slice(0,6).join("\n"));process.exit(1)}' "$OUT/rd-console.js" \
    || { printf '\033[31m  ✗ rd-console.js ne se parse pas comme un script classique\033[0m\n' >&2; exit 1; }
  echo "  ✓ rd-console.js se parse (script classique)"
else
  echo "  ⚠ node absent — syntaxe de rd-console.js non verifiee (la CI le fait)"
fi
