# Journal des versions

## 1.0.0 — console de session complète et liste des postes

Alignement du client web RustDesk sur l'**interface et les réglages** de la console GL.iNet GLKVM — sans composant GL.iNet et sans
WebRTC : le client parle toujours le protocole RustDesk à votre hbbs/hbbr.

### Console de session
- **Disposition** : barre haute, tiroir « Réglages de session » (Vidéo, Audio, Clavier, Souris, Affichage), fenêtres flottantes,
  barre de statut (codec, résolution, débit, images/s, **santé de la liaison**, **Relais / Chiffré**). Toutes les fonctions
  existantes sont conservées, déplacées et non réécrites.
- **Menu Poste** : Ctrl+Alt+Suppr, verrouiller, **redémarrer** (deux clics), choix de l'**écran**, mode confidentialité, blocage des
  entrées, verrouillage en fin de session, presse-papier partagé, curseur dans l'image. Une fonction impossible sur le poste est
  grisée avec sa raison.
- **Entrées** : souris **relative** (pair ≥ 1.4.5) avec sensibilité, **bouton principal**, **vitesse** et **sens** du défilement,
  boutons **Retour / Avance**, **anti-veille**, touches Impr. écran / Menu / Pause, **clavier virtuel**, **plein écran avec
  verrouillage du clavier**.
- **Toolbox** : envoyer / taper du texte, raccourcis par OS du poste et personnalisés, **capture d'écran**, **enregistrement vidéo**.
- **Statistiques** (4 courbes), **Aide** (test du relais, **journal exportable sans secret**, à propos et lien vers la source).
- **Thèmes** clair / sombre / auto, **français et anglais**, vue **1:1**, accessibilité vérifiée par mesure (contraste 4,5:1 et 3:1,
  mouvement réduit, couleurs forcées, cibles tactiles de 44 px).
- **Écran de connexion** refait (carte adaptative ; il débordait d'un téléphone et dézoomait la page), champs nommés, **Entrée** valide.

### Liste des postes (service facultatif `fleet`)
- Page **Mes postes** (nom, note, étiquettes, favori, dernière connexion, **état en ligne**), recherche, ajout / modification /
  retrait, export / import JSON, sélecteur **Postes** en session, ajout automatique d'un poste connecté.
- Service Python standard + SQLite, conteneur en lecture seule sans privilège, derrière l'authentification de nginx, **garde CSRF**,
  aucun mot de passe de poste côté serveur. L'état en ligne vient de hbbs (TCP 21115) ; inconnu n'est jamais « hors ligne ».
- nginx : `location /api/` (zone de débit séparée, résolution à la requête : le service est facultatif, son absence ne casse rien).

### Outillage
- `scripts/build-web.sh` (sources IIFE, `try/catch` par module, analyse en script classique, version injectée), `scripts/online-probe.py`.
- Bancs : gabarit 149 tests, Chromium 86 tests (chemins matériel **et** logiciel), service 19 tests ; **planchers** dans `verify.sh`.
- `verify.sh` éprouve aussi nginx + service de bout en bout et le cas « service absent » (502, nginx tient).

### Mise à jour depuis une version précédente
```bash
git pull && ./setup.sh        # régénère nginx.conf (nouvelle location) et html/ (rd-console.*) ; répondre à « liste des postes »
```
Sans relancer `setup.sh`, l'ancienne `nginx.conf` sert la console mais pas `/api/` : la page reste fonctionnelle, sans la liste.

### Limites connues
- Non vérifié sur un vrai pair : souris relative, Retour/Avance, redémarrage, verrouillage, confidentialité/blocage sous macOS.
- Capture / enregistrement : sur le repli de décodage logiciel (WebGL), la capture peut être vide.
- Non repris (matériel GLKVM ou hors périmètre) : Virtual Media, accessoires ATX/Fingerbot, EDID, Apps Center, micro/caméra, OCR,
  Wake-on-LAN, terminal, mur d'écrans, comptes multiples / SSO / 2FA / audit.
