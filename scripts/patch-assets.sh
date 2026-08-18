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

# 5) Exposer le decodeur zstd du bundle.
#    Les blocs de fichiers descendants arrivent compresses : le pair applique
#    zstd a tout ce dont l'extension n'est pas deja compressee (hbb_common
#    fs.rs, TransferJob::read). Le bundle embarque deja un decodeur wasm,
#    utilise pour le presse-papier compresse, mais il reste au perimetre du
#    module. On l'expose plutot que d'embarquer un second decodeur.
#    S3 est une declaration de fonction : elle est hissee, donc l'affectation
#    placee avant elle capture bien la fonction a l'evaluation du module.
old='async function S3(u){const e=1024*1024*64'
assert s.count(old)==1, "patch 5 : motif absent"
s=s.replace(old,'window.__rdUnzstd=(u)=>S3(u);'+old); n+=1

# --- Pre-condition d'ecriture : le format de fil d'authentification est intact --
#
# La verification precede l'ecriture, et c'est le point important : un
# artefact refuse ne doit jamais atteindre le disque. Sinon il reste en place
# apres l'echec, et la prochaine construction le recuit dans l'image — ce qui
# est exactement ce qui s'est produit.
#
# Ceci n'est pas de la prudence de principe. Un correctif ajoute ici a deja
# permute les tags protobuf de RequestRelay sur la foi d'une lecture erronee
# de la spec. Le commit a ete annule 41 minutes plus tard — mais l'artefact
# deja produit, lui, est reste en service et a ete recuit dans l'image a
# chaque reconstruction. Resultat : hbbs acceptait (son PunchHoleRequest
# n'etait pas touche) et hbbr repondait « invalid key », parce qu'il lisait
# la cle a la place de l'uuid et trouvait licence_key vide. Deux heures de
# panne, et un diagnostic qui portait sur le depot pendant que la production
# servait autre chose.
#
# Les deux serveurs authentifient sur ces champs precis. Le schema fait
# autorite est hbb_common/protos/rendezvous.proto :
#     RequestRelay     { id=1, uuid=2, socket_addr=3, relay_server=4,
#                        secure=5, licence_key=6, conn_type=7, token=8 }
#     PunchHoleRequest { id=1, nat_type=2, licence_key=3, conn_type=4, token=5 }
# En protobuf, l'octet de tag vaut (numero << 3 | 2) pour une chaine.
import re
def tags(ancre):
    i = s.find(ancre)
    assert i >= 0, f"ancre introuvable : {ancre}"
    j = s.find("encode(", i)
    return {champ: int(t) >> 3
            for t, champ in re.findall(r'uint32\((\d+)\)\.\w+\(u\.(\w+)\)', s[j:j+300])}

rr = tags('id:"",uuid:"",socket_addr')
ph = tags('id:"",nat_type:0,licence_key')
attendu = [("RequestRelay.uuid",           rr.get("uuid"),        2),
           ("RequestRelay.socket_addr",    rr.get("socket_addr"), 3),
           ("PunchHoleRequest.licence_key", ph.get("licence_key"), 3)]
for nom, vu, exige in attendu:
    if vu != exige:
        raise SystemExit(
            f"  ✗ {nom} encode en tag {vu}, attendu {exige}.\n"
            f"    Un correctif a deplace un champ d'authentification : hbbr\n"
            f"    rejettera toute session relayee avec « invalid key ».\n"
            f"    Rien n'a ete ecrit : html/js/dist/index.js est inchange.")

open(D+"/index.js","w",encoding="utf-8").write(s)
print(f"  {n} correctifs appliques")
print("  ✓ tags d'authentification conformes (uuid=2, licence_key=6, punch_hole licence_key=3)")
PY

# Les workers sont charges en relatif depuis /js/dist/, pas depuis la racine.
for f in libopus.js libopus.wasm yuv.js yuv.wasm; do
  [ -f "$D/../../$f" ] && cp -f "$D/../../$f" "$D/"
done
echo "  workers copies dans js/dist/"
