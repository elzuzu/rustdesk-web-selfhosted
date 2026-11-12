#!/usr/bin/env bash
# Assistant de configuration du client web RustDesk auto-hébergé.
# Génère la configuration à partir des gabarits, puis construit et démarre.
# Relançable sans danger : les réponses précédentes servent de valeurs par défaut.
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=".env"
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT

c_ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
c_warn() { printf '\033[33m%s\033[0m\n' "$*"; }
c_err()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }
titre()  { printf '\n\033[1m── %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- prérequis
titre "Prérequis"
manque=0
for c in docker curl openssl python3 tar; do
  if command -v "$c" >/dev/null 2>&1; then echo "  ✓ $c"
  else c_err "  ✗ $c manquant"; manque=1; fi
done
if docker compose version >/dev/null 2>&1; then echo "  ✓ docker compose"
else c_err "  ✗ docker compose (plugin v2) manquant"; manque=1; fi
if docker info >/dev/null 2>&1; then echo "  ✓ accès au démon Docker"
else c_err "  ✗ démon Docker injoignable (droits ? service arrêté ?)"; manque=1; fi
[ "$manque" -eq 0 ] || { c_err "Installe les éléments manquants puis relance."; exit 1; }

# ------------------------------------------------------------------ saisie
if [ -f "$ENV_FILE" ]; then
  c_warn "Configuration existante détectée, elle sert de valeurs par défaut."
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi
ANCIEN_MDP=${RD_WEB_PASSWORD:-}

demander() {                       # demander VAR "question" "défaut" [secret]
  local var=$1 q=$2 def=${3:-} secret=${4:-} cur rep
  cur=$(eval "printf '%s' \"\${$var:-}\"")
  [ -n "$cur" ] && def=$cur
  if [ "$secret" = "secret" ]; then
    if [ -n "$def" ]; then printf '  %s [inchangé] : ' "$q"; else printf '  %s : ' "$q"; fi
    read -rs rep; echo
  else
    if [ -n "$def" ]; then printf '  %s [%s] : ' "$q" "$def"; else printf '  %s : ' "$q"; fi
    read -r rep
  fi
  [ -z "$rep" ] && rep=$def
  eval "$var=\$rep"
}

# sites_de DOMAINE "alias1, alias2" -> « domaine, alias1, alias2 » : la liste d'adresses de site de Caddy.
# Virgules ou espaces ; un nom mal forme est refuse (il irait tel quel dans le Caddyfile), le domaine n'est pas repete.
sites_de() {
  local sites=$1 a noms=()
  # « read » ne lit qu'UNE ligne : une valeur sur plusieurs lignes (un .env retouche a la main) serait tronquee en silence.
  case "${2:-}" in *$'\n'*) echo "nom invalide : saut de ligne dans la liste" >&2; return 1 ;; esac
  IFS=', ' read -ra noms <<< "${2:-}" || true
  for a in ${noms[@]+"${noms[@]}"}; do
    [ -n "$a" ] || continue
    printf '%s' "$a" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$' || { echo "nom invalide : $a" >&2; return 1; }
    [ "$a" = "$1" ] || sites="$sites, $a"
  done
  printf '%s' "$sites"
}

