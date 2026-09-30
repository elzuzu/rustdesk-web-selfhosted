#!/usr/bin/env node
// Banc du gabarit web/index.html.template — Node, sans dependance.
//
// Usage :  node scripts/test-template.mjs [--require-vendor]
//
// Ce que ce banc garde, et que rien d'autre ne gardait :
//   - les blocs <script> se PARSENT (comme check-syntax.sh) mais aussi se
//     CHARGENT ensemble dans un seul contexte : les scripts classiques
//     partagent la portee lexicale globale, un « const » de premier niveau
//     declare deux fois leve au chargement — et « node --check » par fichier
//     ne le voit pas ;
//   - les contrats que d'autres outils lisent dans la page (relay-doctor.sh
//     greppe « var KEY= » et « var RD_HOST = ») ;
//   - les contrats window.* echanges entre blocs ;
//   - le comportement du decodeur zstd EMBARQUE dans le bundle, avec le vrai
//     decodeur wasm — c'est lui qui rend une image vide sans erreur quand le
//     taux de compression depasse 30x (voir « caracterisation zstd »).
//
// --require-vendor : les tests qui exigent html/js/dist/ (produit par
//   extract-assets.sh puis patch-assets.sh) ECHOUENT au lieu d'etre ignores.
//   La CI et verify.sh le passent ; en local, sans ce drapeau, ils sont
//   ignores avec un message explicite.
//
// Compatible Node 20 (celui de la CI) : node:test, aucune API >= 22.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXIGE_VENDOR = process.argv.includes("--require-vendor");
const GABARIT = path.join(RACINE, "web", "index.html.template");
const VENDOR = path.join(RACINE, "html", "js", "dist", "vendor.js");
const BUNDLE = path.join(RACINE, "html", "js", "dist", "index.js");
const TARBALL = path.join(RACINE, "assets", "rustdesk-web-assets.tar.gz");
const MIO = 1024 * 1024;

const lire = (p) => fs.readFileSync(p, "utf8");
const html = lire(GABARIT);

// Meme regex que scripts/check-syntax.sh : les blocs porteurs d'un src= sont
// des references au bundle, rien a verifier dedans.
const RE_BLOC = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const blocs = (h) => [...h.matchAll(RE_BLOC)].map((m) => m[1]);

// Rendu comme setup.sh / verify.sh, avec des valeurs realistes : une cle de 43
// caracteres terminee par « = » (la seule forme que setup.sh accepte), un ID a
// espaces, un domaine.
const VALEURS = {
  domaine: "rd.example.org",
  cle: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP+/=".slice(0, 43) + "=",
  id: "123 456 789",
};
function rendre(h, v = VALEURS) {
  return h
    .split("__RD_DOMAIN__").join(v.domaine)
    .split("__RD_PUBLIC_KEY__").join(v.cle)
    .split("__RD_DEFAULT_PEER_ID__").join(v.id);
}

