# Protection de l'authentification web

Le client web est exposé sur `rustdesk.elzuzu.ch.eu.org`, et cette URL est
publique depuis le **12 août 2026** dans les journaux de transparence des
certificats — comme tout nom ayant obtenu un certificat Let's Encrypt. La
découvrabilité n'est donc pas un levier : il faut que la porte tienne.

Deux couches, posées le 2026-09-15.

## 1. Limitation de débit — dans `nginx.conf.template`

60 requêtes par minute et par IP, rafale de 100. Un chargement complet du client
(66 fichiers) passe d'un coup ; une attaque retombe à une tentative par seconde.

**Mesuré** : 130 requêtes → 104 passées, 26 en `429`.

Elle est posée sur les **trois** emplacements authentifiés. Une version
antérieure ne couvrait que `location /`, ce qui laissait `= /index.html` et les
assets `js/dist/` sans protection — une force brute y serait simplement allée.

**`set_real_ip_from 172.18.0.0/16` est indispensable.** Caddy atteint nginx par
la passerelle du pont Docker : sans cette ligne, nginx voit `172.18.0.1` pour
tout le monde et la limitation par IP met **tous les visiteurs dans le même
seau**, étranglant le service au lieu de l'attaquant. Vérifié le 2026-09-15 :
Caddy pose bien `X-Real-IP`, et le journal montre l'adresse réelle du client.

## 2. Bannissement — fail2ban

Ralentir ne suffit pas ; c'est le bannissement qui arrête. Dix échecs `401` en
dix minutes valent une heure de bannissement.

```sh
sudo cp deploy/fail2ban-filter-rustdesk-auth.conf /etc/fail2ban/filter.d/rustdesk-auth.conf
sudo cp deploy/fail2ban-jail-rustdesk-auth.conf   /etc/fail2ban/jail.d/rustdesk-auth.conf
sudo cp deploy/logrotate-rustdesk-web             /etc/logrotate.d/rustdesk-web
sudo fail2ban-client reload
```

**`port = http,https` dans la prison n'est pas décoratif.** Sans cette ligne,
fail2ban bannit l'adresse sur *tous* les ports et un faux positif couperait
aussi SSH. Vérifié le 2026-09-15 : une adresse bannie perd le web et **garde
SSH sur une connexion neuve**.

Les `429` sont volontairement exclus du filtre : un visiteur légitime qui
déclenche la limitation de débit ne doit pas être banni pour autant.

**Avant d'activer la prison, vider `logs/access.log`** si des tests viennent d'y
écrire des `401` — sinon le premier passage bannit l'adresse qui les a produits.

## Choix du hachage du mot de passe

`htpasswd` écrit par défaut du MD5-crypt (`$apr1$`) : 1 000 itérations, ce qui
tombe vite sur carte graphique si le fichier venait à fuiter. Préférer bcrypt à
la création :

```sh
htpasswd -B -c .htpasswd <utilisateur>   # puis reconstruire l'image
```

Le choix n'a d'effet que si `.htpasswd` fuite — mais il ne coûte rien à faire
correctement dès le départ.
