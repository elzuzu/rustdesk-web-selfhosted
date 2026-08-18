#!/usr/bin/env bash
# Diagnostic du relais RustDesk : pourquoi hbbr repond « invalid key ».
#
# Deux couches, et c'est la separation qui compte :
#
#   A. la SONDE (scripts/relay-probe.py) ne suppose rien du deploiement. Il lui
#      faut une URL et une cle, rien d'autre : ni Docker, ni acces au serveur,
#      ni navigateur, ni poste distant. C'est l'oracle.
#   B. les RELEVES LOCAUX expliquent le verdict. Chacun s'execute s'il le peut
#      et se tait sinon — aucun n'est requis, et le script reste utile sur une
#      machine qui ne voit pas le serveur du tout.
#
# La panne diagnostiquee ici est toujours la meme : la valeur de licence_key
# envoyee par le navigateur n'est pas celle que hbbr applique. hbbr compare par
# egalite stricte (relay_server.rs : « if !key.is_empty() && rf.licence_key !=
# key »), ne repond rien, et ferme. Cote client on ne voit qu'un 1006.
set -uo pipefail

# La racine se cherche, elle ne se suppose pas : dans le depot le script vit
# sous scripts/, mais un deploiement est un repertoire plat ou il est a cote du
# .env. Un « cd ../ » en dur a deja coute une session sur patch-assets.sh.
BASE=$(cd "$(dirname "$0")" && pwd)
if   [ -f "$BASE/.env" ]    || [ -d "$BASE/html" ];    then RACINE=$BASE
elif [ -f "$BASE/../.env" ] || [ -d "$BASE/../html" ]; then RACINE=$(cd "$BASE/.." && pwd)
else RACINE=$PWD; fi
cd "$RACINE"
SONDE="$BASE/relay-probe.py"

# ------------------------------------------------------------------ arguments
URL=""; CLE=""; REP_SERVEUR=""; CONF_PAIR=""; JSON=0; SONDE_SEULE=0; ATTENTE=3.0
MODE_IMPRIME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url)         URL=${2:-}; shift 2 ;;
    --key)         CLE=${2:-}; shift 2 ;;
    --server-dir)  REP_SERVEUR=${2:-}; shift 2 ;;
    --peer-config) CONF_PAIR=${2:-}; shift 2 ;;
    --timeout)     ATTENTE=${2:-}; shift 2 ;;
    --json)        JSON=1; shift ;;
    --probe-only)  SONDE_SEULE=1; shift ;;
    --print-key)     MODE_IMPRIME=cle; shift ;;
    --print-backend) MODE_IMPRIME=backend; shift ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      echo
      echo "Usage : $0 [--url wss://.../ws/relay] [--key CLE] [--server-dir CHEMIN]"
      echo "           [--peer-config RustDesk2.toml] [--timeout SECONDES]"
      echo "           [--json] [--probe-only] [--print-key] [--print-backend]"
      echo
      echo "  --print-key      imprime la clé effective du serveur local, puis sort"
      echo "  --print-backend  imprime l'hôte par lequel un conteneur joint hbbs ET hbbr"
      echo
      echo "Codes de sortie : 0 cle acceptee — 1 cle refusee — 2 intestable"
      exit 0 ;;
    *) echo "argument inconnu : $1" >&2; exit 2 ;;
  esac
done

[ -f "$SONDE" ] || { echo "sonde manquante : $SONDE" >&2; exit 2; }

# Le .env sert de valeurs par defaut, jamais d'autorite : c'est justement lui
# qu'on soupconne. Et il peut tres bien ne pas exister : un deploiement
# anterieur a setup.sh n'a que la page, ou la cle et le domaine sont cuits.
# On retombe donc sur la page, qui est de toute facon ce que le navigateur lit.
if [ -f .env ]; then set +u; . ./.env; set -u; fi
SOURCE_CLE=""
if [ -n "$CLE" ]; then SOURCE_CLE="--key"
elif [ -n "${RD_PUBLIC_KEY:-}" ]; then CLE=$RD_PUBLIC_KEY; SOURCE_CLE=".env"
elif [ -f html/index.html ]; then
  CLE=$(sed -n 's/.*var KEY="\([^"]*\)".*/\1/p' html/index.html | head -1)
  [ -n "$CLE" ] && SOURCE_CLE="html/index.html"