// ------------------------------------------------------------------ bac
// Un contexte vm avec le strict necessaire pour CHARGER les quatre blocs sans
// navigateur. Les minuteurs sont captures (jamais executes tout seuls) : c'est
// ce qui rend le banc deterministe.
function creerBac({ quota = null } = {}) {
  class Storage {
    constructor() { Object.defineProperty(this, "_m", { value: new Map() }); }
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
    setItem(k, v) {
      if (this.quota != null) {
        let total = String(v).length;
        for (const [kk, vv] of this._m) if (kk !== k) total += vv.length;
        if (total > this.quota) {
          const e = new Error("quota"); e.name = "QuotaExceededError"; throw e;
        }
      }
      this._m.set(String(k), String(v));
    }
    removeItem(k) { this._m.delete(k); }
  }
  const minuteurs = [];
  const fictif = () => ({
    style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    setAttribute() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    remove() {}, focus() {}, click() {},
    getContext() { return new Proxy({}, { get: () => () => ({}) }); },
  });
  const document = {
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelector() { return null; },
    querySelectorAll() { return []; }, createElement: fictif,
    body: fictif(), documentElement: fictif(), head: fictif(),
    visibilityState: "visible", hidden: false, activeElement: null,
    readyState: "complete", cookie: "",
  };
  class WebSocket {
    constructor(u) { this.url = u; this.readyState = 0; }
    addEventListener() {} send() {} close() {}
  }
  const bac = {
    console, Storage, localStorage: new Storage(), sessionStorage: new Storage(),
    document, WebSocket,
    navigator: { userAgent: "node", serviceWorker: { getRegistrations: () => Promise.resolve([]) },
                 clipboard: {}, wakeLock: undefined },
    location: { protocol: "https:", host: "h", href: "https://h/", hostname: "h" },
    performance: { now: () => Date.now() },
    setInterval: (f, ms) => { minuteurs.push({ f, ms }); return minuteurs.length; },
    setTimeout: (f, ms) => { minuteurs.push({ f, ms, once: true }); return minuteurs.length; },
    clearInterval() {}, clearTimeout() {},
    TextEncoder, TextDecoder, URL, Uint8Array, JSON, Promise, Blob, atob, btoa,
    requestAnimationFrame() {}, addEventListener() {}, removeEventListener() {},
    getComputedStyle() { return { display: "none" }; },
    innerWidth: 1000, innerHeight: 800, createImageBitmap() {},
  };
  bac.window = bac; bac.self = bac;
  if (quota != null) bac.localStorage.quota = quota;
  const ctx = vm.createContext(bac);
  const executer = (blocs_) => blocs_.forEach((b, i) => {
    new vm.Script(b, { filename: `bloc${i}.js` }).runInContext(ctx);
  });
  return { window: bac, ctx, minuteurs, executer, stockage: bac.localStorage };
}

// ------------------------------------------------------------ structure
test("blocks-parse-raw-and-rendered : chaque bloc se parse, brut et rendu", () => {
  for (const [nom, h] of [["brut", html], ["rendu", rendre(html)]]) {
    const b = blocs(h);
    assert.ok(b.length >= 4, `${nom} : au moins 4 blocs inline attendus, vu ${b.length}`);
    b.forEach((src, i) => {
      assert.doesNotThrow(() => new vm.Script(src, { filename: `${nom}-bloc${i}.js` }),
        `${nom} : bloc ${i} ne se parse pas`);
    });
  }
});

test("blocks-share-one-vm-context : les blocs se chargent ensemble sans lever", () => {
  const bac = creerBac();
  assert.doesNotThrow(() => bac.executer(blocs(html)),
    "un const/let de premier niveau declare deux fois, ou un acces DOM au chargement");
  assert.equal(typeof bac.window.RD, "object", "window.RD absent apres chargement");
});

test("no-script-end-tag-or-html-comment : rien qui referme ou masque un bloc", () => {
  const fermantes = (html.match(/<\/script/gi) || []).length;
  const ouvertes = (html.match(/<script[\s>]/gi) || []).length;
  // Les commentaires du gabarit citent « <script> » en prose (deux fois) : on
  // ne peut donc pas comparer les ouvertes. Les fermantes, elles, doivent
  // toutes correspondre a une vraie balise : un « </script » dans une chaine
  // JS terminerait le bloc en plein milieu.
  const reelles = blocs(html).length + (html.match(/<script[^>]*\bsrc=[^>]*><\/script>/g) || []).length;
  assert.equal(fermantes, reelles,
    `${fermantes} « </script » pour ${reelles} balises reelles (${ouvertes} ouvrantes en comptant la prose)`);
  blocs(html).forEach((b, i) => {
    assert.ok(!b.includes("<!--"), `bloc ${i} contient « <!-- » : le navigateur peut y perdre le reste du bloc`);
  });
});

