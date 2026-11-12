#!/usr/bin/env python3
"""Assemble la page du client web.

    web/src/page.html + web/src/*.js + web/src/style.css  ->  web/index.html.template

La page servie reste UN fichier : des blocs <script> et <style> en ligne, sans
requete supplementaire, et des scripts classiques qui partagent leur portee
globale. Seules les sources sont decoupees — un fichier de pres de 5 000 lignes
ne se relisait plus.

page.html est le squelette. Une ligne « //@inclure fichier.js » (ou
« /*@inclure fichier.css*/ ») y est remplacee par le contenu du fichier, tel
quel. Rien d'autre n'est transforme : ni minification, ni substitution — les
marqueurs __RD_DOMAIN__ et consorts sont rendus plus tard, par setup.sh.

Le resultat, web/index.html.template, n'est PAS versionne : setup.sh,
verify.sh, la CI et les bancs de test le reconstruisent avant de s'en servir.

Usage :  python3 scripts/build-page.py            ecrit le gabarit
         python3 scripts/build-page.py --verifier  echoue s'il n'est pas a jour
"""
import pathlib
import re
import sys

RACINE = pathlib.Path(__file__).resolve().parent.parent
SRC = RACINE / "web" / "src"
SORTIE = RACINE / "web" / "index.html.template"
DIRECTIVE = re.compile(r"^\s*(?://|/\*)@inclure ([A-Za-z0-9._-]+?)(?:\*/)?\s*$")


def assembler() -> str:
    lignes, inclus = [], []
    for ligne in (SRC / "page.html").read_text(encoding="utf-8").split("\n"):
        m = DIRECTIVE.match(ligne)
        if not m:
            lignes.append(ligne)
            continue
        fichier = SRC / m.group(1)
        if not fichier.is_file():
            sys.exit(f"  ✗ {fichier.relative_to(RACINE)} introuvable (inclus par page.html)")
        contenu = fichier.read_text(encoding="utf-8")
        # Un bloc en ligne se termine a la premiere balise fermante venue,
        # meme dans une chaine ou un commentaire : la page serait tronquee.
        fermante = "</style" if fichier.suffix == ".css" else "</script"
        if fermante in contenu.lower():
            sys.exit(f"  ✗ {fichier.name} contient « {fermante} » : il fermerait son bloc")
        lignes.append(contenu.rstrip("\n"))
        inclus.append(fichier.name)
    orphelins = sorted(f.name for f in SRC.iterdir()
                       if f.suffix in (".js", ".css") and f.name not in inclus)
    if orphelins:
        sys.exit("  ✗ dans web/src/ mais inclus nulle part : " + ", ".join(orphelins))
    return "\n".join(lignes)


def main() -> None:
    page = assembler()
    if "--verifier" in sys.argv[1:]:
        if not SORTIE.is_file() or SORTIE.read_text(encoding="utf-8") != page:
            sys.exit("  ✗ web/index.html.template n'est pas a jour : python3 scripts/build-page.py")
        print("  ✓ web/index.html.template est a jour")
        return
    SORTIE.write_text(page, encoding="utf-8")
    print(f"  ✓ web/index.html.template ({page.count(chr(10)) + 1} lignes)")


if __name__ == "__main__":
    main()