fi
if [ -z "$URL" ]; then
  D=${RD_DOMAIN:-}
  [ -n "$D" ] || [ ! -f html/index.html ] || \
    D=$(sed -n 's/.*var RD_HOST *= *"\([^"]*\)".*/\1/p' html/index.html | head -1)
  [ -n "$D" ] && URL="wss://$D/ws/relay"
fi

# Les modes --print-* n'ont besoin ni d'URL ni de cle : ils servent justement
# a les trouver, et setup.sh les appelle avant qu'un .env existe.
exiger_url_cle() {
  if [ -z "$URL" ]; then
    echo "Aucune URL : passe --url, ou lance depuis le dossier du déploiement." >&2
    exit 2
  fi
  if [ -z "$CLE" ]; then
    echo "Aucune clé : passe --key, ou lance depuis le dossier du déploiement." >&2
    exit 2
  fi
}

# ------------------------------------------------------------------- affichage
c_ok()   { printf '\033[32m%s\033[0m' "$*"; }
c_warn() { printf '\033[33m%s\033[0m' "$*"; }
c_err()  { printf '\033[31m%s\033[0m' "$*"; }
titre()  { [ "$JSON" = 1 ] || printf '\n\033[1m── %s\033[0m\n' "$*"; }

FAITS=$(mktemp); trap 'rm -f "$FAITS"' EXIT

# fait <rubrique> <statut ok|alerte|echec|info|absent> <valeur> <detail>
fait() {
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >> "$FAITS"
  [ "$JSON" = 1 ] && return 0
  local marque
  case "$2" in
    ok)     marque=$(c_ok   "  ✓") ;;
    alerte) marque=$(c_warn "  ⚠") ;;
    echec)  marque=$(c_err  "  ✗") ;;
    absent) marque="  ·" ;;
    *)      marque="  ─" ;;
  esac
  printf '%s %-34s %s\n' "$marque" "$1" "$4"
}