test("relay-doctor-first-match : relay-doctor.sh retrouve la cle et l'hote cuits", () => {
  // Meme lecture que scripts/relay-doctor.sh (sed -n ... | head -1) : la
  // PREMIERE ligne qui correspond fait foi. Une seconde occurrence plus haut
  // dans la page (dans un commentaire, dans un bloc ajoute) la detournerait.
  const rendu = rendre(html).split("\n");
  const premiere = (re) => { for (const l of rendu) { const m = l.match(re); if (m) return { m, l }; } return null; };
  const cle = premiere(/.*var KEY="([^"]*)".*/);
  const hote = premiere(/.*var RD_HOST *= *"([^"]*)".*/);
  assert.ok(cle, "aucune ligne « var KEY=\"…\" »");
  assert.ok(hote, "aucune ligne « var RD_HOST = \"…\" »");
  assert.equal(cle.m[1], VALEURS.cle);
  assert.equal(hote.m[1], VALEURS.domaine);
  assert.match(cle.l, /^\s*var KEY="/, "la premiere occurrence doit etre la declaration, pas un commentaire");
  assert.match(hote.l, /^\s*var RD_HOST *= *"/, "la premiere occurrence doit etre la declaration");
});

test("forbidden-strings : les chaines que la CI refuse dans la page", () => {
  assert.ok(!html.includes("id_ed25519.pub"), "id_ed25519.pub : cette commande ne peut pas fonctionner");
  assert.ok(!html.includes("docker exec hbbs"), "docker exec hbbs : l'image n'a pas de shell");
});

test("window-contracts-present : les symboles partages entre blocs sont definis", () => {
  const definis = ["RD", "__rdBar", "__rdHud", "__rdActive", "__rdFit", "__rdNegotiate",
                   "__rdMenu", "__rdReprise", "__rdEtait", "RDFT"];
  for (const nom of definis) {
    assert.match(html, new RegExp(`window\\.${nom}\\s*=(?!=)`), `window.${nom} n'est plus defini`);
  }
  // __rdUnzstd est injecte dans le bundle par le patch 5, pas par la page.
  assert.match(lire(path.join(RACINE, "scripts", "patch-assets.sh")), /window\.__rdUnzstd=/);
  // Le bloc principal garde un alias « var RD = window.RD » : reaffecter
  // window.RD ailleurs le rendrait perime en silence.
  assert.equal((html.match(/window\.RD\s*=(?!=)/g) || []).length, 1, "window.RD reaffecte");
});

test("window-contracts-runtime : ce qui est defini au chargement l'est vraiment", () => {
  const bac = creerBac();
  bac.executer(blocs(html));
  const w = bac.window;
  assert.equal(typeof w.RD, "object");
  assert.equal(typeof w.RDFT, "object");
  for (const f of ["__rdReprise", "__rdActive", "__rdFit", "__rdNegotiate", "__rdPct", "onGlobalEvent", "onRgba"]) {
    assert.equal(typeof w[f], "function", `window.${f} devrait etre une fonction`);
  }
});

test("bar-children-direct : le greffon fichiers et le presse-papier visent les enfants directs", () => {
  // Le bloc fichiers fait bar.insertBefore(b, bar.querySelector("button.quit")) :
  // insertBefore leve NotFoundError si la reference n'est pas un enfant DIRECT.
  // Toute evolution de la barre (poignee, conteneur) doit donc garder les
  // controles a plat.
  assert.match(html, /var q = bar\.querySelector\("button\.quit"\);\s*\n\s*if \(q\) bar\.insertBefore\(b, q\)/);
  assert.match(html, /bar\.insertBefore\(b, bar\.firstChild\)/);
  assert.match(html, /\[sel,fit,qual,fps,cod,swp,quit\]\.forEach\(function\(x\)\{ bar\.appendChild\(x\); \}\)/);
});

