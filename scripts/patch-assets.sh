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

# 5) Alignement des tags Protobuf RequestRelay avec RustDesk Server (hbbr).
#    Le client V1 encodait licence_key en tag 6 (uint32(50)) et uuid en tag 2 (uint32(18)).
#    hbbr lisait le tag 2 comme licence_key (recevant la chaine UUID) et rejetait la connexion avec "invalid key".
old_enc = 'u.id!==""&&e.uint32(10).string(u.id),u.uuid!==""&&e.uint32(18).string(u.uuid),u.socket_addr.length!==0&&e.uint32(26).bytes(u.socket_addr),u.relay_server!==""&&e.uint32(34).string(u.relay_server),u.secure===!0&&e.uint32(40).bool(u.secure),u.licence_key!==""&&e.uint32(50).string(u.licence_key)'
new_enc = 'u.id!==""&&e.uint32(10).string(u.id),u.licence_key!==""&&e.uint32(18).string(u.licence_key),u.uuid!==""&&e.uint32(26).string(u.uuid),u.socket_addr.length!==0&&e.uint32(34).bytes(u.socket_addr),u.relay_server!==""&&e.uint32(42).string(u.relay_server),u.secure===!0&&e.uint32(48).bool(u.secure)'
assert s.count(old_enc) == 1, "patch 5 enc : motif absent"
s = s.replace(old_enc, new_enc); n += 1

old_dec = 'case 1:t.id=i.string();break;case 2:t.uuid=i.string();break;case 3:t.socket_addr=i.bytes();break;case 4:t.relay_server=i.string();break;case 5:t.secure=i.bool();break;case 6:t.licence_key=i.string();break;'
new_dec = 'case 1:t.id=i.string();break;case 2:t.licence_key=i.string();break;case 3:t.uuid=i.string();break;case 4:t.socket_addr=i.bytes();break;case 5:t.relay_server=i.string();break;case 6:t.secure=i.bool();break;'
assert s.count(old_dec) == 1, "patch 5 dec : motif absent"
s = s.replace(old_dec, new_dec); n += 1

open(D+"/index.js","w",encoding="utf-8").write(s)
print(f"  {n} correctifs appliques")
PY

# Les workers sont charges en relatif depuis /js/dist/, pas depuis la racine.
for f in libopus.js libopus.wasm yuv.js yuv.wasm; do
  [ -f "$D/../../$f" ] && cp -f "$D/../../$f" "$D/"
done
echo "  workers copies dans js/dist/"