# Une cle publique est un secret (quiconque la detient peut utiliser le relais).
# On n'en affiche donc jamais la valeur entiere, seulement de quoi comparer.
resume_cle() {
  local k=${1:-}
  [ -n "$k" ] || { echo "(vide)"; return; }
  if [ ${#k} -le 16 ]; then echo "$k (${#k} car.)"
  else echo "${k:0:8}…${k: -6} (${#k} car.)"; fi
}

# ------------------------------------------------------- couche B : detection
docker_dispo() { command -v docker >/dev/null 2>&1 && timeout 10 docker info >/dev/null 2>&1; }

# On cherche le conteneur par sa COMMANDE autant que par son nom : rien
# n'oblige a nommer les conteneurs « hbbs » et « hbbr », et le nom est
# justement ce qu'un deploiement maison change en premier.
conteneur_de() {
  timeout 10 docker ps --no-trunc --format '{{.Names}}|{{.Command}}' 2>/dev/null \
    | awk -F'|' -v b="$1" 'index($2,b) || index($1,b) { print $1; exit }'
}

# La cle EFFECTIVE, celle que le processus applique vraiment — pas un fichier
# qu'on espere etre le bon. hbbs et hbbr la journalisent tous deux au demarrage
# (rendezvous_server.rs / relay_server.rs). On prend la DERNIERE : un conteneur
# redemarre a plusieurs demarrages dans le meme journal.
cle_annoncee_docker() {
  timeout 20 docker logs "$1" 2>&1 | sed -n 's/.*[[:space:]]Key:[[:space:]]*//p' | tr -d '\r' | tail -1
}
cle_annoncee_systemd() {
  command -v journalctl >/dev/null 2>&1 || return 1
  timeout 20 journalctl -u "$1" --no-pager -n 20000 2>/dev/null \
    | sed -n 's/.*[[:space:]]Key:[[:space:]]*//p' | tr -d '\r' | tail -1
}

pid_de()  { pgrep -x "$1" 2>/dev/null | head -1; }

# Sous network_mode: host, les processus du conteneur sont visibles depuis
# l'hote : pgrep les trouve, mais leur /proc/PID/cwd pointe dans le systeme de
# fichiers du CONTENEUR. Annoncer « processus natif » serait faux, et suivre ce
# chemin depuis l'hote menerait a un autre repertoire.
est_conteneurise() {
  [ -r "/proc/$1/cgroup" ] || return 1
  grep -qE 'docker|containerd|kubepods|libpod' "/proc/$1/cgroup" 2>/dev/null
}
cwd_de() {
  local pid=$1
  if [ -r "/proc/$pid/cwd" ]; then readlink -f "/proc/$pid/cwd" 2>/dev/null
  elif command -v lsof >/dev/null 2>&1; then
    lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
  fi
}

volume_racine_de() {
  timeout 10 docker inspect -f \
    '{{range .Mounts}}{{if eq .Destination "/root"}}{{.Source}}{{end}}{{end}}' "$1" 2>/dev/null
}

# La clef publique EST les 32 derniers octets de la privee (common.rs :
# « base64::encode(&tmp[SECRETKEYBYTES/2..]) »). C'est pour cela que le fichier
# .pub n'est jamais relu, et qu'il manque souvent tout simplement.
cle_depuis_fichier() {
  [ -r "$1" ] || return 1
  python3 - "$1" <<'PY'
import base64, sys
try:
    sk = base64.b64decode(open(sys.argv[1], "rb").read().strip(), validate=True)
except Exception:
    sys.exit(1)
if len(sk) != 64:
    sys.exit(1)
print(base64.b64encode(sk[32:]).decode())
PY
}

# ------------------------------------------------------------- modes courts
# La cle EFFECTIVE d'un serveur local, dans l'ordre de fiabilite : ce que le
# processus a annonce au demarrage, puis la derivation du fichier de cle. La
# saisie humaine n'apparait pas ici — c'est tout l'interet.
decouvrir_cle_serveur() {
  local ct k d
  if docker_dispo; then
    for b in hbbs hbbr; do
      ct=$(conteneur_de "$b") || true
      [ -n "${ct:-}" ] || continue
      k=$(cle_annoncee_docker "$ct")
      [ -n "$k" ] && { echo "$k"; return 0; }
    done
  fi
  for b in hbbs hbbr; do
    k=$(cle_annoncee_systemd "$b" 2>/dev/null) || true
    [ -n "${k:-}" ] && { echo "$k"; return 0; }
  done
  for d in ${REP_SERVEUR:-} "$HOME/rustdesk-server/data" ./data "$HOME/rustdesk/data"; do
    [ -n "$d" ] || continue
    k=$(cle_depuis_fichier "$d/id_ed25519") || continue
    [ -n "$k" ] && { echo "$k"; return 0; }
  done
  return 1
}

# Sonde de ports depuis un conteneur, pas depuis l'hote : c'est la vue du
# conteneur web qui compte, et elle differe de celle de l'hote sur macOS comme
# sous Colima. On reutilise le conteneur web s'il tourne deja, sinon une image
# nginx:alpine — celle-la meme dont le client web est construit, donc jamais
# une dependance nouvelle.
tester_backend() {
  local h=$1 ct
  ct=${CT_WEB:-}
  [ -n "$ct" ] || ct=$(conteneur_de rustdesk-web 2>/dev/null) || true
  if [ -n "${ct:-}" ]; then
    timeout 20 docker exec "$ct" sh -c \
      "nc -z -w2 $h 21118 >/dev/null 2>&1; a=\$?; nc -z -w2 $h 21119 >/dev/null 2>&1; b=\$?; echo \$a\$b"
  elif timeout 10 docker image inspect nginx:alpine >/dev/null 2>&1; then
    timeout 30 docker run --rm nginx:alpine sh -c \
      "nc -z -w2 $h 21118 >/dev/null 2>&1; a=\$?; nc -z -w2 $h 21119 >/dev/null 2>&1; b=\$?; echo \$a\$b"
  else
    echo "--"
  fi
}

# Les candidats par lesquels un conteneur peut joindre hbbs/hbbr. On les
# ESSAIE au lieu de les deviner d'apres la plateforme, et on exige les DEUX
# ports : 21118 seul laisse /ws/id marcher pendant que /ws/relay echoue.
candidats_backend() {
  local ip=""
  if docker_dispo && [ -n "$(conteneur_de hbbs)" ]; then
    ip=$(timeout 10 docker inspect -f \
      '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$(conteneur_de hbbs)" 2>/dev/null)
  fi
  echo "${RD_BACKEND_HOST:-} 172.17.0.1 host.docker.internal host.lima.internal $ip 127.0.0.1"
}

detecter_backend() {
  local h vus=""
  for h in $(candidats_backend); do
    [ -n "$h" ] || continue
    case " $vus " in *" $h "*) continue ;; esac
    vus="$vus $h"
    [ "$(tester_backend "$h")" = "00" ] && { echo "$h"; return 0; }
  done
  return 1
}

case "$MODE_IMPRIME" in
  cle)     decouvrir_cle_serveur; exit $? ;;
  backend) detecter_backend;      exit $? ;;
