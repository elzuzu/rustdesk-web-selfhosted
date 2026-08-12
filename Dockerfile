# Client web RustDesk — assets statiques + reverse proxy WebSocket.
#
# Les assets proviennent de pmietlicki/rustdesk-web-client
# @sha256:da957e62f4c95179107632b7386735aec35c3ba10976bdb3ac00b747e496a2e6
# dont l'image n'a JAMAIS ete executee : seuls les fichiers ont ete extraits,
# puis corriges par scripts/patch-assets.sh (4 correctifs documentes).
# Le serveur est le nginx officiel, sous notre propre configuration.
FROM nginx:alpine

COPY html/            /usr/share/nginx/html/
COPY nginx.conf       /etc/nginx/conf.d/default.conf
COPY .htpasswd        /etc/nginx/.htpasswd

LABEL org.opencontainers.image.title="rustdesk-web" \
      org.opencontainers.image.description="Client web RustDesk auto-heberge" \
      org.opencontainers.image.source="pmietlicki/rustdesk-web-client (assets), nginx:alpine (serveur)"

HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1
