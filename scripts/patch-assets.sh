#!/bin/bash
# Reapplique les correctifs au bundle du client web RustDesk.
# Entree : ../html/js/dist/index.js.orig (racine du depot) (bundle intact, extrait de l'image
#          pmietlicki/rustdesk-web-client@sha256:da957e62f4c95179107632b7386735aec35c3ba10976bdb3ac00b747e496a2e6)
# Sortie : html/js/dist/index.js (corrige)
# Idempotent : peut etre relance sans risque.
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)/html/js/dist"
[ -f "$D/index.js.orig" ] || { echo "index.js.orig manquant"; exit 1; }

python3 - "$D" <<'PY'
import sys, re
D=sys.argv[1]
s=open(D+"/index.js.orig",encoding="utf-8").read()
n=0

# 1) Routage WebSocket vers la meme origine.
#    Le fork vise wss://<hote>:21118 et :21119, des ports que Cloudflare ne
#    proxifie pas. On route par chemin sur l'origine servie.
old='else u+=":"+(zi+(e?3:2));return Pi+u}'
assert s.count(old)==1, "patch 1 : motif absent"
s=s.replace(old,'else u+=":"+(zi+(e?3:2));return (location.protocol==="https:"?"wss://":"ws://")+location.host+(e?"/ws/relay":"/ws/id")}'); n+=1

# 2) Cas get_conn_status manquant dans le pont.
#    Le Dart appelle getByName("get_conn_status") ; sans ce cas le pont renvoie
#    "" et JSON.decode("") leve une exception a chaque sondage.
old='function Ki(u,e){switch(u){'
assert s.count(old)==1, "patch 2 : motif absent"
s=s.replace(old,'function Ki(u,e){switch(u){case"get_conn_status":return {status_num:1,key_confirmed:!0,id:localStorage.getItem("id")||""};'); n+=1

# 3) getByName : ne jamais lever, conserver le comportement null -> "".
old='window.getByName=(u,e)=>{let i=Ki(u,e);return typeof i=="string"||i instanceof String?i:i==null||i==null?"":JSON.stringify(i)};'
assert s.count(old)==1, "patch 3 : motif absent"
s=s.replace(old,'window.getByName=(u,e)=>{let i;try{i=Ki(u,e)}catch(x){console.warn("[pont-erreur]",u,e,x);return""}return typeof i=="string"||i instanceof String?i:i==null?"":JSON.stringify(i)};'); n+=1

# 4) Garde-fou de version du pair.
#    hbbs 1.1.15 ne renseigne pas RelayResponse.version ; le client refusait
#    alors la session. Le champ n'est utilise nulle part ailleurs.
m=re.search(r'if\(!([A-Za-z0-9_$]+)\.version\)\{[^}]*?Remote version is low[^}]*?\}', s)
assert m, "patch 4 : motif absent"
s=s[:m.start()]+'if(!1){}'+s[m.end():]; n+=1

open(D+"/index.js","w",encoding="utf-8").write(s)
print(f"  {n} correctifs appliques")
PY

# Les workers sont charges en relatif depuis /js/dist/, pas depuis la racine.
for f in libopus.js libopus.wasm yuv.js yuv.wasm; do
  [ -f "$D/../../$f" ] && cp -f "$D/../../$f" "$D/"
done
echo "  workers copies dans js/dist/"