esac

# --------------------------------------------------------------- couche A seule
lancer_sonde() { python3 "$SONDE" "$1" "$2" "$ATTENTE"; }

if [ "$SONDE_SEULE" = 1 ]; then
  exiger_url_cle
  lancer_sonde "$URL" "$CLE"; exit $?
fi

exiger_url_cle

[ "$JSON" = 1 ] || printf '\n\033[1mDiagnostic du relais RustDesk\033[0m — %s\n' "$URL"

# ============================================================ 1. le serveur
titre "Où tourne le serveur"

CLE_HBBS=""; CLE_HBBR=""; SOURCE_HBBS=""; SOURCE_HBBR=""
CT_HBBS=""; CT_HBBR=""; CT_WEB=""

if docker_dispo; then
  CT_HBBS=$(conteneur_de hbbs); CT_HBBR=$(conteneur_de hbbr)
  CT_WEB=$(conteneur_de rustdesk-web)
  if [ -n "$CT_HBBS" ] || [ -n "$CT_HBBR" ]; then
    fait "conteneurs" info "$CT_HBBS,$CT_HBBR" \
         "hbbs → ${CT_HBBS:-introuvable}   hbbr → ${CT_HBBR:-introuvable}"
  fi
  [ -n "$CT_HBBS" ] && { CLE_HBBS=$(cle_annoncee_docker "$CT_HBBS"); SOURCE_HBBS="docker logs $CT_HBBS"; }
  [ -n "$CT_HBBR" ] && { CLE_HBBR=$(cle_annoncee_docker "$CT_HBBR"); SOURCE_HBBR="docker logs $CT_HBBR"; }
fi

# Natif : le fichier de cle est cherche dans le REPERTOIRE DE TRAVAIL du
# processus, pas a un chemin fixe. Deux lancements depuis deux dossiers
# differents, et les deux services ont deux cles — sans un mot dans les
# journaux. C'est la cause n° 1, et elle n'a rien de propre a Docker.
CWD_HBBS=""; CWD_HBBR=""
for b in hbbs hbbr; do
  p=$(pid_de "$b") || true
  [ -n "${p:-}" ] || continue
  d=$(cwd_de "$p")
  if est_conteneurise "$p"; then
    fait "processus $b" info "$p|conteneur" "pid $p, dans un conteneur — cwd « $d » est celui du conteneur"
    continue
  fi
  if [ "$b" = hbbs ]; then CWD_HBBS=$d; deja=$CLE_HBBS; else CWD_HBBR=$d; deja=$CLE_HBBR; fi
  fait "processus natif $b" info "$p|$d" "pid $p, répertoire de travail ${d:-inconnu}"
  [ -n "$deja" ] && continue
  k=$(cle_annoncee_systemd "$b") || true
  if [ -n "${k:-}" ]; then
    if [ "$b" = hbbs ]; then CLE_HBBS=$k; SOURCE_HBBS="journalctl -u hbbs"
    else CLE_HBBR=$k; SOURCE_HBBR="journalctl -u hbbr"; fi
  fi
done

if [ -z "$CT_HBBS$CT_HBBR$CWD_HBBS$CWD_HBBR" ]; then
  fait "serveur local" absent "" "aucun hbbs/hbbr sur cette machine — seule la sonde parlera"
fi

# ============================================ 2. les deux clés effectives
titre "Les deux clés effectives (la cause n° 1)"

