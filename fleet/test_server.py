"""Tests du service flotte : protocole hbbs (contre un FAUX hbbs TCP), stockage, API HTTP, garde CSRF, validation.

Lancer :  python3 -m unittest discover -s fleet -v        (depuis la racine du depot)
"""
import http.client
import json
import os
import socket
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server as S  # noqa: E402

S.SILENCIEUX = True


class FauxHbbs:
    """Un hbbs de poche : repond a OnlineRequest sur un port TCP, comme handle_listener2 (un message, une reponse, fermeture)."""

    def __init__(self, en_ligne=(), mode="ok"):
        self.en_ligne, self.mode, self.requetes = set(en_ligne), mode, []
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.port = self.sock.getsockname()[1]
        self.actif = True
        threading.Thread(target=self._boucle, daemon=True).start()

    def _boucle(self):
        while self.actif:
            try:
                c, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._servir, args=(c,), daemon=True).start()

    def _servir(self, c):
        try:
            c.settimeout(3)
            lire = lambda n: self._lire(c, n)
            charge = S.lire_trame(lire)
            self.requetes.append(charge)
            if self.mode == "muet":
                return
            if self.mode == "ordures":
                c.sendall(b"\xff\xff\xff\xff\xff\xff")
                return
            ids = self._pairs(charge)
            bits = bytearray((len(ids) + 7) // 8)
            for i, pid in enumerate(ids):
                if pid in self.en_ligne:
                    bits[i // 8] |= 0x80 >> (i % 8)
            interne = b"\x0a" + S._varint(len(bits)) + bytes(bits)
            c.sendall(S.trame(S._varint((24 << 3) | 2) + S._varint(len(interne)) + interne))
        except (OSError, ValueError):
            pass
        finally:
            c.close()

    @staticmethod
    def _lire(c, n):
        b = b""
        while len(b) < n:
            x = c.recv(n - len(b))
            if not x:
                raise ConnectionError
            b += x
        return b

    @staticmethod
    def _pairs(charge):
        tag, i = S._lire_varint(charge, 0)
        assert tag == (23 << 3 | 2)
        ln, i = S._lire_varint(charge, i)
        interne, j, ids = charge[i:i + ln], 0, []
        while j < len(interne):
            t, j = S._lire_varint(interne, j)
            m, j = S._lire_varint(interne, j)
            if t == (2 << 3 | 2):
                ids.append(interne[j:j + m].decode())
            j += m
        return ids

    def fermer(self):
        self.actif = False
        self.sock.close()


class TestProtocole(unittest.TestCase):
    def test_vecteurs_dores(self):
        # Calcules a la main dans le plan, puis confirmes ici : OnlineRequest = champ 23 (tag ba 01), un message de 19 octets.
        self.assertEqual(S.requete_en_ligne(["123456789"]).hex(), "4cba01100a037765621209313233343536373839")
        self.assertEqual(S.decoder_reponse(bytes.fromhex("c20103" "0a0180"), 1), [True])
        self.assertEqual(S.decoder_reponse(bytes.fromhex("c20103" "0a0100"), 1), [False])

    def test_bitmap_bit_de_poids_fort_en_premier(self):
        self.assertEqual(S.decoder_reponse(bytes.fromhex("c20103" "0a01a0"), 5), [True, False, True, False, False])
        # 9 pairs : le neuvieme est le bit de poids fort du SECOND octet
        r = S.decoder_reponse(bytes.fromhex("c20104" "0a020080"), 9)
        self.assertEqual([i for i, v in enumerate(r) if v], [8])
        # moins d'octets que de pairs : les pairs sans bit sont « hors ligne », pas une erreur
        self.assertEqual(S.decoder_reponse(bytes.fromhex("c20103" "0a0180"), 12), [True] + [False] * 11)

    def test_en_tetes_de_trame(self):
        for n, entete in [(0, 1), (63, 1), (64, 2), (0x3FFF, 2), (0x4000, 3), (0x100000, 3)]:
            t = S.trame(b"x" * n)
            self.assertEqual(t[0] & 3, entete - 1, "n=%d" % n)
            self.assertEqual(len(t), n + entete)
            tampon = bytearray(t)

            def lire(k, tampon=tampon):
                sortie = bytes(tampon[:k]); del tampon[:k]
                return sortie
            self.assertEqual(S.lire_trame(lire), b"x" * n, "aller-retour n=%d" % n)
        self.assertEqual(S.trame(b"x" * 0x400000)[0] & 3, 3, "4 octets d'en-tete au-dela de 4 Mio")

    def test_reponse_illisible(self):
        for mauvais in (b"", b"\xff", bytes.fromhex("0a0100"), bytes.fromhex("c20105" "0a01"), bytes.fromhex("c20103" "0a8080"),
                        bytes.fromhex("c20103" "0a0500"), bytes.fromhex("c20105" "0d00000000")):
            with self.assertRaises(ValueError, msg=mauvais.hex()):
                S.decoder_reponse(mauvais, 1)

    def test_champ_inconnu_saute(self):
        interne = bytes.fromhex("1001" "0a0180")                                # un champ 2 (varint) avant « states »
        self.assertEqual(S.decoder_reponse(bytes([0xc2, 0x01, len(interne)]) + interne, 1), [True])

    def test_reponse_demesuree_refusee(self):
        t = bytearray(((1 << 21) << 2 | 3).to_bytes(4, "little"))               # annonce 2 Mio : refuse AVANT de les lire
        def lire(k):
            sortie = bytes(t[:k]); del t[:k]
            return sortie
        with self.assertRaises(ValueError):
            S.lire_trame(lire)


class TestSonde(unittest.TestCase):
    def test_contre_un_faux_hbbs(self):
        h = FauxHbbs({"111111111", "333333333", "ccc00cccc"})
        self.addCleanup(h.fermer)
        ids = ["111111111", "222222222", "333333333"] + ["x%08d" % i for i in range(5)] + ["ccc00cccc"]          # 9 pairs : franchit l'octet
        r = S.sonder_hbbs("127.0.0.1", h.port, ids)
        self.assertEqual({k: v for k, v in r.items() if v}, {"111111111": True, "333333333": True, "ccc00cccc": True})
        self.assertEqual(len(r), 9); self.assertIs(r["222222222"], False)
        self.assertEqual(len(h.requetes), 1, "UNE connexion, UN message pour tous les ID")

    def test_hbbs_muet_ordures_ou_absent_donnent_inconnu(self):
        for mode in ("muet", "ordures"):
            h = FauxHbbs({"111111111"}, mode)
            self.addCleanup(h.fermer)
            self.assertEqual(S.sonder_hbbs("127.0.0.1", h.port, ["111111111"], delai=0.6), {"111111111": None}, mode)
        s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()      # port ferme
        self.assertEqual(S.sonder_hbbs("127.0.0.1", port, ["111111111"], delai=0.6), {"111111111": None})
        self.assertEqual(S.sonder_hbbs("127.0.0.1", port, []), {}, "rien a demander : aucune connexion")

    def test_cache_dix_secondes(self):
        t = [0.0]
        appels = []

        def faux(h, p, ids):
            appels.append(list(ids)); return {i: True for i in ids}
        sonde = S.SondeEnLigne("h", 1, horloge=lambda: t[0], sonder=faux)
        sonde.etats(["a1111", "b2222"]); sonde.etats(["a1111"]); t[0] = 9.9; sonde.etats(["a1111", "b2222"])
        self.assertEqual(appels, [["a1111", "b2222"]], "dans les 10 s : une seule question")
        t[0] = 10.0; sonde.etats(["a1111", "c3333"])
        self.assertEqual(appels[1], ["a1111", "c3333"], "apres 10 s on redemande ; un nouvel ID est interroge")


class TestMagasin(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.m = S.Magasin(os.path.join(self.d, "sous", "f.db"))

    def test_crud_ordre_et_mises_a_jour_partielles(self):
        self.m.ecrire("aaaaa1", {"nom": "Mac", "etiquettes": ["maison", "mac"]}, maintenant=100)
        self.m.ecrire("bbbbb2", {"favori": True}, maintenant=200)
        self.m.ecrire("ccccc3", {}, maintenant=300)
        self.m.effleurer("aaaaa1", maintenant=500)
        self.assertEqual([p["id"] for p in self.m.lister()], ["bbbbb2", "aaaaa1", "ccccc3"], "favoris d'abord, puis derniere connexion")
        self.m.ecrire("aaaaa1", {"note": "bureau"}, maintenant=999)
        p = self.m.lire("aaaaa1")
        self.assertEqual((p["nom"], p["note"], p["etiquettes"], p["cree"]), ("Mac", "bureau", ["maison", "mac"], 100), "un champ absent ne change rien")
        self.assertTrue(self.m.supprimer("ccccc3")); self.assertFalse(self.m.supprimer("ccccc3")); self.assertEqual(self.m.nombre(), 2)


class TestApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hbbs = FauxHbbs({"111111111"})
        cls.d = tempfile.mkdtemp()
        cls.srv, cls.app = S.creer_serveur("127.0.0.1", 0, os.path.join(cls.d, "f.db"), "127.0.0.1", cls.hbbs.port)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown(); cls.hbbs.fermer()

    def setUp(self):
        for p in self.app.magasin.lister():
            self.app.magasin.supprimer(p["id"])
        self.app.sonde.cache.clear()

    def req(self, methode, chemin, corps=None, en_tetes=None, brut=None, ct="application/json"):
        h = {"X-RD": "1"}
        if corps is not None or brut is not None:
            h["Content-Type"] = ct
        h.update(en_tetes or {})
        h = {k: v for k, v in h.items() if v is not None}
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request(methode, chemin, body=brut if brut is not None else (json.dumps(corps) if corps is not None else None), headers=h)
        r = c.getresponse(); donnees = r.read()
        c.close()
        return r.status, (json.loads(donnees) if donnees else None), r

    def test_sante(self):
        s, j, r = self.req("GET", "/api/health")
        self.assertEqual((s, j["ok"], j["version"]), (200, True, S.VERSION))
        self.assertEqual(r.getheader("Cache-Control"), "no-store"); self.assertEqual(r.getheader("X-Content-Type-Options"), "nosniff")

    def test_cycle_complet(self):
        s, j, _ = self.req("POST", "/api/devices", {"id": "111111111", "nom": "Mac d'Alex", "etiquettes": ["maison"]})
        self.assertEqual((s, j["nom"]), (201, "Mac d'Alex"))
        self.assertEqual(self.req("POST", "/api/devices", {"id": "111111111", "note": "bureau"})[0], 200, "ID deja connu : mise a jour")
        self.req("POST", "/api/devices", {"id": "222222222"})
        s, j, _ = self.req("GET", "/api/devices")
        etats = {p["id"]: p["en_ligne"] for p in j["postes"]}
        self.assertEqual(etats, {"111111111": True, "222222222": False}); self.assertTrue(j["en_ligne_disponible"])
        self.assertEqual(self.req("PUT", "/api/devices/222222222", {"favori": True, "nom": "Salon"})[1]["favori"], True)
        s, j, _ = self.req("POST", "/api/devices/222222222/touch"); self.assertTrue(j["derniere_connexion"])
        self.assertEqual(self.req("GET", "/api/devices/111111111")[1]["note"], "bureau")
        self.assertEqual(self.req("DELETE", "/api/devices/111111111")[0], 200); self.assertEqual(self.req("GET", "/api/devices/111111111")[0], 404)
        self.assertEqual(self.req("DELETE", "/api/devices/111111111")[0], 404); self.assertEqual(self.req("PUT", "/api/devices/999999999", {"nom": "x"})[0], 404)

    def test_hbbs_injoignable_etat_inconnu(self):
        self.req("POST", "/api/devices", {"id": "111111111"})
        arret = self.app.sonde.port
        self.app.sonde.port, self.app.sonde.cache = 1, {}
        try:
            s, j, _ = self.req("GET", "/api/devices")
            self.assertIsNone(j["postes"][0]["en_ligne"], "inconnu, jamais « hors ligne »"); self.assertFalse(j["en_ligne_disponible"])
        finally:
            self.app.sonde.port = arret

    def test_validation(self):
        for corps in ({"id": "1' OR '1'='1"}, {"id": "ab"}, {"id": "a" * 40}, {"id": 123456789}, {"id": "../etc/passwd"}, {"id": "12345 6789"}, [], "x", {"nom": "x"}):
            self.assertEqual(self.req("POST", "/api/devices", corps)[0], 400, repr(corps))
        base = {"id": "123456789"}
        for extra in ({"nom": "x" * 61}, {"nom": "a\nb"}, {"nom": 5}, {"note": "x" * 501}, {"etiquettes": ["a"] * 9}, {"etiquettes": ["a,b"]}, {"etiquettes": [""]},
                      {"etiquettes": ["x" * 25]}, {"etiquettes": "maison"}, {"favori": 1}, {"favori": "oui"}):
            self.assertEqual(self.req("POST", "/api/devices", dict(base, **extra))[0], 400, repr(extra))
        s, j, _ = self.req("POST", "/api/devices", dict(base, nom="  ok  ", pirate="x", etiquettes=["a", "a", " b "]))
        self.assertEqual((s, j["nom"], j["etiquettes"]), (201, "ok", ["a", "b"])); self.assertNotIn("pirate", j, "un champ inconnu n'est jamais recopie")
        self.assertEqual(self.req("GET", "/api/devices/%27%3B%20DROP%20TABLE%20postes%3B--")[0], 400)
        self.assertEqual(self.app.magasin.nombre(), 1, "la table est intacte")

    def test_limites_de_corps_et_de_type(self):
        self.assertEqual(self.req("POST", "/api/devices", brut=b"x" * (S.MAX_CORPS + 1))[0], 413)
        self.assertEqual(self.req("POST", "/api/devices", brut=b'{"id":"123456789"}', ct="text/plain")[0], 415)
        self.assertEqual(self.req("POST", "/api/devices", brut=b"{pas du json")[0], 400)
        self.assertEqual(self.req("POST", "/api/devices", brut=b'\xff\xfe')[0], 400)

    def test_liste_pleine(self):
        ancien = S.MAX_POSTES
        S.MAX_POSTES = 2
        try:
            self.req("POST", "/api/devices", {"id": "aaaaa1"}); self.req("POST", "/api/devices", {"id": "aaaaa2"})
            self.assertEqual(self.req("POST", "/api/devices", {"id": "aaaaa3"})[0], 409)
            self.assertEqual(self.req("POST", "/api/devices", {"id": "aaaaa1", "nom": "x"})[0], 200, "mettre a jour un poste connu reste permis")
        finally:
            S.MAX_POSTES = ancien

    def test_garde_csrf(self):
        # Les navigateurs joignent les identifiants Basic aux requetes entre sites : toute ecriture exige X-RD…
        self.assertEqual(self.req("POST", "/api/devices", {"id": "123456789"}, {"X-RD": None})[0], 403)
        self.assertEqual(self.req("DELETE", "/api/devices/123456789", None, {"X-RD": None})[0], 403)
        self.assertEqual(self.req("POST", "/api/devices", {"id": "123456789"}, {"X-RD": "0"})[0], 403)
        # …et, quand le navigateur annonce l'origine, qu'elle soit la notre.
        for site in ("cross-site", "same-site"):
            self.assertEqual(self.req("POST", "/api/devices", {"id": "123456789"}, {"Sec-Fetch-Site": site})[0], 403, site)
            self.assertEqual(self.req("GET", "/api/devices", None, {"Sec-Fetch-Site": site})[0], 403, "meme une lecture entre sites")
        for site in ("same-origin", "none"):
            self.assertEqual(self.req("GET", "/api/devices", None, {"Sec-Fetch-Site": site})[0], 200, site)
        self.assertEqual(self.req("GET", "/api/health", None, {"X-RD": None})[0], 200, "une lecture n'exige pas X-RD")
        self.assertEqual(self.app.magasin.nombre(), 0, "aucune ecriture refusee n'a eu d'effet")

    def test_methodes_et_routes_inconnues(self):
        for m, c in [("GET", "/"), ("GET", "/api"), ("GET", "/api/inconnu"), ("PATCH", "/api/devices"), ("PUT", "/api/devices"), ("POST", "/api/devices/123456789")]:
            self.assertEqual(self.req(m, c, {} if m != "GET" else None)[0], 404, m + " " + c)

    def test_erreur_interne_sans_trace(self):
        original = self.app.magasin.lister
        self.app.magasin.lister = lambda: (_ for _ in ()).throw(RuntimeError("secret interne /etc/passwd"))
        try:
            s, j, _ = self.req("GET", "/api/devices")
            self.assertEqual((s, j), (500, {"erreur": "interne"}), "le client ne voit jamais la trace")
        finally:
            self.app.magasin.lister = original


if __name__ == "__main__":
    unittest.main()