test("hud-sibling-rule : la regle #rdbar:hover ~ #rdhud reste valable", () => {
  assert.match(html, /#rdbar:hover ~ #rdhud/);
  const iBar = html.indexOf("document.body.appendChild(bar)");
  const iHud = html.indexOf("document.body.appendChild(hud)");
  assert.ok(iBar > 0 && iHud > iBar, "la barre doit etre ajoutee AVANT le HUD dans body");
});

// -------------------------------------------------------------- stockage
test("B1-storage-trim-quota-peers : surcharge de Storage.prototype (caracterisation)", () => {
  const bac = creerBac();
  bac.executer([blocs(html)[0]]);
  const ls = bac.stockage;

  // Les quatre cles d'identite sont rognees a l'ecriture ET a la lecture.
  ls.setItem("id", "  123 456  ");
  assert.equal(ls.getItem("id"), "123 456");
  ls.setItem("autre", "  garde  ");
  assert.equal(ls.getItem("autre"), "  garde  ", "seules quatre cles sont rognees");

  // Un quota depasse ne leve JAMAIS vers l'appelant : l'ecriture est perdue.
  ls.quota = 5;
  assert.doesNotThrow(() => ls.setItem("rd-test", "x".repeat(50)));
  assert.equal(ls.getItem("rd-test"), null, "l'ecriture perdue ne laisse rien — seule une relecture le voit");

  // « peers » a un traitement propre : on elague « info », on garde le mot de passe.
  ls.quota = null;
  ls.quota = 400;
  const pairs = { "111": { info: "i".repeat(600), password: "secret", tm: 1 } };
  ls.setItem("peers", JSON.stringify(pairs));
  const reste = JSON.parse(ls.getItem("peers"));
  assert.equal(reste["111"].password, "secret", "le mot de passe memorise doit survivre au quota");
  assert.equal(reste["111"].info, undefined, "info est le champ sacrifie");
});

test("pristine-tarball-unchanged : l'empreinte de l'archive n'a pas bouge", () => {
  const attendu = lire(path.join(RACINE, "assets", "SHA256SUMS")).trim().split(/\s+/)[0];
  const reel = crypto.createHash("sha256").update(fs.readFileSync(TARBALL)).digest("hex");
  assert.equal(reel, attendu, "l'archive a change : SHA256SUMS et --verify-provenance divergent");
});

// ----------------------------------------------------------------- patch 5
const ANCRE_S3 = "async function S3(u){const e=1024*1024*64";
let tarOk = true;
try { execFileSync("tar", ["--version"], { stdio: "ignore" }); } catch { tarOk = false; }

test("patch5-anchor-once : l'ancre du patch 5 est unique dans le bundle d'origine", { skip: !tarOk && "tar absent" }, () => {
  const orig = execFileSync("tar", ["-xzOf", TARBALL, "./js/dist/index.js"], { maxBuffer: 64 * MIO }).toString("utf8");
  assert.equal(orig.split(ANCRE_S3).length - 1, 1, "l'ancre S3 doit apparaitre exactement une fois");
  assert.ok(lire(path.join(RACINE, "scripts", "patch-assets.sh")).includes(ANCRE_S3),
    "patch-assets.sh n'utilise plus la meme ancre");
});

// ------------------------------------------- tests qui exigent html/js/dist
const vendorOk = fs.existsSync(VENDOR) && fs.existsSync(BUNDLE);
function avecVendor(nom, fn) {
  if (vendorOk) return test(nom, fn);
  if (EXIGE_VENDOR) {
    return test(nom, () => assert.fail("html/js/dist/ absent — lancer ./scripts/extract-assets.sh && ./scripts/patch-assets.sh"));
  }
  return test(nom, { skip: "html/js/dist/ absent (extract-assets.sh + patch-assets.sh, ou --require-vendor pour exiger)" }, fn);
}

avecVendor("patched-bundle-parses-as-esm : le bundle patche reste un module valide", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rdbundle-"));
  try {
    const f = path.join(tmp, "index.mjs");
    fs.copyFileSync(BUNDLE, f);
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// Le vrai decodeur zstd du bundle : la classe « Q » de vendor.js, extraite
// telle quelle (wasm base64 compris). Aucun compresseur n'est necessaire : on
// fabrique les trames a la main.
function chargerDecodeur() {
  const s = lire(VENDOR);
  const a = s.indexOf("let A,I,B;const g=");
  const i = s.indexOf("class Q{init(){");
  const j = s.indexOf('const C="', i);
  const k = j < 0 ? -1 : s.indexOf('";', j) + 2;
  if (a < 0 || i < 0 || j < 0 || k < 2) throw new Error("decodeur zstd introuvable dans vendor.js");
  return new Function(s.slice(a, k) + "\nreturn Q;")();
}

// Trame zstd valide, faite main : magic, descripteur (Single_Segment, FCS sur
// 4 octets), puis des blocs RLE de 128 Kio (le maximum d'un bloc). 14 Mio de
// pixels identiques tiennent dans ~450 octets — un taux de compression de
// plus de 30 000x, ce que produit une capture d'ecran a fonds unis.
function trameRLE(total, octet = 0x20) {
  const BLOC = 128 * 1024;
  const o = [0x28, 0xb5, 0x2f, 0xfd, 0xa0,
             total & 255, (total >>> 8) & 255, (total >>> 16) & 255, (total >>> 24) & 255];
  for (let reste = total; reste > 0;) {
    const n = Math.min(reste, BLOC); reste -= n;
    const h = (reste === 0 ? 1 : 0) | (1 << 1) | (n << 3);        // bloc RLE
    o.push(h & 255, (h >>> 8) & 255, (h >>> 16) & 255, octet);
  }
  return Uint8Array.from(o);
}

// Copie exacte de S3() dans js/dist/index.js : tampon = 30 x taille compressee,
// borne entre 1 Mio et 64 Mio.
const tamponS3 = (n) => Math.min(64 * MIO, Math.max(MIO, 30 * n));

avecVendor("caracterisation zstd : la formule de tampon du bundle rend un resultat VIDE, sans erreur", async () => {
  const Q = chargerDecodeur();
  const dec = new Q(); await dec.init();

  // Un RGBA plat de 2 Mio (1024 x 512 x 4) : ~25 octets compresses, donc un
  // tampon de 1 Mio (le plancher) — trop petit de moitie.
  const trame = trameRLE(2 * MIO);
  assert.ok(trame.length < 100);
  const out = dec.decode(trame, tamponS3(trame.length));
  assert.equal(out.length, 0,
    "le decodeur ne leve pas : il renvoie un tableau vide (truthy), que « if(!o) continue » du bundle ne detecte pas");
  assert.ok(out instanceof Uint8Array);

  // La taille declaree dans l'en-tete de trame, elle, decode correctement.
  const bon = dec.decode(trame, 0);
  assert.equal(bon.length, 2 * MIO);
  assert.equal(bon[0], 0x20); assert.equal(bon[bon.length - 1], 0x20);

  // Une image de 14 Mio (2560 x 1440 x 4 : un ecran) : taux > 30 000x.
  const grande = trameRLE(14 * MIO);
  assert.ok(grande.length < 1024);
  assert.equal(dec.decode(grande, tamponS3(grande.length)).length, 0);
  assert.equal(dec.decode(grande, 0).length, 14 * MIO);
});

avecVendor("caracterisation zstd : un tampon suffisant decode ; une trame corrompue rend aussi un resultat vide", async () => {
  const Q = chargerDecodeur();
  const dec = new Q(); await dec.init();
  const trame = trameRLE(64 * 1024);                    // 64 Kio < plancher de 1 Mio
  assert.equal(dec.decode(trame, tamponS3(trame.length)).length, 64 * 1024);

  const abimee = trameRLE(64 * 1024); abimee[0] = 0;    // magic invalide
  assert.equal(dec.decode(abimee, MIO).length, 0,
    "une trame corrompue ne leve pas non plus : « resultat vide » ne veut donc JAMAIS dire « contenu vide »");
});