if [ -n "$CLE_HBBS" ] || [ -n "$CLE_HBBR" ]; then
  fait "clé annoncée par hbbs" \
       "$([ -n "$CLE_HBBS" ] && echo info || echo absent)" "$CLE_HBBS" \
       "$(resume_cle "$CLE_HBBS")   [${SOURCE_HBBS:-non relevée}]"
  fait "clé annoncée par hbbr" \
       "$([ -n "$CLE_HBBR" ] && echo info || echo absent)" "$CLE_HBBR" \
       "$(resume_cle "$CLE_HBBR")   [${SOURCE_HBBR:-non relevée}]"
  if [ -n "$CLE_HBBS" ] && [ -n "$CLE_HBBR" ]; then
    if [ "$CLE_HBBS" = "$CLE_HBBR" ]; then
      fait "hbbs et hbbr s'accordent" ok "$CLE_HBBS" "même clé des deux côtés"
    else
      fait "hbbs et hbbr DIVERGENT" echec "" \
           "chacun a généré sa propre paire : ils ne partagent pas leur répertoire de clés"
    fi
  fi
else
  fait "clés effectives" absent "" "journaux illisibles d'ici — la sonde reste l'oracle"
fi

# ================================================ 3. dérivation du fichier
titre "Dérivation depuis id_ed25519"

CANDIDATS=""
[ -n "$REP_SERVEUR" ] && CANDIDATS="$REP_SERVEUR"
[ -n "$CT_HBBS" ] && CANDIDATS="$CANDIDATS $(volume_racine_de "$CT_HBBS")"
[ -n "$CT_HBBR" ] && CANDIDATS="$CANDIDATS $(volume_racine_de "$CT_HBBR")"
CANDIDATS="$CANDIDATS $CWD_HBBS $CWD_HBBR $HOME/rustdesk-server/data ./data"

TROUVE=0
VUS=""
for d in $CANDIDATS; do
  [ -n "$d" ] || continue
  case " $VUS " in *" $d "*) continue ;; esac
  VUS="$VUS $d"
  f="$d/id_ed25519"
  [ -r "$f" ] || continue
  k=$(cle_depuis_fichier "$f") || { fait "$f" alerte "" "illisible ou pas une clé de 64 octets"; continue; }
  TROUVE=1
  fait "dérivée de $f" info "$k" "$(resume_cle "$k")"
  [ -n "$CLE_HBBS" ] && [ "$k" != "$CLE_HBBS" ] && \
    fait "fichier ≠ clé appliquée par hbbs" alerte "" \
         "hbbs a été démarré avec une autre clé — redémarrage nécessaire ?"
done
[ "$TROUVE" = 1 ] || fait "id_ed25519" absent "" \
  "introuvable d'ici (essaie --server-dir CHEMIN) — non bloquant"

# ============================================ 4. les clés côté client web
titre "Ce que le client web enverra"

fait "clé testée" info "$CLE" "$(resume_cle "$CLE")   [source : ${SOURCE_CLE:-inconnue}]"

if [ -f html/index.html ] && [ "$SOURCE_CLE" != "html/index.html" ]; then
  CLE_PAGE=$(sed -n 's/.*var KEY="\([^"]*\)".*/\1/p' html/index.html | head -1)
  if [ "$CLE_PAGE" = "$CLE" ]; then
    fait "clé cuite dans html/index.html" ok "$CLE_PAGE" "identique à .env"
  else
    fait "clé cuite dans html/index.html" echec "$CLE_PAGE" \
         "$(resume_cle "$CLE_PAGE") — diffère de .env : régénère la page"
  fi
fi

# Le piege de la prod « a deux vitesses » : la config est cuite dans l'image,
# sans volume monte. Un html/index.html corrige sur le disque ne change RIEN au
# service tant qu'il n'y a pas eu de reconstruction — et se deploiera tout seul
# a la prochaine.
if [ -n "$CT_WEB" ]; then
  CLE_SERVIE=$(timeout 10 docker exec "$CT_WEB" \
      sed -n 's/.*var KEY="\([^"]*\)".*/\1/p' /usr/share/nginx/html/index.html 2>/dev/null | head -1)
  if [ -z "$CLE_SERVIE" ]; then
    fait "clé réellement servie" alerte "" "illisible dans $CT_WEB"
  elif [ "$CLE_SERVIE" = "$CLE" ]; then
    fait "clé réellement servie" ok "$CLE_SERVIE" "conforme — pas de prod à deux vitesses"
  else
    fait "clé réellement servie" echec "$CLE_SERVIE" \
         "$(resume_cle "$CLE_SERVIE") — l'image sert autre chose que le disque : reconstruis"
  fi
