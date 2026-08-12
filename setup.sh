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
echo "  Hôte joignable depuis le conteneur web. Si hbbs/hbbr tournent sur cette"
echo "  machine en network_mode host, utilise la passerelle Docker (172.17.0.1)."
demander RD_BACKEND_HOST "Hôte du serveur RustDesk" "172.17.0.1"
demander RD_PUBLIC_KEY "Clé publique du serveur (contenu de data/id_ed25519.pub)"
[ -n "${RD_PUBLIC_KEY:-}" ] || { c_err "La clé publique est obligatoire."; exit 1; }
demander RD_DEFAULT_PEER_ID "ID du poste distant à préremplir (facultatif)" ""

titre "TLS"
echo "  1) Caddy sur le port 443, certificat Let's Encrypt automatique (TLS-ALPN-01)"
echo "  2) Aucun — un proxy inverse externe assure déjà le TLS"
demander RD_TLS_MODE "Choix" "1"
RD_ACME_EMAIL=${RD_ACME_EMAIL:-}
if [ "$RD_TLS_MODE" = "1" ]; then
  demander RD_ACME_EMAIL "Adresse e-mail pour Let's Encrypt"
  [ -n "$RD_ACME_EMAIL" ] || { c_err "L'adresse e-mail est obligatoire pour ACME."; exit 1; }
fi

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
  echo "RD_SESSION_TOKEN=$(sq "$RD_SESSION_TOKEN")"
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
      "$1" > "$2"
  echo "  ✓ $2"
}
rendre nginx.conf.template     nginx.conf
rendre Caddyfile.template      Caddyfile
rendre web/index.html.template "$TMPD/index.html"

# ------------------------------------------------------------------ assets
titre "Assets du client web"
if [ -f html/js/dist/index.js.orig ]; then
  c_ok "  déjà présents, extraction ignorée"
else
  ./scripts/extract-assets.sh
fi
./scripts/patch-assets.sh
cp "$TMPD/index.html" html/index.html
echo "  ✓ html/index.html"

# ---------------------------------------------------------------- compose
titre "Construction"
if [ "$RD_TLS_MODE" = "1" ]; then
  docker compose build && docker compose up -d
else
  c_warn "  TLS externe : le service « tls » n'est pas démarré."
  docker compose build web && docker compose up -d web
fi

# ------------------------------------------------------------ vérification
titre "Vérification"
sleep 5
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/ || true)
if [ "$code" = "401" ]; then c_ok "  ✓ la page exige une authentification (401)"
else c_warn "  ⚠ sans identifiants, réponse inattendue : $code"; fi

code=$(curl -s -o /dev/null -w '%{http_code}' -u "$RD_WEB_USER:$RD_WEB_PASSWORD" http://127.0.0.1:8081/ || true)
if [ "$code" = "200" ]; then c_ok "  ✓ la page répond avec les identifiants (200)"
else c_warn "  ⚠ avec identifiants, réponse inattendue : $code"; fi

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

titre "Terminé"
if [ "$RD_TLS_MODE" = "1" ]; then
  echo "  URL : https://$RD_DOMAIN/"
  echo ""
  c_warn "  Avant que le certificat puisse être délivré :"
  echo "    • $RD_DOMAIN doit pointer en A vers l'IP publique de cette machine,"
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
