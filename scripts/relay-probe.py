#!/usr/bin/env python3
"""Sonde d'authentification du relais RustDesk (hbbr).

Envoie une trame RequestRelay sur /ws/relay et regarde ce que hbbr en fait.
hbbr n'a que deux comportements, et ils sont separes par deux ordres de
grandeur, ce qui rend le verdict binaire :

  cle refusee   -> relay_server.rs fait « return » sans rien repondre au
                   client : la liaison tombe en quelques dizaines de ms ;
  cle acceptee  -> le flux est range dans PEERS et hbbr dort 30 s en
                   attendant le pair : la liaison reste ouverte.

Aucune dependance : la poignee de main WebSocket et la trame masquee sont
ecrites a la main. Pas de navigateur, pas d'identifiants, pas de poste
distant — c'est le seul diagnostic qui ne suppose rien du deploiement.

Encodage de la trame, releve dans le bundle du client (et conforme a
hbb_common/protos/rendezvous.proto) :

  RendezvousMessage.request_relay = 18   -> tag 146 = 0x92 0x01
  RequestRelay.uuid               = 2    -> tag 18
  RequestRelay.licence_key        = 6    -> tag 50

Usage : relay-probe.py <url> <cle> [secondes]
Sortie : une ligne « VERDICT<TAB>millisecondes<TAB>detail »
Codes  : 0 acceptee, 1 refusee, 2 intestable, 3 reponse inattendue
"""
import base64
import os
import select
import socket
import ssl
import sys
import time

ACCEPTEE, REFUSEE, INTESTABLE, INATTENDUE = 0, 1, 2, 3


def trame_request_relay(uuid, cle):
    def champ(tag, valeur):
        b = valeur.encode("utf-8")
        entete = bytes([tag]) if tag < 128 else bytes([tag & 127 | 128, tag >> 7])
        if len(b) > 127:                      # aucun de nos champs n'y arrive
            raise ValueError("champ trop long pour cette sonde")
        return entete + bytes([len(b)]) + b

    interne = champ(18, uuid) + champ(50, cle)
    return bytes([0x92, 0x01, len(interne)]) + interne


def decouper_url(url):
    if url.startswith("wss://"):
        tls, reste = True, url[6:]
    elif url.startswith("ws://"):
        tls, reste = False, url[5:]
    else:
        raise ValueError("l'URL doit commencer par ws:// ou wss:// : " + url)
    hote, _, chemin = reste.partition("/")
    chemin = "/" + chemin
    if hote.startswith("["):                  # IPv6 litteral
        litteral, _, suffixe = hote.partition("]")
        hote_seul = litteral + "]"
        port = int(suffixe[1:]) if suffixe.startswith(":") else (443 if tls else 80)
        return tls, hote_seul, hote_seul.strip("[]"), port, chemin
    hote_seul, _, p = hote.partition(":")
    port = int(p) if p else (443 if tls else 80)
    return tls, hote, hote_seul, port, chemin


def sonder(url, cle, attente=3.0):
    debut = time.time()
    ecoule = lambda: (time.time() - debut) * 1000
    try:
        tls, entete_hote, hote, port, chemin = decouper_url(url)
    except ValueError as e:
        return INTESTABLE, 0.0, str(e)

    try:
        s = socket.create_connection((hote, port), timeout=10)
    except OSError as e:
        return INTESTABLE, ecoule(), "connexion TCP impossible vers %s:%d — %s" % (hote, port, e)

    try:
        if tls:
            try:
                s = ssl.create_default_context().wrap_socket(s, server_hostname=hote)
            except ssl.SSLError as e:
                return INTESTABLE, ecoule(), "TLS refuse — %s" % e

        nonce = base64.b64encode(os.urandom(16)).decode()
        s.sendall((
            "GET %s HTTP/1.1\r\n"
            "Host: %s\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n" % (chemin, entete_hote, nonce)
        ).encode())

        entetes = b""
        s.settimeout(10)
        while b"\r\n\r\n" not in entetes:
            try:
                bloc = s.recv(4096)
            except socket.timeout:
                return INTESTABLE, ecoule(), "aucune reponse a la poignee de main"
            if not bloc:
                return INTESTABLE, ecoule(), "liaison fermee pendant la poignee de main"
            entetes += bloc
        statut = entetes.split(b"\r\n", 1)[0].decode("latin-1")
        if " 101 " not in statut:
            # 401 = la route est derriere l'authentification, 404 = elle n'est
            # pas proxifiee, 502 = le proxy ne joint pas hbbr.
            return INTESTABLE, ecoule(), "pas de bascule WebSocket : %s" % statut

        charge = trame_request_relay("00000000-0000-4000-8000-0000000000ff", cle)
        masque = os.urandom(4)
        s.sendall(bytes([0x82, 0x80 | len(charge)]) + masque +
                  bytes(o ^ masque[i % 4] for i, o in enumerate(charge)))

        s.settimeout(None)
        pret, _, _ = select.select([s], [], [], attente)
        if not pret:
            return (ACCEPTEE, ecoule(),
                    "liaison toujours ouverte apres %.1f s — hbbr attend le pair" % attente)
        try:
            recu = s.recv(4096)
        except OSError as e:
            return REFUSEE, ecoule(), "liaison rompue par hbbr — %s" % e
        if not recu:
            return REFUSEE, ecoule(), "liaison fermee par hbbr sans reponse"
        if recu[0] & 0x0F == 0x8:
            return REFUSEE, ecoule(), "trame de fermeture WebSocket envoyee par hbbr"
        return INATTENDUE, ecoule(), "reponse inattendue : %s" % recu[:32].hex()
    finally:
        try:
            s.close()
        except OSError:
            pass


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.stderr.write(__doc__)
        sys.exit(2)
    code, ms, detail = sonder(sys.argv[1], sys.argv[2],
                              float(sys.argv[3]) if len(sys.argv) > 3 else 3.0)
    nom = {ACCEPTEE: "ACCEPTEE", REFUSEE: "REFUSEE",
           INTESTABLE: "INTESTABLE", INATTENDUE: "INATTENDUE"}[code]
    print("%s\t%.0f\t%s" % (nom, ms, detail))
    sys.exit(code)
