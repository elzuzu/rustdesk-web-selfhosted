#!/usr/bin/env python3
"""Service « flotte » : la liste de vos postes RustDesk, avec leur etat en ligne.

Ce que fait ce service, et RIEN d'autre :
  - garde, dans un fichier SQLite, la liste de vos postes (ID, nom, note, etiquettes, favori, derniere connexion) ;
  - interroge hbbs (port TCP 21115) pour savoir lesquels sont EN LIGNE en ce moment.

Ce qu'il ne fait PAS : il ne voit ni ne stocke aucun mot de passe de poste (ils restent dans le navigateur), il n'ouvre
aucune session, il ne parle pas au relais. Il n'a aucune authentification propre : il n'ecoute que sur le reseau interne
de Docker, derriere nginx, qui exige deja l'authentification de la page (Basic + cookie).

Aucune dependance : bibliotheque standard de Python 3.9+.

Etat en ligne — comment, et pourquoi par ici : hbbs OSS ne repond a « OnlineRequest » que sur son port TCP BRUT 21115
(rendezvous_server.rs, handle_listener2), pas sur le WebSocket que le navigateur sait parler. Une requete par connexion TCP
(hbbs lit UN message, repond, ferme) ; une source loopback serait traitee comme la console d'administration de hbbs : on se
connecte donc depuis le reseau Docker, jamais en 127.0.0.1. Un pair est « en ligne » s'il s'est enregistre depuis moins de
30 s (REG_TIMEOUT) ; apres un redemarrage de hbbs, tous les postes paraissent hors ligne le temps de se reenregistrer.
Quand hbbs est injoignable, l'etat est INCONNU (null), jamais « hors ligne » : on ne pretend pas savoir.
"""
import http.server
import json
import os
import re
import socket
import socketserver
import sqlite3
import sys
import threading
import time
import urllib.parse

VERSION = "1.0.0"
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{4,31}$")        # ID RustDesk : chiffres, ou 5 a 32 caracteres sobres
MAX_CORPS = 8 * 1024
MAX_POSTES = 500
MAX_ETIQUETTES, LONG_ETIQUETTE = 8, 24
DELAI_HBBS = 3.0
DUREE_CACHE = 10.0
SILENCIEUX = False                                              # les tests le coupent


# --------------------------------------------------------------------------- protocole hbbs
def _varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _lire_varint(buf, i):
    n = shift = 0
    while True:
        if i >= len(buf):
            raise ValueError("varint tronque")
        b = buf[i]
        i += 1
        n |= (b & 0x7F) << shift
        if not b & 0x80:
            return n, i
        shift += 7
        if shift > 35:
            raise ValueError("varint trop long")


def trame(charge):
    """En-tete d'une trame hbb_common (BytesCodec) : 1 a 4 octets, bits 0-1 = longueur de l'en-tete - 1, valeur = n << 2."""
    n = len(charge)
    if n <= 0x3F:
        return bytes([n << 2]) + charge
    if n <= 0x3FFF:
        return ((n << 2) | 1).to_bytes(2, "little") + charge
    if n <= 0x3FFFFF:
        return ((n << 2) | 2).to_bytes(3, "little") + charge
    if n <= 0x3FFFFFFF:
        return ((n << 2) | 3).to_bytes(4, "little") + charge
    raise ValueError("trame trop grande")


def requete_en_ligne(ids):
    """RendezvousMessage{ online_request (champ 23) = OnlineRequest{ id (1) = « web », peers (2) = ids } }, cadree."""
    interne = b"\x0a" + _varint(3) + b"web"
    for i in ids:
        b = i.encode("ascii")
        interne += b"\x12" + _varint(len(b)) + b
    message = _varint((23 << 3) | 2) + _varint(len(interne)) + interne          # = ba 01 <longueur> <interne>
    return trame(message)


def lire_trame(lire):
    """Lit un cadre complet via lire(n) (qui rend exactement n octets) et rend sa charge."""
    premier = lire(1)
    ln = (premier[0] & 0x3) + 1
    entete = premier + (lire(ln - 1) if ln > 1 else b"")
    n = int.from_bytes(entete, "little") >> 2
    if n > 1 << 20:
        raise ValueError("reponse hbbs demesuree")
    return lire(n) if n else b""


