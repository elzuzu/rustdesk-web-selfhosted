#!/usr/bin/env python3
"""Sonde de l'etat en ligne : interroge hbbs sur son port TCP 21115 comme le fait le service flotte.

Pourquoi un outil a part : c'est le seul moyen de savoir, SANS deviner, si le service flotte pourra donner l'etat en ligne de
vos postes. hbbs ne repond a « OnlineRequest » que sur 21115 (TCP brut), jamais sur 21118 (WebSocket) ; un pare-feu qui
laisse passer 21118 et 21119 peut tres bien bloquer 21115, et une source loopback tombe dans la console d'administration de
hbbs. Lancee DEPUIS UN CONTENEUR du reseau Docker (setup.sh le fait), elle voit ce que verra le service.

Aucune dependance. Usage :  online-probe.py <hote> [port=21115] [id ...]
Sortie : une ligne par ID — « en ligne », « hors ligne » ou « inconnu » — puis un verdict.
Codes : 0 hbbs a repondu, 1 hbbs n'a pas repondu.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fleet"))
sys.path.insert(0, "/app")                                     # dans l'image du service
import server  # noqa: E402


def main(argv):
    if len(argv) < 2:
        sys.stderr.write(__doc__)
        return 2
    hote = argv[1]
    port = int(argv[2]) if len(argv) > 2 and argv[2].isdigit() else 21115
    ids = [a for a in argv[2:] if not a.isdigit() or len(a) >= 6] or ["000000000"]    # un ID factice : hbbs repond « hors ligne »
    r = server.sonder_hbbs(hote, port, ids)
    for i in ids:
        print("%s\t%s" % (i, {True: "en ligne", False: "hors ligne", None: "inconnu"}[r[i]]))
    if all(v is None for v in r.values()):
        print("VERDICT\tinjoignable\t%s:%d ne repond pas a OnlineRequest (port filtre, hbbs arrete, ou source loopback)" % (hote, port))
        return 1
    print("VERDICT\tok\t%s:%d repond : l'etat en ligne sera disponible" % (hote, port))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