titre "Domaine et accès"
demander RD_DOMAIN "Nom de domaine du client web (ex. rustdesk.exemple.org)"
[ -n "${RD_DOMAIN:-}" ] || { c_err "Le domaine est obligatoire."; exit 1; }
demander RD_WEB_USER "Identifiant d'accès à la page" "admin"
demander RD_WEB_PASSWORD "Mot de passe d'accès à la page" "" secret
[ -n "${RD_WEB_PASSWORD:-}" ] || { c_err "Le mot de passe est obligatoire."; exit 1; }
if [ ${#RD_WEB_PASSWORD} -lt 12 ]; then
  c_warn "  ⚠ mot de passe court : cette page est exposée à Internet, vise 16+ caractères."
fi

titre "Serveur RustDesk (hbbs / hbbr)"

# Le moyen de joindre hbbs/hbbr depuis un conteneur dépend de la plateforme, et
# le deviner ne suffit pas : on ESSAIE. Un candidat n'est retenu que s'il ouvre
# 21118 ET 21119. N'exiger que 21118 est précisément le défaut qui laisse
# /ws/id fonctionner pendant que /ws/relay échoue — et 21118 ne prouve même pas
# la présence de hbbs, le client RustDesk écoute lui aussi dessus.
DEF_BACKEND="172.17.0.1"
MOTEUR=$(docker info --format '{{.OperatingSystem}}' 2>/dev/null || echo "")
case "$(uname -s)$MOTEUR" in
  Darwin*|*"Docker Desktop"*|*OrbStack*|*"Rancher Desktop"*)
    DEF_BACKEND="host.docker.internal" ;;
esac
echo "  Recherche de l'hôte joignable depuis un conteneur…"
if TROUVE=$(./scripts/relay-doctor.sh --print-backend 2>/dev/null) && [ -n "$TROUVE" ]; then
  c_ok "  ✓ $TROUVE — 21118 et 21119 ouverts"
  DEF_BACKEND=$TROUVE
else
  c_warn "  ⚠ aucun candidat n'ouvre les deux ports. hbbs et hbbr tournent-ils ?"
  echo "    • Linux, hbbs/hbbr en network_mode host  → 172.17.0.1"
  echo "    • macOS ou Windows                       → host.docker.internal"
  echo "    • serveur RustDesk sur une autre machine → son nom ou son IP"
fi
demander RD_BACKEND_HOST "Hôte du serveur RustDesk" "$DEF_BACKEND"

# La clé se relève, elle ne se retape pas. La transcription humaine est la
# deuxième cause de « invalid key » — et la première instruction que nous
# donnions pour l'éviter, « docker exec hbbs cat /root/id_ed25519.pub », ne
# peut pas fonctionner : l'image du serveur n'a ni shell ni cat, et le fichier
# .pub n'est jamais relu par hbbs, donc il manque le plus souvent. La bonne
# source est ce que le processus annonce au démarrage.
CLE_RELEVEE=$(./scripts/relay-doctor.sh --print-key 2>/dev/null || true)
if [ -n "$CLE_RELEVEE" ]; then
  c_ok "  ✓ clé relevée sur le serveur : ${CLE_RELEVEE:0:8}…${CLE_RELEVEE: -6}"
  if [ -n "${RD_PUBLIC_KEY:-}" ] && [ "$RD_PUBLIC_KEY" != "$CLE_RELEVEE" ]; then
    c_warn "  ⚠ ta configuration actuelle porte une AUTRE clé."
    c_warn "    C'est exactement ce que hbbr rejette. On prend celle du serveur."
  fi
  RD_PUBLIC_KEY=$CLE_RELEVEE
else
  echo "  Aucun hbbs/hbbr joignable d'ici. Relève la clé sur le serveur avec :"
  echo "    docker logs hbbs 2>&1 | grep 'Key:'          (Docker)"
  echo "    journalctl -u hbbs | grep 'Key:'             (systemd)"
fi
demander RD_PUBLIC_KEY "Clé publique du serveur"
[ -n "${RD_PUBLIC_KEY:-}" ] || { c_err "La clé publique est obligatoire."; exit 1; }

# Une clé erronée ne se voit qu'au premier essai de connexion : hbbr ferme la
# liaison sans rien dire au client, et ne journalise qu'un « invalid key » de
# son côté. On refuse donc ici, au lieu d'avertir : un avertissement jaune se
# survole, et la panne réapparaît des semaines plus tard sous forme d'écran noir.
RD_PUBLIC_KEY=$(printf '%s' "$RD_PUBLIC_KEY" | tr -d '[:space:]')
case "$RD_PUBLIC_KEY" in
  *"BEGIN "*|*"PRIVATE"*)
    c_err "  ✗ ceci ressemble à une clé PRIVÉE au format PEM."; exit 1 ;;
esac