def decoder_reponse(charge, n_pairs):
    """OnlineResponse (champ 24) { states (1) = bitmap, bit de poids FORT d'abord } -> liste de bool de longueur n_pairs."""
    tag, i = _lire_varint(charge, 0)
    if tag != ((24 << 3) | 2):
        raise ValueError("ce n'est pas une OnlineResponse (tag %d)" % tag)
    ln, i = _lire_varint(charge, i)
    interne = charge[i:i + ln]
    if len(interne) != ln:
        raise ValueError("charge tronquee")
    etats = b""
    j = 0
    while j < len(interne):
        t, j = _lire_varint(interne, j)
        if t == ((1 << 3) | 2):
            m, j = _lire_varint(interne, j)
            if j + m > len(interne):
                raise ValueError("bitmap tronque")
            etats = interne[j:j + m]
            j += m
        else:                                                      # champ inconnu : on le saute proprement
            wt = t & 7
            if wt == 0:
                _, j = _lire_varint(interne, j)
            elif wt == 2:
                m, j = _lire_varint(interne, j)
                if j + m > len(interne):
                    raise ValueError("champ tronque")
                j += m
            else:
                raise ValueError("type de fil inattendu")
    return [bool(k // 8 < len(etats) and etats[k // 8] & (0x80 >> (k % 8))) for k in range(n_pairs)]


def sonder_hbbs(hote, port, ids, delai=DELAI_HBBS):
    """{id: True | False} ou {id: None} partout si hbbs ne repond pas. Une connexion, un message, une reponse."""
    ids = list(ids)
    if not ids:
        return {}
    try:
        with socket.create_connection((hote, port), timeout=delai) as s:
            s.settimeout(delai)
            s.sendall(requete_en_ligne(ids))

            def lire(n):
                tampon = b""
                while len(tampon) < n:
                    bloc = s.recv(n - len(tampon))
                    if not bloc:
                        raise ConnectionError("hbbs a ferme la liaison")
                    tampon += bloc
                return tampon
            etats = decoder_reponse(lire_trame(lire), len(ids))
        return dict(zip(ids, etats))
    except (OSError, ValueError, ConnectionError):
        return {i: None for i in ids}


class SondeEnLigne:
    """Cache de 10 s sur l'etat en ligne : plusieurs onglets, une seule question a hbbs."""

    def __init__(self, hote, port, horloge=time.monotonic, sonder=sonder_hbbs, duree=DUREE_CACHE):
        self.hote, self.port, self.horloge, self.sonder, self.duree = hote, port, horloge, sonder, duree
        self.verrou = threading.Lock()
        self.cache = {}                                           # id -> (etat, instant)

    def etats(self, ids):
        ids = list(ids)
        maintenant = self.horloge()
        with self.verrou:
            manquants = [i for i in ids if i not in self.cache or maintenant - self.cache[i][1] >= self.duree]
        if manquants:
            frais = self.sonder(self.hote, self.port, manquants)
            with self.verrou:
                for i, e in frais.items():
                    self.cache[i] = (e, maintenant)
        with self.verrou:
            return {i: self.cache[i][0] if i in self.cache else None for i in ids}


# --------------------------------------------------------------------------- stockage
SCHEMA = """
CREATE TABLE IF NOT EXISTS postes (
  id TEXT PRIMARY KEY, nom TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', etiquettes TEXT NOT NULL DEFAULT '[]',
  favori INTEGER NOT NULL DEFAULT 0, cree INTEGER NOT NULL, derniere_connexion INTEGER
);
"""


class Magasin:
    def __init__(self, chemin):
        self.chemin = chemin
        d = os.path.dirname(chemin)
        if d:
            os.makedirs(d, exist_ok=True)
        with self._ouvrir() as c:
            c.executescript(SCHEMA)

    def _ouvrir(self):
        c = sqlite3.connect(self.chemin, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        return c

    @staticmethod
    def _ligne(r):
        return {"id": r["id"], "nom": r["nom"], "note": r["note"], "etiquettes": json.loads(r["etiquettes"]), "favori": bool(r["favori"]),
                "cree": r["cree"], "derniere_connexion": r["derniere_connexion"]}

    def lister(self):
        with self._ouvrir() as c:
            return [self._ligne(r) for r in c.execute("SELECT * FROM postes ORDER BY favori DESC, COALESCE(derniere_connexion, 0) DESC, cree DESC")]

    def lire(self, pid):
        with self._ouvrir() as c:
            r = c.execute("SELECT * FROM postes WHERE id = ?", (pid,)).fetchone()
            return self._ligne(r) if r else None

    def nombre(self):
        with self._ouvrir() as c:
            return c.execute("SELECT COUNT(*) FROM postes").fetchone()[0]

    def ecrire(self, pid, champs, maintenant=None):
        """Cree ou met a jour : seuls les champs fournis changent."""
        maintenant = int(maintenant if maintenant is not None else time.time())
        with self._ouvrir() as c:
            r = c.execute("SELECT * FROM postes WHERE id = ?", (pid,)).fetchone()
            if r is None:
                c.execute("INSERT INTO postes (id, nom, note, etiquettes, favori, cree) VALUES (?, '', '', '[]', 0, ?)", (pid, maintenant))
            for k in ("nom", "note"):
                if k in champs:
                    c.execute("UPDATE postes SET %s = ? WHERE id = ?" % k, (champs[k], pid))
            if "etiquettes" in champs:
                c.execute("UPDATE postes SET etiquettes = ? WHERE id = ?", (json.dumps(champs["etiquettes"], ensure_ascii=False), pid))
            if "favori" in champs:
                c.execute("UPDATE postes SET favori = ? WHERE id = ?", (1 if champs["favori"] else 0, pid))
        return self.lire(pid)

    def effleurer(self, pid, maintenant=None):
        with self._ouvrir() as c:
            c.execute("UPDATE postes SET derniere_connexion = ? WHERE id = ?", (int(maintenant if maintenant is not None else time.time()), pid))
        return self.lire(pid)

    def supprimer(self, pid):
        with self._ouvrir() as c:
            return c.execute("DELETE FROM postes WHERE id = ?", (pid,)).rowcount > 0


# --------------------------------------------------------------------------- validation
class Refus(Exception):
    def __init__(self, statut, code):
        super().__init__(code)
        self.statut, self.code = statut, code


def nettoyer(corps, creation):
    """Valide un corps JSON ; rend les champs reconnus, ou leve Refus(400). Aucun champ inconnu n'est recopie."""
    if not isinstance(corps, dict):
        raise Refus(400, "corps_invalide")
    out = {}
    if "nom" in corps:
        if not isinstance(corps["nom"], str) or len(corps["nom"]) > 60 or re.search(r"[\x00-\x1f]", corps["nom"]):
            raise Refus(400, "nom_invalide")
        out["nom"] = corps["nom"].strip()
    if "note" in corps:
        if not isinstance(corps["note"], str) or len(corps["note"]) > 500:
            raise Refus(400, "note_invalide")
        out["note"] = corps["note"].strip()
    if "etiquettes" in corps:
        e = corps["etiquettes"]
        if not isinstance(e, list) or len(e) > MAX_ETIQUETTES:
            raise Refus(400, "etiquettes_invalides")
        vus = []
        for x in e:
            if not isinstance(x, str) or not x.strip() or len(x.strip()) > LONG_ETIQUETTE or re.search(r"[\x00-\x1f,]", x):
                raise Refus(400, "etiquettes_invalides")
            if x.strip() not in vus:
                vus.append(x.strip())
        out["etiquettes"] = vus
    if "favori" in corps:
        if not isinstance(corps["favori"], bool):
            raise Refus(400, "favori_invalide")
        out["favori"] = corps["favori"]
    return out


# --------------------------------------------------------------------------- HTTP
class Application:
    def __init__(self, magasin, sonde):
        self.magasin, self.sonde = magasin, sonde


def fabriquer_gestionnaire(app):
    class Gestionnaire(http.server.BaseHTTPRequestHandler):
        server_version = "rd-fleet/" + VERSION
        sys_version = ""
        protocol_version = "HTTP/1.0"                              # une requete par connexion : rien ne s'accumule, rien ne se melange

        def log_message(self, fmt, *a):                           # la sortie d'erreur est le journal du conteneur
            if not SILENCIEUX:
                sys.stderr.write("%s %s\n" % (self.address_string(), fmt % a))

        # -- reponses
        def _json(self, statut, objet):
            corps = json.dumps(objet, ensure_ascii=False).encode("utf-8")
            self.send_response(statut)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(corps)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(corps)

        def _erreur(self, statut, code):
            self._json(statut, {"erreur": code})

        # -- garde CSRF : les navigateurs joignent les identifiants Basic aux requetes entre sites. Toute ecriture exige un
        #    en-tete que seul notre propre page pose (X-RD) ET, quand le navigateur l'envoie, une origine identique.
        def _garde(self, ecriture):
            site = self.headers.get("Sec-Fetch-Site")
            if site is not None and site not in ("same-origin", "none"):
                raise Refus(403, "origine_refusee")
            if ecriture and self.headers.get("X-RD") != "1":
                raise Refus(403, "en_tete_manquant")

        def _corps(self):
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                raise Refus(400, "longueur_invalide")
            if n > MAX_CORPS:
                raise Refus(413, "corps_trop_grand")
            ct = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if n and ct != "application/json":
                raise Refus(415, "type_non_supporte")
            brut = self.rfile.read(n) if n else b""
            self._lu = True
            if not brut:
                return {}
            try:
                return json.loads(brut.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                raise Refus(400, "json_invalide")

        def _id(self, morceau):
            pid = urllib.parse.unquote(morceau)
            if not ID_RE.match(pid):
                raise Refus(400, "id_invalide")
            return pid

        def _traiter(self):
            chemin = urllib.parse.urlsplit(self.path).path
            m = self.command
            ecriture = m in ("POST", "PUT", "DELETE", "PATCH")
            self._garde(ecriture)
            if chemin == "/api/health" and m in ("GET", "HEAD"):
                return (200, {"ok": True, "version": VERSION, "postes": app.magasin.nombre(),
                                        "hbbs": "%s:%d" % (app.sonde.hote, app.sonde.port)})
            if chemin == "/api/devices" and m in ("GET", "HEAD"):
                postes = app.magasin.lister()
                etats = app.sonde.etats([p["id"] for p in postes]) if postes else {}
                for p in postes:
                    p["en_ligne"] = etats.get(p["id"])
                disponible = bool(postes) and any(v is not None for v in etats.values())
                return (200, {"postes": postes, "en_ligne_disponible": disponible})
            if chemin == "/api/devices" and m == "POST":
                corps = self._corps()
                if not isinstance(corps, dict) or not isinstance(corps.get("id"), str) or not ID_RE.match(corps["id"]):
                    raise Refus(400, "id_invalide")
                existe = app.magasin.lire(corps["id"]) is not None
                if not existe and app.magasin.nombre() >= MAX_POSTES:
                    raise Refus(409, "liste_pleine")
                return (200 if existe else 201, app.magasin.ecrire(corps["id"], nettoyer(corps, True)))
            r = re.match(r"^/api/devices/([^/]+)(/touch)?$", chemin)
            if r:
                pid = self._id(r.group(1))
                if r.group(2) and m == "POST":
                    if app.magasin.lire(pid) is None:
                        raise Refus(404, "inconnu")
                    return (200, app.magasin.effleurer(pid))
                if not r.group(2) and m in ("GET", "HEAD"):
                    p = app.magasin.lire(pid)
                    if p is None:
                        raise Refus(404, "inconnu")
                    return (200, p)
                if not r.group(2) and m == "PUT":
                    if app.magasin.lire(pid) is None:
                        raise Refus(404, "inconnu")
                    return (200, app.magasin.ecrire(pid, nettoyer(self._corps(), False)))
                if not r.group(2) and m == "DELETE":
                    if not app.magasin.supprimer(pid):
                        raise Refus(404, "inconnu")
                    return (200, {"ok": True})
            raise Refus(404, "introuvable")

        def _vider(self):
            """Un corps annonce mais non lu (refus avant lecture) serait pris pour la requete suivante, ou ferait emettre un RST
            qui peut effacer notre reponse chez le client : on le consomme, dans une limite raisonnable."""
            if self._lu:
                return
            try:
                restant = min(max(int(self.headers.get("Content-Length") or 0), 0), 65536)
            except ValueError:
                return
            while restant > 0:
                bloc = self.rfile.read(min(restant, 4096))
                if not bloc:
                    break
                restant -= len(bloc)

        def _executer(self):
            self._lu = False
            try:
                statut, objet = self._traiter()
            except Refus as e:
                statut, objet = e.statut, {"erreur": e.code}
            except Exception as e:                                   # jamais de trace vers le client
                if not SILENCIEUX:
                    sys.stderr.write("erreur interne : %r\n" % (e,))
                statut, objet = 500, {"erreur": "interne"}
            self._vider()
            self._json(statut, objet)

        do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = do_PATCH = _executer

    return Gestionnaire


class Serveur(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def creer_serveur(hote, port, db, hbbs_hote, hbbs_port, **kw):
    sonde = SondeEnLigne(hbbs_hote, hbbs_port, **kw)
    app = Application(Magasin(db), sonde)
    return Serveur((hote, port), fabriquer_gestionnaire(app)), app


def main():
    hote = os.environ.get("FLEET_BIND", "0.0.0.0")
    port = int(os.environ.get("FLEET_PORT", "8000"))
    db = os.environ.get("FLEET_DB", "/data/fleet.db")
    hbbs = os.environ.get("RD_BACKEND_HOST", "host.docker.internal")
    nat = int(os.environ.get("RD_HBBS_NAT_PORT", "21115"))
    srv, _ = creer_serveur(hote, port, db, hbbs, nat)
    sys.stderr.write("fleet %s : ecoute %s:%d, base %s, hbbs %s:%d\n" % (VERSION, hote, port, db, hbbs, nat))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
