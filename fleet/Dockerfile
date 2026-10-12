# Service « flotte » : la liste des postes et leur etat en ligne. Voir fleet/server.py.
# Python standard uniquement, aucune dependance a installer : l'image ne contient que l'interpreteur et un fichier.
FROM python:3.12-alpine

RUN adduser -D -H -u 10001 fleet && mkdir /data && chown fleet:fleet /data
COPY server.py /app/server.py

USER fleet
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 FLEET_DB=/data/fleet.db
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD python3 -I -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/api/health', timeout=3)" || exit 1

CMD ["python3", "-I", "/app/server.py"]