fi

if [ -n "$CLE_HBBR" ] && [ -n "$CLE" ] && [ "$CLE" != "$CLE_HBBR" ]; then
  fait "clé configurée ≠ clé de hbbr" echec "" "c'est exactement ce que hbbr rejette"
fi

# ================================================== 5. le pair contrôlé
titre "Le pair contrôlé (l'autre jambe du relais)"

# Un relais a DEUX jambes, et elles s'authentifient separement : le navigateur
# d'un cote, le poste controle de l'autre. Si c'est la cle du POSTE qui ne
# correspond pas, la liaison du navigateur ne tombe pas en moins d'une
# seconde — elle vit une trentaine de secondes puis meurt faute de pair. Les
# deux pannes se ressemblent a l'ecran et n'ont pas la meme cause.
lire_option_pair() {  # $1 = fichier, $2 = option
  ( sudo -n cat "$1" 2>/dev/null || cat "$1" 2>/dev/null ) \
    | sed -n "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*'\([^']*\)'.*/\1/p" | head -1
}

CONFS_PAIR="$CONF_PAIR"
# Sur macOS, le demon root fait autorite : il ecrase la config utilisateur a
# chaque lancement de l'interface. Le lire en premier.
CONFS_PAIR="$CONFS_PAIR /var/root/Library/Preferences/com.carriez.RustDesk/RustDesk2.toml"
CONFS_PAIR="$CONFS_PAIR $HOME/Library/Preferences/com.carriez.RustDesk/RustDesk2.toml"
CONFS_PAIR="$CONFS_PAIR /root/.config/rustdesk/RustDesk2.toml"
CONFS_PAIR="$CONFS_PAIR $HOME/.config/rustdesk/RustDesk2.toml"

VU_PAIR=0; CLES_PAIR=""
for f in $CONFS_PAIR; do
  [ -n "$f" ] || continue
  k=$(lire_option_pair "$f" key)
  [ -n "$k" ] || continue
  VU_PAIR=1
  CLES_PAIR="$CLES_PAIR $k"
  serveur=$(lire_option_pair "$f" custom-rendezvous-server)
  fait "config du pair" info "$f|$k" \
       "$(resume_cle "$k")   vers « ${serveur:-non défini} »   [$f]"
  REF=${CLE_HBBR:-$CLE}
  if [ -n "$REF" ] && [ "$k" != "$REF" ]; then
    fait "clé du pair ≠ clé du relais" echec "" \
         "ce poste sera rejeté par hbbr : la session mourra vers 30 s, pas tout de suite"
  fi
done
if [ "$VU_PAIR" = 0 ]; then
  fait "config du pair" absent "" \
    "aucun RustDesk2.toml lisible ici — normal si le poste contrôlé est ailleurs (--peer-config)"
else
  # Deux fichiers qui divergent, c'est le piege des couches de config macOS :
  # le demon root gagne, et editer la config utilisateur ne sert a rien.
  distinctes=$(printf '%s\n' $CLES_PAIR | sort -u | wc -l | tr -d ' ')
  [ "$distinctes" -gt 1 ] && fait "configs du pair divergentes" alerte "" \
    "le démon root fait autorité et écrase la config utilisateur à chaque lancement"
fi

# ======================================== 6. joignabilité de hbbs ET hbbr
titre "Joignabilité depuis le conteneur web"