# Une clé privée RustDesk est du base64 nu : ni BEGIN, ni PRIVATE, rien qui la
# distingue à l'œil d'une clé publique. Mais elle fait 64 octets et sa moitié
# haute EST la clé publique (common.rs : base64::encode(&tmp[SECRETKEYBYTES/2..])).
# On peut donc la reconnaître à coup sûr, et rendre la bonne valeur.
DERIVEE=$(printf '%s' "$RD_PUBLIC_KEY" | python3 -c '
import base64, sys
try:
    sk = base64.b64decode(sys.stdin.read().strip(), validate=True)
except Exception:
    sys.exit(1)
if len(sk) != 64:
    sys.exit(1)
print(base64.b64encode(sk[32:]).decode())
' 2>/dev/null || true)
if [ -n "$DERIVEE" ]; then
  c_err "  ✗ c'est la clé PRIVÉE (64 octets) : id_ed25519, pas la clé publique."
  c_warn "    La publique correspondante est : $DERIVEE"
  demander REPONSE "L'utiliser à la place ? (o/n)" "o"
  case "$REPONSE" in
    o|O|oui|y|Y|yes) RD_PUBLIC_KEY=$DERIVEE; c_ok "  ✓ clé publique retenue" ;;
    *) c_err "Corrige la clé puis relance."; exit 1 ;;
  esac
fi

if ! printf '%s' "$RD_PUBLIC_KEY" | grep -Eq '^[A-Za-z0-9+/]{43}=$'; then
  c_err "  ✗ ce n'est pas une clé publique RustDesk : 44 caractères base64"
  c_err "    terminés par « = » (32 octets Ed25519). Reçu : ${#RD_PUBLIC_KEY} caractères."
  c_err "    hbbr rejetterait toutes les sessions relayées. Relève-la avec :"
  c_err "      docker logs hbbs 2>&1 | grep 'Key:'"
  exit 1
fi
demander RD_DEFAULT_PEER_ID "ID du poste distant à préremplir (facultatif)" ""

titre "TLS"
echo "  1) Caddy sur le port 443, certificat Let's Encrypt automatique (TLS-ALPN-01)"
echo "  2) Aucun — un proxy inverse externe assure déjà le TLS"
demander RD_TLS_MODE "Choix" "1"
RD_ACME_EMAIL=${RD_ACME_EMAIL:-}
if [ "$RD_TLS_MODE" = "1" ]; then
  demander RD_ACME_EMAIL "Adresse e-mail pour Let's Encrypt"
  [ -n "$RD_ACME_EMAIL" ] || { c_err "L'adresse e-mail est obligatoire pour ACME."; exit 1; }
  # D'autres noms pour le MEME site (un second sous-domaine, par exemple). Sans cette variable, relancer ce script
  # reecrivait le Caddyfile avec un seul nom : les autres cessaient de repondre en HTTPS, sans un mot.
  demander RD_DOMAIN_ALIASES "Autres noms servis par ce site (facultatif, séparés par des virgules ; « - » pour aucun)" ""
fi
RD_DOMAIN_ALIASES=${RD_DOMAIN_ALIASES:-}
[ "$RD_DOMAIN_ALIASES" = "-" ] && RD_DOMAIN_ALIASES=""
RD_SITES=$(sites_de "$RD_DOMAIN" "$RD_DOMAIN_ALIASES") || { c_err "  ✗ $RD_DOMAIN_ALIASES : chaque nom doit être un nom de domaine (lettres, chiffres, points, tirets)."; exit 1; }

titre "Liste des postes (facultatif)"
echo "  Un petit service ajoute une page d'accueil avec vos postes, leur nom, leurs étiquettes et leur"
echo "  état EN LIGNE. Il ne voit aucun mot de passe de poste et n'écoute que derrière nginx."
echo "  Sans lui, le client marche exactement comme avant (formulaire + dernières connexions)."
demander RD_FLEET "Activer la liste des postes ? (1 = oui, 0 = non)" "0"
case "$RD_FLEET" in 1) ;; *) RD_FLEET=0 ;; esac

# Le cookie de session est un second facteur d'accès : changer le mot de passe
# doit invalider les navigateurs déjà autorisés.
RD_SESSION_TOKEN=${RD_SESSION_TOKEN:-}
if [ -z "$RD_SESSION_TOKEN" ] || [ "$RD_WEB_PASSWORD" != "$ANCIEN_MDP" ]; then
  [ -n "$RD_SESSION_TOKEN" ] && c_warn "  mot de passe modifié → les sessions ouvertes sont révoquées"
  RD_SESSION_TOKEN=$(openssl rand -hex 32)
fi

# ------------------------------------------------------------- génération
titre "Génération de la configuration"
umask 077

# Échappe pour une écriture entre apostrophes : un mot de passe contenant
# " $ ` ou ' casserait sinon la relecture du fichier, voire exécuterait du code.
sq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
{
  echo "# Généré par setup.sh — contient des secrets, ne jamais committer."
  echo "RD_DOMAIN=$(sq "$RD_DOMAIN")"
  echo "RD_WEB_USER=$(sq "$RD_WEB_USER")"
  echo "RD_WEB_PASSWORD=$(sq "$RD_WEB_PASSWORD")"
  echo "RD_BACKEND_HOST=$(sq "$RD_BACKEND_HOST")"
  echo "RD_PUBLIC_KEY=$(sq "$RD_PUBLIC_KEY")"
  echo "RD_DEFAULT_PEER_ID=$(sq "${RD_DEFAULT_PEER_ID:-}")"
  echo "RD_TLS_MODE=$(sq "$RD_TLS_MODE")"
  echo "RD_ACME_EMAIL=$(sq "$RD_ACME_EMAIL")"
  echo "RD_DOMAIN_ALIASES=$(sq "$RD_DOMAIN_ALIASES")"
  echo "RD_SESSION_TOKEN=$(sq "$RD_SESSION_TOKEN")"
  echo "RD_FLEET=$(sq "$RD_FLEET")"
} > "$ENV_FILE"
echo "  ✓ .env"

# SHA-512 plutôt qu'apr1/MD5. 644 est requis : les workers nginx doivent lire.
printf '%s:%s\n' "$RD_WEB_USER" "$(openssl passwd -6 "$RD_WEB_PASSWORD")" > .htpasswd
chmod 644 .htpasswd
echo "  ✓ .htpasswd"

# Les placeholders d'identifiants n'existent dans aucun gabarit : ne jamais les
# passer à sed, cela exposerait le mot de passe dans « ps » et casserait sur « | ».
rendre() {                         # rendre gabarit destination
  sed -e "s|__RD_DOMAIN__|$RD_DOMAIN|g" \
      -e "s|__RD_BACKEND_HOST__|$RD_BACKEND_HOST|g" \
      -e "s|__RD_PUBLIC_KEY__|$RD_PUBLIC_KEY|g" \
      -e "s|__RD_DEFAULT_PEER_ID__|${RD_DEFAULT_PEER_ID:-}|g" \
      -e "s|__RD_ACME_EMAIL__|$RD_ACME_EMAIL|g" \
      -e "s|__RD_SESSION_TOKEN__|$RD_SESSION_TOKEN|g" \
      -e "s|__RD_SITES__|$RD_SITES|g" \
      "$1" > "$2"
  echo "  ✓ $2"
}
rendre nginx.conf.template     nginx.conf
rendre Caddyfile.template      Caddyfile
# La page est assemblee depuis web/src/ ; le gabarit n'est pas versionne.
python3 scripts/build-page.py
rendre web/index.html.template "$TMPD/index.html"

# ------------------------------------------------------------------ assets
titre "Assets du client web"
if [ -f html/js/dist/index.js.orig ]; then
  c_ok "  déjà présents, extraction ignorée"
else
  ./scripts/extract-assets.sh
fi
./scripts/patch-assets.sh
# Console de session (web/js -> html/rd-console.js) : TOUJOURS reconstruite, meme si
# les assets sont deja la — un rd-console.js perime serait servi sans un mot.
./scripts/build-web.sh
cp "$TMPD/index.html" html/index.html
echo "  ✓ html/index.html"

# « umask 077 » (plus haut) protege .env et nginx.conf, qui portent des secrets — mais il vaut aussi pour tout ce
# qui est cree ensuite. Sur une installation neuve, html/ sortait en 700 et ses fichiers en 600 ; sur une mise a
# jour, les nouveaux fichiers seulement (rd-console.js, manifeste, icones). Les workers nginx ne sont pas root :
# ils repondaient 403 a chaque fichier. Sans identifiants la page rendait toujours 401, donc rien ne le signalait.
# Constate le 2026-11-12 sur un conteneur candidat, avant qu'il n'atteigne un site en service.
chmod -R u=rwX,go=rX html