# Retenir un backend qui ouvre 21118 mais pas 21119, c'est precisement le
# defaut qui laisse /ws/id marcher pendant que /ws/relay echoue.
#
# Attention en lisant le resultat : le port 21118 n'identifie pas hbbs. Le
# CLIENT RustDesk ecoute lui aussi sur 21118 pour ses liaisons directes en
# reseau local — verifie sur ce Mac : « RustDesk … TCP *:21118 (LISTEN) »,
# sans le moindre hbbs installe. Sur une machine qui heberge le serveur ET
# fait tourner le client, 21118 est donc ambigu ; 21119 ne l'est pas.
if docker_dispo; then
  for h in "${RD_BACKEND_HOST:-}" 172.17.0.1 host.docker.internal host.lima.internal 127.0.0.1; do
    [ -n "$h" ] || continue
    case " ${DEJA:-} " in *" $h "*) continue ;; esac
    DEJA="${DEJA:-} $h"
    r=$(tester_backend "$h")
    case "$r" in
      00) fait "$h" ok "$h" "21118 et 21119 ouverts" ;;
      01) fait "$h" echec "$h" \
            "21118 ouvert, 21119 FERMÉ — hbbr injoignable : /ws/id marchera, /ws/relay non" ;;
      10) fait "$h" alerte "$h" "21119 ouvert, 21118 fermé — hbbr seul" ;;
      11) fait "$h" absent "$h" "aucun des deux ports" ;;
      --) fait "sonde de ports" absent "" "ni conteneur web ni image nginx:alpine locale"; break ;;
      *)  fait "$h" absent "$h" "résultat illisible ($r)" ;;
    esac
  done
else
  fait "sonde de ports" absent "" "Docker indisponible ici"
fi

# ================================================== 7. la sonde : l'oracle
titre "Sonde d'authentification (l'oracle)"

# Ecrit le verdict dans la variable nommee : « fait » ecrit deja le tableau
# sur la sortie standard, une substitution de commande l'avalerait.
sortie_sonde() {  # $1 = variable, $2 = libelle, $3 = cle, $4 = statut attendu
  local ligne verdict ms detail statut
  ligne=$(lancer_sonde "$URL" "$3") || true
  verdict=$(printf '%s' "$ligne" | cut -f1)
  ms=$(printf '%s' "$ligne" | cut -f2)
  detail=$(printf '%s' "$ligne" | cut -f3)
  if [ "$verdict" = "$4" ]; then statut=ok
  elif [ "$verdict" = INTESTABLE ]; then statut=alerte
  else statut=echec; fi
  fait "$2" "$statut" "$verdict" "$verdict en ${ms} ms — $detail"
  eval "$1=\$verdict"
}

sortie_sonde V_CONFIG "clé configurée"      "$CLE" ACCEPTEE
sortie_sonde V_TEMOIN "clé témoin (fausse)" "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" REFUSEE
sortie_sonde V_VIDE   "clé vide"            ""     REFUSEE

# ======================================================= verdict et sortie
CODE=0
if [ "$V_CONFIG" = ACCEPTEE ]; then
  # Le temoin valide la sonde elle-meme : s'il passe aussi, ce n'est pas hbbr
  # qui repond, ou il tourne sans -k _ — donc en relais ouvert.
  if [ "$V_TEMOIN" = ACCEPTEE ]; then
    VERDICT="hbbr accepte AUSSI une clé fausse : il tourne sans -k _ — relais ouvert à Internet."
    CODE=1
  else
    VERDICT="La clé configurée est acceptée par hbbr. Si une session échoue encore, ce n'est pas la clé."
  fi
elif [ "$V_CONFIG" = REFUSEE ]; then
  VERDICT="hbbr REFUSE la clé configurée. Compare les deux clés effectives ci-dessus ; si elles divergent, hbbs et hbbr ne partagent pas leur répertoire de clés."
  CODE=1
else
  VERDICT="Intestable : la liaison n'a pas atteint hbbr. Vérifie l'URL, le proxy et la joignabilité de 21119."
  CODE=2
fi
fait "verdict" "$([ "$CODE" = 0 ] && echo ok || echo echec)" "$CODE" "$VERDICT"

if [ "$JSON" = 1 ]; then
  python3 - "$FAITS" "$CODE" "$URL" <<'PY'
import json, sys
faits = []
for ligne in open(sys.argv[1], encoding="utf-8"):
    r, s, v, d = (ligne.rstrip("\n").split("\t") + ["", "", "", ""])[:4]
    faits.append({"rubrique": r, "statut": s, "valeur": v, "detail": d})
print(json.dumps({"url": sys.argv[3], "code": int(sys.argv[2]), "faits": faits},
                 ensure_ascii=False, indent=2))
PY
else
  printf '\n'
  [ "$CODE" = 0 ] && c_ok "  $VERDICT" || c_err "  $VERDICT"
  printf '\n\n'
fi
exit "$CODE"