# Un bloc <script> qui ne se parse pas est abandonne en entier par le
# navigateur : la page se chargerait sans la moindre erreur visible, et le
# client serait completement inerte. On refuse de construire dans cet etat.
./scripts/check-syntax.sh html/index.html

# ---------------------------------------------------------------- compose
titre "Construction"
PROFIL=()
[ "$RD_FLEET" = "1" ] && PROFIL=(--profile fleet)
if [ "$RD_TLS_MODE" = "1" ]; then
  docker compose ${PROFIL[@]+"${PROFIL[@]}"} build && docker compose ${PROFIL[@]+"${PROFIL[@]}"} up -d
else
  c_warn "  TLS externe : le service « tls » n'est pas démarré."
  SERVICES=(web); [ "$RD_FLEET" = "1" ] && SERVICES+=(fleet)
  docker compose ${PROFIL[@]+"${PROFIL[@]}"} build "${SERVICES[@]}" && docker compose ${PROFIL[@]+"${PROFIL[@]}"} up -d "${SERVICES[@]}"
fi
# Un service retire du profil ne s'arrete pas tout seul : on le dit plutot que de le laisser tourner sans que personne le sache.
if [ "$RD_FLEET" != "1" ] && docker ps --format '{{.Names}}' | grep -qx rustdesk-fleet; then
  c_warn "  Le service de la liste des postes tourne encore alors qu'il est désactivé : docker compose --profile fleet stop fleet"
fi

# ------------------------------------------------------------ vérification
titre "Vérification"
sleep 5
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/ || true)
if [ "$code" = "401" ]; then c_ok "  ✓ la page exige une authentification (401)"
else c_warn "  ⚠ sans identifiants, réponse inattendue : $code"; fi

# Une ERREUR, pas un avertissement : 401 sans identifiants ne prouve pas que la page se charge (un 403 sur
# chaque fichier donne exactement le meme 401 a qui n'est pas connecte).
ECHEC_PAGE=0
code=$(curl -s -o /dev/null -w '%{http_code}' -u "$RD_WEB_USER:$RD_WEB_PASSWORD" http://127.0.0.1:8081/ || true)
if [ "$code" = "200" ]; then c_ok "  ✓ la page répond avec les identifiants (200)"
else c_err "  ✗ avec identifiants, la page répond $code au lieu de 200 — docker logs rustdesk-web"; ECHEC_PAGE=1; fi

code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/healthz || true)
if [ "$code" = "204" ]; then c_ok "  ✓ sonde de santé (204)"
else c_warn "  ⚠ sonde de santé : $code"; fi

code=$(curl -s -o /dev/null -w '%{http_code}' -u "$RD_WEB_USER:$RD_WEB_PASSWORD" \
       http://127.0.0.1:8081/js/dist/index.js.orig || true)
if [ "$code" = "404" ]; then c_ok "  ✓ les sources non corrigées ne sont pas servies (404)"
else c_warn "  ⚠ /js/dist/index.js.orig renvoie $code — le bloc de refus ne s'applique pas"; fi

ws=$(curl -s -o /dev/null -w '%{http_code}' -m 5 --http1.1 \
     -H "Upgrade: websocket" -H "Connection: Upgrade" \
     -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Version: 13" \
     http://127.0.0.1:8081/ws/id || true)
if [ "$ws" = "101" ]; then c_ok "  ✓ WebSocket vers hbbs (101)"
else c_warn "  ⚠ WebSocket : $ws — vérifie RD_BACKEND_HOST et que hbbs écoute sur 21118"; fi

if [ "$RD_FLEET" = "1" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/api/health || true)
  if [ "$code" = "401" ]; then c_ok "  ✓ l'API de la liste des postes exige l'authentification (401)"
  else c_warn "  ⚠ /api/health sans identifiants : $code"; fi
  code=$(curl -s -o /dev/null -w '%{http_code}' -u "$RD_WEB_USER:$RD_WEB_PASSWORD" http://127.0.0.1:8081/api/health || true)
  if [ "$code" = "200" ]; then c_ok "  ✓ le service de la liste des postes répond (200)"
  else c_warn "  ⚠ /api/health avec identifiants : $code — docker logs rustdesk-fleet"; fi
  # 21115 n'est JAMAIS un critère de choix de l'hôte : un pare-feu peut le filtrer alors que 21118/21119 passent. On le teste
  # ICI, depuis le conteneur du service (ce que verra le service), et on ne fait qu'avertir.
  verdict=$(docker exec rustdesk-fleet python3 -I -c "
import os, sys
sys.path.insert(0, '/app')
import server
r = server.sonder_hbbs(os.environ['RD_BACKEND_HOST'], 21115, ['000000000'])
print('ok' if r['000000000'] is not None else 'ko')" 2>/dev/null || echo ko)
  if [ "$verdict" = "ok" ]; then c_ok "  ✓ hbbs répond sur 21115 : l'état en ligne des postes sera affiché"
  else
    c_warn "  ⚠ hbbs ne répond pas sur 21115 depuis le conteneur : la liste marche, SANS la pastille « en ligne »."
    echo "    Ouvre le port TCP 21115 de hbbs à ce conteneur (pare-feu), ou lance :  python3 scripts/online-probe.py \"$RD_BACKEND_HOST\""
  fi
fi

# La vérification qui manquait, et c'est celle qui compte : /ws/id suffisait à
# déclarer l'installation réussie alors que c'est /ws/relay qui échoue. Une
# session web passe par le relais à 100 % — elle n'a pas d'UDP, donc pas de
# liaison directe. Une clé que hbbr refuse ne doit plus pouvoir traverser
# l'installation sans être nommée.
ECHEC_RELAIS=0
verdict=$(./scripts/relay-doctor.sh --probe-only \
          --url "ws://127.0.0.1:8081/ws/relay" --key "$RD_PUBLIC_KEY" 2>&1) || true
case "$verdict" in
  ACCEPTEE*) c_ok   "  ✓ hbbr accepte la clé — le relais est authentifié" ;;
  REFUSEE*)
    c_err "  ✗ hbbr REFUSE la clé. Aucune session web ne peut aboutir."
    c_err "    Cause la plus fréquente : hbbs et hbbr ne partagent pas leur"
    c_err "    répertoire de clés, donc chacun a généré la sienne. Compare :"
    c_err "      docker logs hbbs 2>&1 | grep 'Key:'"
    c_err "      docker logs hbbr 2>&1 | grep 'Key:'"
    c_err "    Diagnostic complet :  ./scripts/relay-doctor.sh"
    ECHEC_RELAIS=1 ;;
  *) c_warn "  ⚠ relais intestable : $verdict"
     c_warn "    ./scripts/relay-doctor.sh dira pourquoi." ;;
esac

titre "Terminé"
if [ "$RD_TLS_MODE" = "1" ]; then
  echo "  URL : https://$RD_DOMAIN/"
  [ "$RD_SITES" = "$RD_DOMAIN" ] || echo "  Noms servis : $RD_SITES"
  echo ""
  c_warn "  Avant que le certificat puisse être délivré :"
  echo "    • $RD_SITES doit pointer en A vers l'IP publique de cette machine,"
  echo "      sans proxy (nuage gris chez Cloudflare)"
  echo "    • le port 443 doit être ouvert dans le pare-feu local ET chez"
  echo "      l'hébergeur (security list, security group…)"
  echo "    • le port 80 peut rester fermé : TLS-ALPN-01 n'utilise que le 443"
  echo ""
  echo "  Suivre la délivrance : docker logs -f rustdesk-tls"
else
  echo "  Le client écoute sur http://127.0.0.1:8081/ — dirige ton proxy dessus."
fi
echo ""
echo "  Identifiant : $RD_WEB_USER"

if [ "$ECHEC_PAGE" = 1 ]; then
  echo ""
  c_err "  La page ne se charge pas pour un utilisateur connecté. Lis : docker logs rustdesk-web"
  exit 1
fi

if [ "$ECHEC_RELAIS" = 1 ]; then
  echo ""
  c_err "  La page est en ligne, mais aucune session ne pourra s'établir tant que"
  c_err "  hbbr refusera cette clé. Corrige-la, puis relance ce script."
  exit 1
fi
