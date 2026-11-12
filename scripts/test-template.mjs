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
// Le gabarit est assemble depuis web/src/ : le banc teste TOUJOURS les sources
// courantes, jamais un gabarit reste d'un assemblage precedent.
execFileSync("python3", [path.join(RACINE, "scripts", "build-page.py")], { stdio: "pipe" });
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
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    insertBefore(c) { this.children.unshift(c); c.parent = this; return c; },
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
    constructor(u) { this.url = u; this.readyState = 0; this.ecouteurs = {}; }
    addEventListener(t, f) { (this.ecouteurs[t] ||= []).push(f); }
    emettre(t, ev) { (this.ecouteurs[t] || []).forEach((f) => f(ev)); }
    send() {} close() {}
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
  // Execute les setTimeout a delai NUL poses depuis le repere (les minuteurs
  // du chargement, et les delais longs des retours, ne sont jamais joues).
  const tick = (repere) => {
    const dus = minuteurs.slice(repere).filter((t) => t.once && t.ms === 0);
    dus.forEach((t) => t.f());
    return dus.length;
  };
  return { window: bac, ctx, minuteurs, executer, tick, document, stockage: bac.localStorage };
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
  assert.match(html, /\[sel,fit,qual,fps,cod,swp,ecr,act,clav,plein,quit\]\.forEach\(function\(x\)\{ bar\.appendChild\(x\); \}\)/);
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

avecVendor("patched-bundle-exposes-zstd-decoder : __rdUnzstd inchange, __rdZstdDecoder ajoute apres u4/w3", () => {
  const b = lire(BUNDLE);
  const iU = b.indexOf("window.__rdUnzstd=(u)=>S3(u);");
  const iD = b.indexOf("window.__rdZstdDecoder=async()=>(u4||await w3(),u4);");
  assert.ok(iU > 0, "__rdUnzstd (utilise par le transfert de fichiers) a disparu ou a change");
  assert.ok(iD > iU, "__rdZstdDecoder absent ou mal place");
  // u4 et w3 doivent etre declares AVANT le point d'insertion, dans la meme portee de module.
  assert.ok(b.indexOf("let u4;async function w3(){") > 0 && b.indexOf("let u4;async function w3(){") < iD,
    "u4/w3 ne sont plus declares avant le point d'insertion");
  assert.equal(b.split("window.__rdZstdDecoder=").length - 1, 1, "patch applique deux fois");
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

// ====================================================================
// RDLib — la logique pure. Chargee seule, dans un contexte VIDE : si le bloc
// touche au DOM ou a une globale, il leve ici.
// ====================================================================
const blocLib = blocs(html).find((b) => b.includes("window.RDLib ="));

function chargerLib() {
  const w = {};
  const ctx = vm.createContext({ window: w });
  new vm.Script(blocLib, { filename: "rdlib.js" }).runInContext(ctx);
  return w.RDLib;
}
// Les objets nes dans un contexte vm ont un autre prototype : deepStrictEqual
// les refuserait. On compare donc leur forme JSON.
const plat = (x) => JSON.parse(JSON.stringify(x));

// Un stockage minimal. avale : ecrit sans rien retenir (la surcharge de B1
// avale toute erreur) ; leve : getItem/setItem levent.
function stock({ avale = false, leve = false, init = {} } = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem(k) { if (leve) throw new Error("stockage refuse"); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (leve) throw new Error("stockage refuse"); if (!avale) m.set(k, String(v)); },
    removeItem(k) { if (leve) throw new Error("stockage refuse"); m.delete(k); },
  };
}

test("rdlib-block-is-dom-free : le bloc se charge dans un contexte vide", () => {
  assert.ok(blocLib, "bloc RDLib introuvable");
  const lib = chargerLib();
  assert.equal(lib.v, 1);
  assert.ok(!/\bdocument\./.test(blocLib), "RDLib ne doit pas toucher au document");
  assert.ok(!/__RD_/.test(blocLib), "RDLib ne doit contenir aucun __RD_* : sed le substituerait");
  assert.ok(!/var KEY="/.test(blocLib) && !/var RD_HOST/.test(blocLib),
    "relay-doctor.sh lit la premiere occurrence de ces lignes");
});

test("ids : isPeerId / normId / fmtId", () => {
  const L = chargerLib();
  assert.equal(L.normId("123 456 789"), "123456789");
  assert.equal(L.normId("  123456  "), "123456");
  assert.equal(L.normId("12345"), null, "cinq chiffres : trop court");
  assert.equal(L.normId("12 3 4 5"), null, "huit caracteres mais cinq chiffres");
  assert.equal(L.normId("abc123456"), null);
  assert.equal(L.normId("<img src=x onerror=alert(1)>"), null);
  assert.equal(L.normId(null), null);
  assert.equal(L.normId(123456789), null, "seules les chaines sont des ID");
  assert.equal(L.isPeerId("123 456 789"), true);
  assert.equal(L.isPeerId("root@example"), false);
  assert.equal(L.fmtId("123456789"), "123 456 789");
  assert.equal(L.fmtId("1234567890"), "123 456 789 0");
  assert.equal(L.fmtId("nope"), "");
});

test("every-ERR-has-message : chaque code d'erreur a un texte francais", () => {
  const L = chargerLib();
  for (const code of Object.keys(L.clip.ERR)) {
    assert.equal(typeof L.messages[code], "string", `pas de message pour ${code}`);
    assert.ok(L.messages[code].length > 10);
  }
});

// -------------------------------------------------------------------- clip
test("select-splits-image-html-text : une entree par usage, PNG avant RGBA, rien de decode", () => {
  const { clip } = chargerLib();
  const cb = (format, n = 1) => ({ format, content: new Uint8Array(n) });
  const r = clip.select([cb(0), cb(2), cb(21), cb(22)]);
  assert.equal(r.image.kind, "png");
  assert.equal(r.image.cb.format, 22);
  assert.equal(r.html.format, 2);
  assert.equal(r.text.format, 0);
  assert.equal(clip.select([cb(21)]).image.kind, "rgba");
  const vide = clip.select([]);
  assert.equal(vide.image, null); assert.equal(vide.html, null); assert.equal(vide.text, null);
  assert.equal(clip.select(undefined).image, null);
});

test("slots-image-survives-text / slots-replace-same-kind", () => {
  const { clip } = chargerLib();
  const s = clip.slots();
  s.put("image", { n: 1 }); s.put("text", { n: 2 });
  assert.deepEqual(plat(s.kinds()), ["image", "text"]);
  assert.equal(s.get("image").n, 1, "un texte ne doit pas effacer l'image");
  s.put("image", { n: 3 });
  assert.equal(s.get("image").n, 3, "meme usage : remplace");
  assert.deepEqual(plat(s.kinds()), ["image", "text"], "l'ordre ne change pas");
  assert.equal(s.take("image").n, 3);
  assert.equal(s.get("image"), null);
  assert.deepEqual(plat(s.kinds()), ["text"]);
  assert.equal(s.take("absent"), null);
});

test("describe-logs-format-compress-sizes : la ligne dit ce que le pair envoie", () => {
  const { clip } = chargerLib();
  const l = clip.describe({ format: 21, compress: true, content: new Uint8Array(500), width: 1920, height: 1080 }, 8294400);
  assert.match(l, /format 21 \(rgba\)/);
  assert.match(l, /compress=oui/);
  assert.match(l, /500 o recus -> 8294400 o bruts/);
  assert.match(l, /1920x1080/);
  assert.match(clip.describe({ format: 22, compress: false, content: new Uint8Array(3) }), /format 22 \(png\), compress=non/);
});

// Trames zstd faites main. « sans taille » : descripteur 0x00 et octet de
// fenetre, donc aucun champ Frame_Content_Size — le cas ou seule l'indication
// de l'appelant, ou un doublement, permet de dimensionner la destination.
function trameSansTaille(total, octet = 0x20) {
  const o = [0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x40];
  for (let reste = total; reste > 0;) {
    const n = Math.min(reste, 128 * 1024); reste -= n;
    const h = (reste === 0 ? 1 : 0) | (1 << 1) | (n << 3);
    o.push(h & 255, (h >>> 8) & 255, (h >>> 16) & 255, octet);
  }
  return Uint8Array.from(o);
}
// Un decodeur factice : rend une sortie pleine si la destination suffit, vide
// sinon — exactement ce que fait le vrai — et note les tailles demandees.
function decodeurFactice(besoin, { asynchrone = false } = {}) {
  const appels = [];
  return {
    appels,
    decode(u8, taille) {
      appels.push(taille);
      const r = taille >= besoin ? new Uint8Array(besoin).fill(7) : new Uint8Array(0);
      return asynchrone ? Promise.resolve(r) : r;
    },
  };
}

test("zstdContentSize : lit la taille dans l'en-tete, sans decodeur", () => {
  const { clip } = chargerLib();
  assert.equal(clip.zstdContentSize(trameRLE(2 * MIO)), 2 * MIO);
  assert.equal(clip.zstdContentSize(trameRLE(14 * MIO)), 14 * MIO);
  assert.equal(clip.zstdContentSize(trameSansTaille(1000)), null, "pas de champ taille");
  const abimee = trameRLE(1000); abimee[0] = 0;
  assert.equal(clip.zstdContentSize(abimee), null, "magic invalide");
  assert.equal(clip.zstdContentSize(new Uint8Array(3)), null);
  assert.equal(clip.zstdContentSize(null), null);
});

test("zstdContentSize-all-fcs-widths : les quatre largeurs du champ taille", () => {
  const { clip } = chargerLib();
  const trame = (desc, fcs) => Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, desc, ...fcs, 0x01, 0x00, 0x00, 0x20]);
  // Single_Segment, champ de 1 octet : la valeur telle quelle.
  assert.equal(clip.zstdContentSize(trame(0x20, [200])), 200);
  // Champ de 2 octets : la valeur est stockee moins 256.
  assert.equal(clip.zstdContentSize(trame(0x60, [0xe8, 0x02])), 1000);
  // Champ de 4 octets.
  assert.equal(clip.zstdContentSize(trame(0xa0, [0x00, 0x00, 0x30, 0x00])), 3 * MIO);
  // Champ de 8 octets, valeur au-dela de 32 bits.
  assert.equal(clip.zstdContentSize(trame(0xe0, [0, 0, 0, 0, 1, 0, 0, 0])), 4294967296);
  // Hors fenetre unique : un octet de fenetre precede le champ.
  assert.equal(clip.zstdContentSize(trame(0x80, [0x40, 0x00, 0x00, 0x20, 0x00])), 2 * MIO);
  // Champ tronque : pas de lecture au-dela de la trame.
  assert.equal(clip.zstdContentSize(Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0xa0, 0x01])), null);
});

test("decompress-header-size : la taille de l'en-tete est essayee en premier, et seule", async () => {
  const { clip } = chargerLib();
  const dec = decodeurFactice(3 * MIO);
  const out = await clip.decompress(dec, trameRLE(3 * MIO));
  assert.equal(out.length, 3 * MIO);
  assert.deepEqual(plat(dec.appels), [3 * MIO]);
});

test("decompress-hint : sans taille dans la trame, l'indication de l'appelant passe d'abord", async () => {
  const { clip } = chargerLib();
  const dec = decodeurFactice(5 * MIO);
  const out = await clip.decompress(dec, trameSansTaille(1000), { hint: 5 * MIO });
  assert.equal(out.length, 5 * MIO);
  assert.equal(dec.appels[0], 5 * MIO);
  assert.equal(dec.appels.length, 1);
});

test("decompress-doubling : sans taille ni indication, la destination double jusqu'a suffire", async () => {
  const { clip } = chargerLib();
  const dec = decodeurFactice(5 * MIO);
  const out = await clip.decompress(dec, trameSansTaille(1000));
  assert.equal(out.length, 5 * MIO);
  assert.deepEqual(plat(dec.appels), [MIO, 2 * MIO, 4 * MIO, 8 * MIO]);
});

test("decompress-corrupt-is-error : un decodeur qui rend du vide, toujours, leve", async () => {
  const { clip } = chargerLib();
  const dec = { decode() { return new Uint8Array(0); } };
  await assert.rejects(clip.decompress(dec, trameRLE(64)), (e) => e.name === "ClipError" && e.code === "DECODE");
  await assert.rejects(clip.decompress(dec, trameSansTaille(64)), (e) => e.code === "DECODE");
});

test("decompress-undefined-is-error : l'ancien S3 rend undefined ; ca leve aussi", async () => {
  const { clip } = chargerLib();
  await assert.rejects(clip.decompress({ decode() { return undefined; } }, trameSansTaille(64)),
    (e) => e.code === "DECODE");
  await assert.rejects(clip.decompress({ decode() { throw new Error("wasm"); } }, trameSansTaille(64)),
    (e) => e.code === "DECODE" && /wasm/.test(e.detail));
  await assert.rejects(clip.decompress({ decode() { return new Uint8Array(1); } }, new Uint8Array(0)),
    (e) => e.code === "DECODE", "entree vide");
});

test("decompress-over-max : une taille declaree au-dela de la limite est refusee sans decoder", async () => {
  const { clip } = chargerLib();
  const dec = decodeurFactice(1);
  await assert.rejects(clip.decompress(dec, trameRLE(3 * MIO), { max: 2 * MIO }),
    (e) => e.code === "TOO_BIG");
  assert.equal(dec.appels.length, 0);
  // Et sans taille declaree, le doublement s'arrete a la limite.
  const dec2 = decodeurFactice(1000 * MIO);
  await assert.rejects(clip.decompress(dec2, trameSansTaille(64), { max: 4 * MIO }), (e) => e.code === "DECODE");
  assert.equal(Math.max(...dec2.appels), 4 * MIO);
});

test("decompress-unique : un decodeur de repli qui ignore la taille n'est essaye qu'une fois", async () => {
  const { clip } = chargerLib();
  let n = 0;
  await assert.rejects(clip.decompress({ unique: true, decode() { n++; return undefined; } }, trameSansTaille(64)),
    (e) => e.code === "DECODE");
  assert.equal(n, 1);
});

test("decompress : un decodeur asynchrone est accepte", async () => {
  const { clip } = chargerLib();
  const out = await clip.decompress(decodeurFactice(2 * MIO, { asynchrone: true }), trameRLE(2 * MIO));
  assert.equal(out.length, 2 * MIO);
});

test("rgba-short-buffer-error / rgba-dims-invalid", () => {
  const { clip } = chargerLib();
  const ok = clip.rgbaPixels(new Uint8Array(4 * 4 * 4), 4, 4);
  assert.equal(ok.length, 64);
  assert.equal(ok.constructor.name, "Uint8ClampedArray");
  assert.equal(clip.rgbaPixels(new Uint8Array(100), 4, 4).length, 64, "un tampon trop long est tronque");
  assert.throws(() => clip.rgbaPixels(new Uint8Array(10), 4, 4), (e) => e.code === "SHORT");
  assert.throws(() => clip.rgbaPixels(new Uint8Array(0), 4, 4), (e) => e.code === "SHORT");
  for (const [w, h] of [[0, 4], [4, 0], [-1, 4], [1.5, 4], [NaN, 4], [20000, 2]]) {
    assert.throws(() => clip.rgbaPixels(new Uint8Array(64), w, h), (e) => e.code === "DIMS", `${w}x${h}`);
  }
  assert.throws(() => clip.rgbaPixels(new Uint8Array(64), 16384, 16384), (e) => e.code === "TOO_BIG");
});

test("precheck / nextScale-monotone-terminates", () => {
  const { clip } = chargerLib();
  assert.equal(clip.precheck(1024), true);
  assert.throws(() => clip.precheck(clip.LIM.SRC_MAX + 1), (e) => e.code === "TOO_BIG");
  const lim = 8 * MIO;
  assert.deepEqual(plat(clip.nextScale(1000, 800, lim, lim)), { w: 1000, h: 800 }, "deja sous la limite");
  // Toute suite d'applications se termine, et les dimensions decroissent strictement.
  for (const [w, h, o] of [[4000, 3000, 40 * MIO], [800, 600, 9 * MIO], [10000, 200, 100 * MIO], [90, 90, 20 * MIO]]) {
    let cw = w, ch = h, prec = Infinity, n = 0;
    for (;;) {
      const r = clip.nextScale(cw, ch, o * (cw * ch) / (w * h), lim);
      if (r === null) break;
      if (r.w === cw && r.h === ch) break;                       // passe : plus rien a faire
      assert.ok(r.w * r.h < prec, "les dimensions doivent decroitre");
      prec = r.w * r.h; cw = r.w; ch = r.h;
      assert.ok(++n < 50, "doit se terminer");
    }
  }
  assert.equal(clip.nextScale(100, 100, 100 * MIO, lim), null, "on ne descend pas sous 64 px");
});

test("pasteDelay-clamped-monotone-override", () => {
  const { clip } = chargerLib();
  assert.equal(clip.pasteDelayMs(0), 150, "un texte garde l'ancien delai");
  assert.equal(clip.pasteDelayMs(500 * 1024), 150);
  assert.equal(clip.pasteDelayMs(3 * MIO), 900);
  assert.equal(clip.pasteDelayMs(64 * MIO), 2500, "plafonne");
  let p = 0;
  for (const o of [0, MIO, 2 * MIO, 5 * MIO, 9 * MIO, 30 * MIO]) {
    const d = clip.pasteDelayMs(o); assert.ok(d >= p); p = d;
  }
  assert.equal(clip.pasteDelayMs(50 * MIO, 400), 400, "forcable");
  assert.equal(clip.pasteDelayMs(MIO, 999999), 10000);
  assert.equal(clip.pasteDelayMs(MIO, -5), 400, "une valeur invalide est ignoree");
  assert.equal(clip.pasteDelayMs(undefined), 150);
});

test("peerSupportsMulti : vrai, faux, ou inconnu", () => {
  const { clip } = chargerLib();
  assert.equal(clip.peerSupportsMulti("1.2.9"), false);
  assert.equal(clip.peerSupportsMulti("1.3.0"), true);
  assert.equal(clip.peerSupportsMulti("1.4.2-nightly"), true);
  assert.equal(clip.peerSupportsMulti("2.0"), true);
  assert.equal(clip.peerSupportsMulti("0.9"), false);
  assert.equal(clip.peerSupportsMulti(""), null);
  assert.equal(clip.peerSupportsMulti("x"), null);
  assert.equal(clip.peerSupportsMulti(undefined), null);
  assert.equal(clip.peerSupportsMulti(null), null);
});

test("pasteAccepte : canvas toujours, corps de page seulement en session, jamais un champ", () => {
  const { clip } = chargerLib();
  const p = (cible, enSession) => clip.pasteAccepte({ cible, enSession });
  assert.equal(p("canvas", false), true);
  assert.equal(p("canvas", true), true);
  assert.equal(p("body", true), true);
  assert.equal(p("body", false), false);
  assert.equal(p("champ", true), false);
  assert.equal(p("autre", true), false);
  assert.equal(clip.pasteAccepte(null), false);
  assert.equal(clip.pasteAccepte({}), false);
});

test("isPasteChord : latin, cyrillique, Dvorak, alt", () => {
  const { clip } = chargerLib();
  const c = (o) => clip.isPasteChord(o);
  assert.equal(c({ key: "v", code: "KeyV", ctrlKey: true }), true);
  assert.equal(c({ key: "V", code: "KeyV", metaKey: true, shiftKey: true }), true);
  assert.equal(c({ key: "м", code: "KeyV", ctrlKey: true }), true, "cyrillique : le navigateur colle sur la touche physique");
  assert.equal(c({ key: "k", code: "KeyV", ctrlKey: true }), false, "Dvorak : ce n'est pas un v");
  assert.equal(c({ key: "v", code: "Period", ctrlKey: true }), true, "Dvorak : le v est ailleurs");
  assert.equal(c({ key: "v", code: "KeyV", ctrlKey: true, altKey: true }), false, "alt exclu");
  assert.equal(c({ key: "v", code: "KeyV" }), false, "sans modificateur");
  assert.equal(c({ key: "c", code: "KeyC", ctrlKey: true }), false);
  assert.equal(c(null), false);
});

avecVendor("regression-14MiB-flat : le vrai decodeur, une image que l'ancienne formule perdait", async () => {
  const Q = chargerDecodeur();
  const wasm = new Q(); await wasm.init();
  const { clip } = chargerLib();
  // Ce que le bundle faisait : un tableau vide, sans erreur (voir plus haut).
  const trame = trameRLE(14 * MIO);
  assert.equal(wasm.decode(trame, tamponS3(trame.length)).length, 0);
  // Ce que fait clip.decompress : l'image entiere, par la taille de l'en-tete.
  const out = await clip.decompress(wasm, trame);
  assert.equal(out.length, 14 * MIO);
  assert.equal(out[0], 0x20); assert.equal(out[out.length - 1], 0x20);
  // Sans taille dans la trame, avec l'indication w*h*4 de l'appelant.
  const sans = trameSansTaille(2 * MIO);
  const out2 = await clip.decompress(wasm, sans, { hint: 2 * MIO });
  assert.equal(out2.length, 2 * MIO);
  // Sans rien : le doublement retrouve la bonne taille.
  const out3 = await clip.decompress(wasm, trameSansTaille(5 * MIO));
  assert.equal(out3.length, 5 * MIO);
  // Corrompue : une erreur, pas un contenu vide.
  const abimee = trameRLE(64 * 1024); abimee[0] = 0;
  await assert.rejects(clip.decompress(wasm, abimee), (e) => e.code === "DECODE");
});

// ---------------------------------------------------------------- reglages
test("prefs-roundtrip : ecrire, relire, valeurs valides seulement", () => {
  const { prefs } = chargerLib();
  const s = stock();
  const p = prefs.create(s);
  assert.deepEqual(plat(p.get()), {});
  assert.equal(p.set({ quality: "best", fps: 60, codec: "vp9", bar: "ouverte", hint: true }), true);
  assert.deepEqual(plat(prefs.create(s).get()), { quality: "best", fps: 60, codec: "vp9", bar: "ouverte", hint: true });
  assert.equal(p.set({ quality: "nimporte", fps: 999, codec: "divx", bar: "x", inconnu: 1 }), true);
  assert.deepEqual(plat(p.get()), { quality: "best", fps: 60, codec: "vp9", bar: "ouverte", hint: true },
    "les valeurs invalides sont ignorees, les anciennes gardees");
  assert.equal(p.set({ fps: "15" }), true);
  assert.equal(p.get().fps, 15, "un nombre en chaine est accepte");
  p.set({ quality: null });
  assert.equal(p.get().quality, undefined, "null retire une valeur");
  assert.equal(p.reset(), true);
  assert.deepEqual(plat(p.get()), {});
  assert.equal(s.m.has("rd-prefs"), false);
});

test("prefs-corrupt-json : du JSON invalide, une autre version, un autre type", () => {
  const { prefs } = chargerLib();
  for (const brut of ["{pas du json", "null", "42", '"chaine"', "[]", '{"v":2,"quality":"best"}', '{"quality":"best"}']) {
    const p = prefs.create(stock({ init: { "rd-prefs": brut } }));
    assert.deepEqual(plat(p.get()), {}, `entree : ${brut}`);
  }
});

test("prefs-proto-pollution : __proto__ et cles inconnues ne passent pas", () => {
  const { prefs } = chargerLib();
  const s = stock({ init: { "rd-prefs": '{"v":1,"__proto__":{"pollue":1},"constructor":{"x":1},"quality":"low","admin":true}' } });
  const p = prefs.create(s);
  assert.deepEqual(plat(p.get()), { quality: "low" });
  assert.equal({}.pollue, undefined);
  p.set(JSON.parse('{"__proto__":{"pollue":2},"codec":"h265"}'));
  assert.equal({}.pollue, undefined);
  assert.deepEqual(plat(p.get()), { quality: "low", codec: "h265" });
});

test("prefs-quota-swallowed-readback : une ecriture avalee est detectee, la page continue", () => {
  const { prefs } = chargerLib();
  const p = prefs.create(stock({ avale: true }));
  assert.equal(p.set({ quality: "best" }), false, "la relecture ne retrouve rien : l'ecriture n'a pas tenu");
  assert.equal(p.get().quality, "best", "mais la copie en memoire sert la page");
  p.set({ fps: 30 });
  assert.deepEqual(plat(p.get()), { quality: "best", fps: 30 });
});

test("prefs-throwing-storage : un stockage qui leve ne fait jamais lever la page", () => {
  const { prefs } = chargerLib();
  const p = prefs.create(stock({ leve: true }));
  assert.deepEqual(plat(p.get()), {});
  assert.equal(p.set({ codec: "auto" }), false);
  assert.equal(p.get().codec, "auto");
  assert.equal(p.reset(), false);
});

// -------------------------------------------------------- dernieres connexions
function horloge(depart = 1000) { let t = depart; return () => t++; }

test("recent-mru-dedupe-spaces : le plus recent d'abord, espaces ignores", () => {
  const { recent } = chargerLib();
  const r = recent.create(stock(), { now: horloge() });
  assert.equal(r.add("111 111 111"), true);
  assert.equal(r.add("222222222"), true);
  assert.equal(r.add("111111111"), true, "meme ID sans espaces : deplace en tete");
  assert.deepEqual(plat(r.list().map((e) => e.id)), ["111111111", "222222222"]);
});

test("cap-10 : dix entrees au plus, les plus anciennes tombent", () => {
  const { recent } = chargerLib();
  const r = recent.create(stock(), { now: horloge() });
  for (let i = 0; i < 12; i++) r.add(String(100000000 + i));
  const l = r.list();
  assert.equal(l.length, 10);
  assert.equal(l[0].id, "100000011");
  assert.equal(l[9].id, "100000002");
});

test("invalid-ids-rejected : lettres, trop court, HTML, types etrangers", () => {
  const { recent } = chargerLib();
  const s = stock();
  const r = recent.create(s);
  for (const mauvais of ["abc", "12345", "12 3 4 5", "<img src=x onerror=alert(1)>", "", null, undefined, {}, 123456789, "1e9999999"]) {
    assert.equal(r.add(mauvais), false, String(mauvais));
  }
  assert.equal(r.list().length, 0);
  assert.equal(s.m.has("rd-recent"), false, "un refus n'ecrit rien");
});

test("seed-once-ordered-by-tm : amorcage unique depuis peers et le dernier ID", () => {
  const { recent } = chargerLib();
  const s = stock();
  const peers = JSON.stringify({
    "111111111": { tm: 100, password: "secret1", info: "X" },
    "222222222": { tm: 300, password: "secret2" },
    "333333333": { tm: 200 },
    "pas-un-id": { tm: 999 },
    "444444444": {},                                   // pas de tm : ignore
  });
  const r = recent.create(s, { now: horloge(5000) });
  assert.equal(r.seedFrom(peers, "555 555 555", "999999999"), 4);
  assert.deepEqual(plat(r.list().map((e) => e.id)), ["555555555", "222222222", "333333333", "111111111"]);
  // Une seconde fois : rien, la cle existe.
  assert.equal(recent.create(s).seedFrom(peers, "666666666", ""), 0);
  assert.equal(r.list().length, 4);
});

test("seed : le dernier ID n'est pas amorce s'il est l'ID par defaut du deploiement", () => {
  const { recent } = chargerLib();
  const r = recent.create(stock());
  assert.equal(r.seedFrom("{}", "123 456 789", "123456789"), 0);
  assert.equal(r.list().length, 0);
});

test("remove-sticks-after-seed : un ID retire ne revient pas au chargement suivant", () => {
  const { recent } = chargerLib();
  const s = stock();
  const peers = { "111111111": { tm: 1 }, "222222222": { tm: 2 } };
  recent.create(s).seedFrom(peers, "", "");
  assert.equal(recent.create(s).remove("222 222 222"), true);
  const suivante = recent.create(s);
  assert.equal(suivante.seedFrom(peers, "", ""), 0, "la cle existe : pas de reamorcage");
  assert.deepEqual(plat(suivante.list().map((e) => e.id)), ["111111111"]);
  // Vider ne reamorce pas non plus : on ecrit une liste vide, on ne retire pas la cle.
  suivante.clear();
  assert.equal(s.m.has("rd-recent"), true);
  assert.equal(recent.create(s).seedFrom(peers, "333333333", ""), 0);
  assert.equal(recent.create(s).list().length, 0);
});

test("two-instances-no-lost-update : lecture-modification-ecriture, sans cache", () => {
  const { recent } = chargerLib();
  const s = stock();
  const a = recent.create(s, { now: horloge(1) }), b = recent.create(s, { now: horloge(100) });
  a.add("111111111"); b.add("222222222"); a.add("333333333");
  assert.deepEqual(plat(b.list().map((e) => e.id).sort()), ["111111111", "222222222", "333333333"]);
});

test("recent-corrupt-json : un contenu illisible ne fait pas lever, et l'ajout repart propre", () => {
  const { recent } = chargerLib();
  for (const brut of ["{pas du json", "null", '{"v":9,"ids":[]}', '{"v":1,"ids":"non"}', '{"v":1,"ids":[null,{"id":"abc"},{"id":"123456789","t":"x"}]}']) {
    const r = recent.create(stock({ init: { "rd-recent": brut } }));
    assert.doesNotThrow(() => r.list(), brut);
    assert.equal(r.add("987654321"), true);
    assert.equal(r.list()[0].id, "987654321");
  }
});

test("recent-privacy : seulement des identifiants et des horodatages sont ecrits", () => {
  const { recent } = chargerLib();
  const s = stock();
  const r = recent.create(s, { now: horloge() });
  r.seedFrom({ "111111111": { tm: 5, password: "MOTDEPASSE", info: "HOTE", host: "machine.local" } }, "", "");
  r.add("222222222");
  const brut = s.m.get("rd-recent");
  assert.ok(!/MOTDEPASSE|HOTE|machine\.local|password/.test(brut), brut);
  const j = JSON.parse(brut);
  assert.deepEqual(Object.keys(j).sort(), ["ids", "v"]);
  for (const e of j.ids) assert.deepEqual(Object.keys(e).sort(), ["id", "t"]);
});

test("recent-storage-failures : avale -> copie memoire ; qui leve -> jamais de throw", () => {
  const { recent } = chargerLib();
  const a = recent.create(stock({ avale: true }));
  assert.equal(a.add("111111111"), false);
  assert.equal(a.list()[0].id, "111111111", "la page garde sa liste");
  const b = recent.create(stock({ leve: true }));
  assert.doesNotThrow(() => { b.list(); b.add("222222222"); b.remove("222222222"); b.clear(); b.seedFrom("{}", "", ""); });
});


// ====================================================================
// Presse-papier ENTRANT, de bout en bout : le vrai bloc de cablage, le vrai
// decodeur zstd, un DOM fictif. Sans navigateur, on verifie ce qui compte :
// que rien ne bloque msgLoop, qu'une image tres compressible arrive entiere,
// qu'un texte n'efface pas l'image, et que chaque echec se voit.
// ====================================================================
function elementRecord(tag) {
  const e = {
    tag, className: "", attrs: {}, children: [], style: {}, dataset: {},
    textContent: "", title: "", onclick: null,
    classes: new Set(),
    classList: {
      add: (c) => e.classes.add(c), remove: (c) => e.classes.delete(c),
      contains: (c) => e.classes.has(c),
      toggle: (c, f) => { const v = f === undefined ? !e.classes.has(c) : !!f; v ? e.classes.add(c) : e.classes.delete(c); return v; },
    },
    setAttribute(k, v) { e.attrs[k] = v; },
    appendChild(c) { e.children.push(c); c.parent = e; return c; },
    // Comme le vrai DOM : une reference qui n'est pas un enfant DIRECT leve.
    insertBefore(c, ref) {
      let i = ref === null ? e.children.length : 0;      // null : a la fin, comme le vrai DOM
      if (ref) {
        i = e.children.indexOf(ref);
        if (i < 0) { const err = new Error("NotFoundError : la reference n'est pas un enfant de ce noeud"); err.name = "NotFoundError"; throw err; }
      }
      e.children.splice(i, 0, c); c.parent = e; return c;
    },
    get firstChild() { return e.children[0] || null; },
    get parentNode() { return e.parent || null; },
    get nextSibling() { const p = e.parent; if (!p) return null; const i = p.children.indexOf(e); return p.children[i + 1] || null; },
    removeChild(c) { const i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); c.parent = null; return c; },
    remove() { if (e.parent) { const i = e.parent.children.indexOf(e); if (i >= 0) e.parent.children.splice(i, 1); } },
    // Selecteurs simples : « button.quit », « .rdfilesbtn », « .rdppbtn[data-kind="image"] » — sur les enfants directs.
    querySelector(sel) {
      const m = /^(?:(\w+))?(?:\.([\w-]+))?(?:\[data-kind="(\w+)"\])?$/.exec(sel);
      if (!m) return null;
      return e.children.find((c) => (!m[1] || c.tag === m[1]) && (!m[2] || c.className === m[2])
                                    && (!m[3] || (c.attrs && c.attrs["data-kind"] === m[3]))) || null;
    },
    focus() {},
    ecouteurs: {},
    addEventListener(t, f) { (e.ecouteurs[t] ||= []).push(f); },
  };
  if (tag === "canvas") {
    e.getContext = () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData(img) { e.pixels = img.data; },
      drawImage(_b, _x, _y, w, h) { e.dessine = { w, h }; },
    });
    // Un PNG factice : minuscule, ou proportionnel a la surface quand un test
    // veut qu'une image « pese » (ratioPng octets par pixel).
    e.toBlob = (cb) => {
      const n = pngFixe || (ratioPng ? Math.floor(e.width * e.height * ratioPng) : 4);
      cb(new Blob([new Uint8Array(n)], { type: "image/png" }));
    };
  }
  return e;
}
let ratioPng = 0, pngFixe = 0;

async function montageEntrant({ decodeur = "reel", ecriture = "ok" } = {}) {
  const bac = creerBac();
  bac.executer(blocs(html));
  const w = bac.window;
  bac.document.createElement = elementRecord;

  // La barre : seulement ce que ppBouton lui demande.
  const barre = elementRecord("div");
  barre.classes = new Set();
  barre.classList = { add: (c) => barre.classes.add(c), remove: (c) => barre.classes.delete(c),
                      contains: (c) => barre.classes.has(c), toggle() {} };
  barre.querySelector = (sel) => {
    const m = /\[data-kind="(\w+)"\]/.exec(sel);
    return barre.children.find((b) => b.className === "rdppbtn" && (!m || b.attrs["data-kind"] === m[1])) || null;
  };
  w.__rdBar = barre;

  // Le decodeur : le vrai wasm du bundle, avec un espion sur decode().
  const appels = [];
  if (decodeur === "reel") {
    const Q = chargerDecodeur(); const dec = new Q(); await dec.init();
    w.__rdZstdDecoder = async () => ({ decode(u8, n) { appels.push(n); return dec.decode(u8, n); } });
  } else if (decodeur === "ancien") {                   // bundle sans __rdZstdDecoder : S3 tel quel
    const Q = chargerDecodeur(); const dec = new Q(); await dec.init();
    w.__rdUnzstd = async (u8) => dec.decode(u8, tamponS3(u8.length));
  }
  // Le presse-papier du navigateur.
  const ecrits = [];
  w.ClipboardItem = class { constructor(obj) { this.obj = obj; } };
  w.navigator.clipboard = {
    write: async (items) => {
      if (ecriture === "refuse") { const e = new Error("refus"); e.name = "NotAllowedError"; throw e; }
      // Comme le navigateur : rien n'est ecrit si une valeur echoue, et chaque valeur doit etre un Blob.
      for (const v of Object.values(items[0].obj)) {
        const r = await v;
        if (!(r instanceof Blob)) throw new TypeError("la valeur du ClipboardItem n'est pas un Blob");
      }
      ecrits.push(items[0]);
    },
    writeText: async (t) => { ecrits.push({ texte: t }); },
  };
  const toasts = () => (bac.document.body.children.find((c) => c.id === "rdtoasts")?.children || [])
    .map((t) => ({ texte: t.textContent, role: t.attrs.role, erreur: /erreur/.test(t.className) }));
  const vider = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  return { bac, w, barre, appels, ecrits, toasts, vider };
}
const utf8 = (t) => new TextEncoder().encode(t);
const boutons = (barre) => barre.children.filter((b) => b.className === "rdppbtn").map((b) => b.textContent);

avecVendor("inbound : next() n'attend pas la conversion (msgLoop et acquittements video non bloques)", async () => {
  const m = await montageEntrant();
  const repere = m.bac.minuteurs.length;
  const msg = { multi_clipboards: { clipboards: [
    { format: 21, compress: true, content: trameRLE(2 * MIO), width: 1024, height: 512 } ] } };
  const t = m.w.__rdPpFiltrer(msg);
  assert.ok(t === msg, "le message est rendu tel quel, synchronement");
  assert.equal(m.appels.length, 0, "aucun decodage n'a eu lieu sur le chemin de msgLoop");
  assert.deepEqual(plat(boutons(m.barre)), ["Image reçue ⇩"]);
  assert.ok(m.barre.classes.has("attention"));
  assert.equal(m.bac.tick(repere), 1, "la conversion part dans une tache a part");
});

avecVendor("inbound : une capture a fonds unis (taux > 30x) arrive ENTIERE — la panne d'origine", async () => {
  const m = await montageEntrant();
  const repere = m.bac.minuteurs.length;
  m.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [
    { format: 21, compress: true, content: trameRLE(2 * MIO, 0x20), width: 1024, height: 512 } ] } });
  m.bac.tick(repere);
  const canvasCree = [];
  const creer = m.bac.document.createElement;
  m.bac.document.createElement = (tag) => { const e = creer(tag); if (tag === "canvas") canvasCree.push(e); return e; };
  await m.vider();
  // Clic sur le bouton.
  m.barre.querySelector('[data-kind="image"]').onclick();
  await m.vider();
  assert.equal(m.ecrits.length, 1, "le presse-papier a recu un ClipboardItem");
  const blob = await m.ecrits[0].obj["image/png"];
  assert.ok(blob.size > 0);
  // Les pixels transmis au canvas sont les VRAIS (0x20), pas des zeros.
  assert.equal(canvasCree.length, 1, "un canvas de conversion, cree hors du chemin de msgLoop");
  const cv = canvasCree[0];
  assert.ok(m.appels.length >= 1 && m.appels[0] === 2 * MIO, "taille lue dans l'en-tete de trame : " + m.appels);
  assert.equal(cv.pixels.length, 1024 * 512 * 4);
  assert.equal(cv.pixels[0], 0x20); assert.equal(cv.pixels[cv.pixels.length - 1], 0x20);
  assert.deepEqual(plat(boutons(m.barre)), [], "le bouton disparait apres le depot");
  assert.ok(!m.barre.classes.has("attention"));
  assert.ok(m.toasts().some((t) => /déposée/.test(t.texte) && !t.erreur));
});

avecVendor("inbound : avec l'ancien bundle (__rdUnzstd seul), la sortie vide est une ERREUR visible, pas une image blanche", async () => {
  const m = await montageEntrant({ decodeur: "ancien" });
  const repere = m.bac.minuteurs.length;
  m.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [
    { format: 21, compress: true, content: trameRLE(2 * MIO), width: 1024, height: 512 } ] } });
  m.bac.tick(repere); await m.vider();
  m.barre.querySelector('[data-kind="image"]').onclick();
  await m.vider();
  assert.equal(m.ecrits.length, 0, "rien n'a ete ecrit dans le presse-papier");
  const t = m.toasts();
  assert.ok(t.length === 1 && t[0].erreur && t[0].role === "alert" && /Décompression/.test(t[0].texte), JSON.stringify(t));
  assert.deepEqual(plat(boutons(m.barre)), [], "erreur definitive : plus de bouton");
});

avecVendor("inbound : un texte apres une image n'efface pas l'image — un bouton par usage", async () => {
  const m = await montageEntrant();
  m.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [
    { format: 22, compress: false, content: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), width: 1, height: 1 } ] } });
  m.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [
    { format: 0, compress: false, content: utf8("bonjour") } ] } });
  assert.deepEqual(plat(boutons(m.barre).sort()), ["Image reçue ⇩", "Texte reçu ⇩"]);
});

avecVendor("inbound : le HTML garde le VRAI texte brut, sans le fabriquer en retirant les balises", async () => {
  const m = await montageEntrant();
  const repere = m.bac.minuteurs.length;
  m.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [
    { format: 2, compress: false, content: utf8("<b>gras</b> &amp; plus") },
    { format: 0, compress: false, content: utf8("gras & plus") } ] } });
  m.bac.tick(repere); await m.vider();
  m.barre.querySelector('[data-kind="text"]').onclick(); await m.vider();
  const item = m.ecrits[0];
  const plain = await (await item.obj["text/plain"]).text();
  assert.equal(plain, "gras & plus", "le texte brut annonce par le pair, pas « gras &amp; plus »");
  assert.equal(await (await item.obj["text/html"]).text(), "<b>gras</b> &amp; plus");
});

avecVendor("inbound : un refus du navigateur laisse le bouton pour reessayer, et le dit", async () => {
  const m = await montageEntrant({ ecriture: "refuse" });
  const repere = m.bac.minuteurs.length;
  m.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [
    { format: 21, compress: true, content: trameRLE(2 * MIO), width: 1024, height: 512 } ] } });
  m.bac.tick(repere); await m.vider();
  m.barre.querySelector('[data-kind="image"]').onclick(); await m.vider();
  assert.deepEqual(plat(boutons(m.barre)), ["Image reçue ⇩"], "refus temporaire : le bouton reste");
  const t = m.toasts();
  assert.ok(t[0].erreur && /refusé/.test(t[0].texte), JSON.stringify(t));
});

avecVendor("inbound : ClipboardItem qui refuse une promesse (TypeError) -> repli, on attend le blob", async () => {
  const m = await montageEntrant();
  m.w.ClipboardItem = class { constructor(obj) {
    for (const v of Object.values(obj)) if (v && typeof v.then === "function") throw new TypeError("promesse non prise en charge");
    this.obj = obj; } };
  const repere = m.bac.minuteurs.length;
  m.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [
    { format: 21, compress: true, content: trameRLE(2 * MIO), width: 1024, height: 512 } ] } });
  m.bac.tick(repere); await m.vider();
  m.barre.querySelector('[data-kind="image"]').onclick(); await m.vider();
  assert.equal(m.ecrits.length, 1);
  assert.ok((await m.ecrits[0].obj["image/png"]).size > 0, "un Blob, plus une promesse");
});

avecVendor("inbound : un message « clipboard » est toujours pris par la page — image comme texte simple", async () => {
  const m = await montageEntrant();
  const img = { clipboard: { format: 22, compress: false, content: Uint8Array.from([1, 2, 3]), width: 1, height: 1 } };
  const r = m.w.__rdPpFiltrer(img);
  assert.equal(r.clipboard, undefined, "sinon le bundle ferait TextDecoder sur du PNG");
  // Le texte simple aussi : le bundle le posait par execCommand hors de tout geste, sans effet.
  const txt = { clipboard: { format: 0, compress: false, content: utf8("salut") } };
  assert.equal(m.w.__rdPpFiltrer(txt).clipboard, undefined);
  assert.ok(boutons(m.barre).includes("Texte reçu ⇩"), JSON.stringify(boutons(m.barre)));
  // Sans API de presse-papier (page en http), le bundle garde la main.
  m.w.navigator.clipboard = undefined;
  const t2 = { clipboard: { format: 0, compress: false, content: utf8("salut") } };
  assert.equal(m.w.__rdPpFiltrer(t2).clipboard.format, 0);
});


// ====================================================================
// Presse-papier SORTANT et clavier, de bout en bout : le vrai cablage
// (wireGlobal), un DOM fictif, un pair fictif. On y voit ce qui manquait :
// chaque echec produit un retour, la limite porte sur ce qui part, le collage
// distant est retarde selon la taille, et le focus ne se perd plus.
// ====================================================================
async function montageSortant({ version = "1.4.2", plateforme = "Mac OS", vivante = true, prete = true, dims = { w: 800, h: 600 },
                                init = {}, qualiteBundle, formulaire = false } = {}) {
  const bac = creerBac();
  const w = bac.window, doc = bac.document;
  const reg = {}, ecouteurs = {};
  for (const [k, v] of Object.entries(init)) bac.stockage.setItem(k, v);
  // Un element pose dans <body> (la banniere d'erreur, les retours) se retrouve par son id.
  // Recherche par id dans tout l'arbre fictif (corps de page et tableau du formulaire).
  const racines = [doc.body];
  const trouver = (n, id) => { if (n.id === id) return n; for (const c of n.children || []) { const r = trouver(c, id); if (r) return r; } return null; };
  doc.getElementById = (id) => reg[id] || racines.map((r) => trouver(r, id)).find(Boolean) || null;
  // Le formulaire du bundle : <table> Host / Key / Id / Connect.
  let form = null;
  if (formulaire) {
    const table = elementRecord("table"), tbody = elementRecord("tbody");
    table.appendChild(tbody); racines.push(table);
    const ligne = (idc, valeur) => {
      const tr = elementRecord("tr"), td1 = elementRecord("td"), td2 = elementRecord("td"), champ = elementRecord("input");
      champ.id = idc; champ.value = valeur; td2.appendChild(champ); tr.appendChild(td1); tr.appendChild(td2);
      tbody.appendChild(tr); reg[idc] = champ; return tr;
    };
    ligne("host", ""); ligne("key", ""); const ligneId = ligne("id", "");
    const trGo = elementRecord("tr"), tdGo = elementRecord("td"), go = elementRecord("button");
    go.attrs.onclick = "connect();"; go.focuses = 0; go.focus = () => { go.focuses++; };
    tdGo.appendChild(go); trGo.appendChild(elementRecord("td")); trGo.appendChild(tdGo); tbody.appendChild(trGo);
    doc.querySelector = (sel) => (/#connect button/.test(sel) ? go : null);
    form = { table, tbody, ligneId, champId: reg.id, go };
  }
  doc.addEventListener = (t, f) => { (ecouteurs[t] ||= []).push(f); };
  doc.removeEventListener = (t, f) => { const l = ecouteurs[t] || []; const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); };
  doc.createElement = elementRecord;
  const player = elementRecord("canvas");
  player.id = "player"; player.ecouteurs = {}; player.focuses = 0;
  player.parent = elementRecord("div");                    // parentNode : rdcanvas() y insere son canvas
  player.addEventListener = (t, f) => { (player.ecouteurs[t] ||= []).push(f); };
  player.focus = () => { player.focuses++; doc.activeElement = player; };
  reg.player = player;
  reg.canvas = elementRecord("div");
  w.getComputedStyle = () => ({ display: vivante ? "block" : "none" });
  const envoyes = [], touches = [], fermes = { n: 0 }, journal = [];   // journal : l'ORDRE des envois
  // setByName(nom, valeur) : la valeur est du JSON pour la plupart des noms, une
  // chaine brute pour d'autres (« image_quality » recoit « low »).
  w.setByName = (nom, v) => { let a = v; try { a = JSON.parse(v); } catch { /* chaine brute */ } touches.push([nom, a]); journal.push("set:" + nom); };
  w.VideoDecoder = class { constructor(o) { this.o = o; } configure() {} decode() {} reset() {} close() {} get decodeQueueSize() { return 0; } };
  w.createImageBitmap = async () => ({ width: dims.w, height: dims.h, close() { fermes.n++; } });
  // Une horloge que le test peut avancer : la duree de vie d'une liaison relais decide de la banniere.
  const horloge_ = { decalage: 0 };
  const DateReelle = Date;
  w.Date = class extends DateReelle { static now() { return DateReelle.now() + horloge_.decalage; } };
  bac.executer(blocs(html));
  const depotsFichiers = { n: 0 };
  w.RDFT.accepterDepot = () => { depotsFichiers.n++; };          // espion : un collage d'image ne doit PAS televerser
  w.RD.ready = prete;
  // Le clavier du banc est un PC (navigator.userAgent « node »), le pair un Mac par defaut.
  w.curConn = { _id: "123456789", _peerInfo: { version, platform: plateforme },
                _ws: { _websocket: { readyState: 1 },
                       sendMessage(m) { envoyes.push(m); journal.push(m.misc && m.misc.option ? "opt:" + Object.keys(m.misc.option).join(",") : "msg"); },
                       next: async () => null },
                getRemember: () => true, setRemember() {},
                getOption: (k) => (k === "image-quality" ? qualiteBundle : undefined) };
  doc.activeElement = player;
  // Le bootstrap (400 ms) cree la barre et branche l'ecouteur de collage.
  bac.minuteurs.filter((t) => t.ms === 400 && !t.once).forEach((t) => t.f());
  const toasts = () => (doc.body.children.find((c) => c.id === "rdtoasts")?.children || [])
    .map((t) => ({ texte: t.textContent, role: t.attrs.role, erreur: /erreur/.test(t.className) }));
  const vider = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  const collerImage = async (fichier) => {
    let evite = false;
    const ev = { preventDefault() { evite = true; },
                 clipboardData: { items: [{ kind: "file", type: fichier.type, getAsFile: () => fichier }], files: [fichier], getData: () => "" } };
    (ecouteurs.paste || []).forEach((f) => f(ev));
    await vider();
    return evite;
  };
  const rejeux = () => bac.minuteurs.filter((t) => t.once && t.ms >= 150 && t.ms <= 2500);
  const bar = doc.body.children.find((c) => c.id === "rdbar") || null;
  // [resolution, ajuster, qualite, cadence, codec, ctrl, quitter] : l'ordre de la barre.
  const [selRes, , qual, fps, cod] = bar ? bar.children : [];
  const peerInfo = () => w.onGlobalEvent(JSON.stringify({ name: "peer_info" }));
  const options = () => envoyes.filter((x) => x.misc && x.misc.option).map((x) => x.misc.option);
  const banniere = () => doc.body.children.find((c) => c.id === "rderror") || null;
  const zone = () => doc.getElementById("rd-recents");
  const pastilles = () => (zone() ? zone().children : []).filter((c) => c.className === "rdchip");
  const libelles = () => pastilles().map((c) => c.children[0].textContent);
  return { bac, w, doc, reg, player, ecouteurs, envoyes, touches, fermes, toasts, vider, collerImage, rejeux, journal, horloge: horloge_, depotsFichiers,
           bar, qual, fps, cod, selRes, peerInfo, options, banniere, form, zone, pastilles, libelles };
}
const images = (m) => m.envoyes.filter((x) => x.multi_clipboards);
const jpeg = (mio) => new Blob([new Uint8Array(Math.floor(mio * MIO))], { type: "image/jpeg" });

test("outbound B1 : un JPEG qui gonfle en PNG au-dela de la limite est REDUIT, pas refuse", async () => {
  const m = await montageSortant({ dims: { w: 4000, h: 3000 } });
  ratioPng = 0.8;                                    // 4000x3000 -> ~9,6 Mo de PNG > 8 Mio
  try { await m.collerImage(jpeg(3)); } finally { ratioPng = 0; }
  const [msg] = images(m);
  assert.ok(msg, "une image est partie : " + JSON.stringify(m.toasts()));
  const cb = msg.multi_clipboards.clipboards[0];
  assert.ok(cb.content.length <= 8 * MIO, "le PNG envoye tient dans la limite : " + cb.content.length);
  assert.ok(cb.width < 4000 && cb.height < 3000, "dimensions reduites : " + cb.width + "x" + cb.height);
  assert.equal(cb.format, 22);
  assert.ok(m.toasts().some((t) => /réduite de 4000×3000/.test(t.texte) && !t.erreur), JSON.stringify(m.toasts()));
  assert.equal(m.fermes.n, 1, "l'ImageBitmap est libere");
  assert.equal(rejeuxOk(m), true);
});
const rejeuxOk = (m) => m.rejeux().length === 1;

test("outbound B1 : trop gros meme reduit -> erreur visible, rien n'est envoye ni rejoue", async () => {
  const m = await montageSortant({ dims: { w: 300, h: 300 } });
  pngFixe = 20 * MIO;                                 // un PNG qui ne rapetisse jamais : incompressible
  try { await m.collerImage(jpeg(1)); } finally { pngFixe = 0; }
  assert.equal(images(m).length, 0);
  const t = m.toasts();
  assert.ok(t.length === 1 && t[0].erreur && /trop grande/.test(t[0].texte), JSON.stringify(t));
  assert.equal(m.rejeux().length, 0, "pas de Cmd+V sur un presse-papier distant inchange");
});

test("outbound B1 : une image locale de plus de 64 Mio n'est meme pas decodee", async () => {
  const m = await montageSortant();
  let decodee = false; m.w.createImageBitmap = async () => { decodee = true; return { width: 1, height: 1, close() {} }; };
  const enorme = { type: "image/png", size: 65 * MIO, arrayBuffer: async () => new ArrayBuffer(0) };
  await m.collerImage(enorme);
  assert.equal(decodee, false);
  assert.ok(m.toasts()[0].erreur && /trop volumineuse/.test(m.toasts()[0].texte));
});

test("outbound B1 : bitmap-failure-toasts — un format que le navigateur ne decode pas", async () => {
  const m = await montageSortant();
  m.w.createImageBitmap = async () => { throw new Error("The source image could not be decoded."); };
  await m.collerImage(new Blob([new Uint8Array(100)], { type: "image/heic" }));
  assert.equal(images(m).length, 0);
  const t = m.toasts();
  assert.ok(t[0].erreur && /Format d'image non pris en charge/.test(t[0].texte), JSON.stringify(t));
  assert.equal(m.rejeux().length, 0);
});

test("outbound B1 : rdSend-false-toasts — session pas prete (peer_info pas recu)", async () => {
  const m = await montageSortant({ prete: false });
  await m.collerImage(new Blob([new Uint8Array(100)], { type: "image/png" }));
  assert.equal(images(m).length, 0);
  assert.ok(m.toasts()[0].erreur && /session n'est pas prête/.test(m.toasts()[0].texte), JSON.stringify(m.toasts()));
  assert.equal(m.rejeux().length, 0);
});

test("outbound B4 : old-peer-toast-no-send-no-replay — un pair anterieur a 1.3.0", async () => {
  for (const version of ["1.2.7", "0.9.0"]) {
    const m = await montageSortant({ version });
    await m.collerImage(new Blob([new Uint8Array(100)], { type: "image/png" }));
    assert.equal(images(m).length, 0, version);
    assert.ok(m.toasts()[0].erreur && /antérieur à 1\.3\.0/.test(m.toasts()[0].texte), version);
    assert.equal(m.rejeux().length, 0, "un Cmd+V collerait l'ancien contenu du poste distant");
  }
  // Version inconnue : on envoie (le pair est peut-etre recent), en le journalisant.
  const inc = await montageSortant({ version: "" });
  await inc.collerImage(new Blob([new Uint8Array(100)], { type: "image/png" }));
  assert.equal(images(inc).length, 1);
});

test("outbound B2 : le collage distant est rejoue APRES un delai qui croit avec la taille", async () => {
  const petit = await montageSortant();
  await petit.collerImage(new Blob([new Uint8Array(1000)], { type: "image/png" }));
  assert.equal(petit.rejeux()[0].ms, 150, "une petite image garde l'ancien delai");
  const gros = await montageSortant();
  await gros.collerImage(new Blob([new Uint8Array(Math.floor(5.5 * MIO))], { type: "image/png" }));
  assert.equal(gros.rejeux()[0].ms, 150 + 5 * 250, "5,5 Mio -> 1400 ms");
  gros.rejeux()[0].f();
  const v = gros.touches.filter(([n, a]) => n === "input_key" && a.name === "v");
  assert.equal(v.length, 2);
  assert.equal(v[0][1].command, "true", "Cmd+V (permutation Ctrl/Cmd active par defaut)");
});

test("outbound B3 : paste-accepted / paste-refused selon le focus et la session", async () => {
  const cas = [
    ["canvas",                      (m) => { m.doc.activeElement = m.player; },                              true],
    ["body en session vivante",     (m) => { m.doc.activeElement = m.doc.body; },                            true],
    ["null en session vivante",     (m) => { m.doc.activeElement = null; },                                  true],
    ["champ de saisie",             (m) => { m.doc.activeElement = { tagName: "INPUT" }; },                  false],
    ["textarea",                    (m) => { m.doc.activeElement = { tagName: "TEXTAREA" }; },               false],
    ["contenteditable",             (m) => { m.doc.activeElement = { tagName: "DIV", isContentEditable: true }; }, false],
    ["dans le panneau de fichiers", (m) => { m.doc.activeElement = { tagName: "BUTTON", closest: (q) => /rdfiles/.test(q) ? {} : null }; }, false],
    ["un bouton quelconque",        (m) => { m.doc.activeElement = { tagName: "BUTTON", closest: () => null }; }, false],
  ];
  for (const [nom, regler, attendu] of cas) {
    const m = await montageSortant();
    regler(m);
    const evite = await m.collerImage(new Blob([new Uint8Array(100)], { type: "image/png" }));
    assert.equal(images(m).length > 0, attendu, nom);
    assert.equal(evite, attendu, nom + " : preventDefault seulement si le collage est traite");
  }
  // Sans session vivante, le corps de la page n'est pas un collage a nous.
  const morte = await montageSortant({ vivante: false });
  morte.doc.activeElement = morte.doc.body;
  await morte.collerImage(new Blob([new Uint8Array(100)], { type: "image/png" }));
  assert.equal(images(morte).length, 0);
});

test("outbound B5 : la touche de collage n'est pas avalee (latin, cyrillique) mais un k Dvorak si", async () => {
  const m = await montageSortant();
  const clavier = (e) => {
    let evite = false; const av = m.touches.length;
    m.player.ecouteurs.keydown.forEach((f) => f({ preventDefault() { evite = true; }, altKey: false, shiftKey: false, metaKey: false, ...e }));
    return { evite, envoye: m.touches.length > av };
  };
  const latin = clavier({ key: "v", code: "KeyV", ctrlKey: true });
  assert.deepEqual(latin, { evite: false, envoye: false }, "le navigateur doit emettre « paste »");
  const cyril = clavier({ key: "м", code: "KeyV", ctrlKey: true });
  assert.deepEqual(cyril, { evite: false, envoye: false }, "cyrillique : idem");
  const dvorak = clavier({ key: "k", code: "KeyV", ctrlKey: true });
  assert.deepEqual(dvorak, { evite: true, envoye: true }, "Dvorak : un k, transmis au poste distant");
});

test("outbound B3 : un clic sur la barre rend le focus au canvas (sauf sur un <select>)", async () => {
  const m = await montageSortant();
  const bar = m.doc.body.children.find((c) => c.id === "rdbar");
  assert.ok(bar, "la barre est creee");
  const clic = bar.ecouteurs?.click;
  assert.ok(clic, "la barre ecoute les clics");
  const av = m.player.focuses, repere = m.bac.minuteurs.length;
  clic.forEach((f) => f({ target: { tagName: "BUTTON" } }));
  m.bac.tick(repere);
  assert.equal(m.player.focuses, av + 1, "le canvas reprend le focus");
  const repere2 = m.bac.minuteurs.length;
  clic.forEach((f) => f({ target: { tagName: "SELECT" } }));
  m.bac.tick(repere2);
  assert.equal(m.player.focuses, av + 1, "un <select> garde le focus pour ouvrir sa liste");
});

test("outbound : le texte et le HTML gardent leur chemin et l'ancien delai", async () => {
  const m = await montageSortant();
  let evite = false;
  const ev = { preventDefault() { evite = true; },
               clipboardData: { items: [], files: [], getData: (t) => (t === "text/plain" ? "bonjour" : "") } };
  m.ecouteurs.paste.forEach((f) => f(ev));
  assert.equal(evite, true);
  assert.deepEqual(plat(m.envoyes.filter((x) => x.clipboard).map((x) => x.clipboard.content.length)), [7]);
  assert.equal(m.rejeux()[0].ms, 150);
});

test("B6 + durcissement : commentaire « champ 28 », et le bloc fichiers refuse une sortie vide", () => {
  assert.match(html, /multi_clipboards » , champ 28|multi_clipboards », champ 28/);
  assert.ok(!/champ 27\s*(\n\s*\/\/\s*)?du Message/.test(html), "l'ancien commentaire « champ 27 du Message » est revenu");
  assert.match(html, /if \(!d \|\| RDLib\.clip\.sortieVideSuspecte\(b\.data, d\)\) throw new Error\("decompression zstd echouee"\)/);
});


// ====================================================================
// Reglages memorises, session, reprise : le vrai cablage, un pair fictif.
// ====================================================================
const prefsStockees = (m) => JSON.parse(m.bac.stockage.getItem("rd-prefs") || "null");

test("I1 selects-init-from-prefs : les selecteurs demarrent sur les choix memorises", async () => {
  const m = await montageSortant({ init: { "rd-prefs": JSON.stringify({ v: 1, quality: "best", fps: 60, codec: "vp9" }) } });
  assert.equal(m.qual.value, "best");
  assert.equal(m.fps.value, "60");
  assert.equal(m.cod.value, "vp9");
  assert.equal(m.w.RD.forced, "vp9", "le codec force est pose avant meme la premiere session");
  const vierge = await montageSortant();
  assert.equal(vierge.qual.value, "balanced");
  assert.equal(vierge.cod.value, "auto");
  assert.equal(vierge.w.RD.forced, "auto");
});

test("I1 : chaque changement de selecteur est ecrit dans rd-prefs", async () => {
  const m = await montageSortant();
  m.qual.value = "low"; m.qual.onchange();
  m.fps.value = "15"; m.fps.onchange();
  m.cod.value = "logiciel"; m.cod.onchange();
  assert.deepEqual(prefsStockees(m), { v: 1, quality: "low", fps: 15, codec: "logiciel" });
  // Et une nouvelle « page » les retrouve.
  const relue = await montageSortant({ init: { "rd-prefs": m.bac.stockage.getItem("rd-prefs") } });
  assert.equal(relue.qual.value, "low"); assert.equal(relue.fps.value, "15"); assert.equal(relue.cod.value, "logiciel");
});

test("I1 reprise-reapplies-quality-150-fps-codec : chaque session reapplique les reglages", async () => {
  const m = await montageSortant({ prete: false, init: { "rd-prefs": JSON.stringify({ v: 1, quality: "low", fps: 60, codec: "vp9" }) } });
  m.peerInfo();
  assert.ok(m.touches.some(([n, a]) => n === "image_quality" && a === "low"), JSON.stringify(m.touches));
  let opts = m.options();
  assert.ok(opts.some((o) => o.custom_image_quality === 150), "le ratio 1.5 part a la session");
  assert.ok(opts.some((o) => o.custom_fps === 60), "le plafond memorise aussi");
  assert.equal(m.w.RD.forced, "vp9");
  // Deuxieme session, sans recharger la page : la reprise passe par window.connect.
  const avant = { touches: m.touches.length, opts: m.options().length };
  m.w.connect = () => "connecte";
  m.bac.minuteurs.filter((t) => t.ms === 300 && !t.once).forEach((t) => t.f());       // protegerConnect
  m.w.connect();
  assert.equal(m.w.RD.ready, false, "une nouvelle session n'est pas prete avant son peer_info");
  m.peerInfo();
  assert.equal(m.w.RD.ready, true);
  assert.ok(m.touches.length > avant.touches, "la qualite est reappliquee");
  assert.ok(m.options().length >= avant.opts + 2, "ratio ET cadence reappliques : le sondage « une fois par page » est parti");
});

test("I1 ready-false-after-connect-true-after-peer_info", async () => {
  const m = await montageSortant({ prete: true });
  m.w.connect = () => 42;
  m.bac.minuteurs.filter((t) => t.ms === 300 && !t.once).forEach((t) => t.f());
  assert.equal(m.w.RD.ready, true, "pas de remise a zero avant un connect()");
  assert.equal(m.w.connect(), 42, "la valeur de retour du bundle est preservee");
  assert.equal(m.w.RD.ready, false);
  m.peerInfo();
  assert.equal(m.w.RD.ready, true);
});

test("I1 select-synced-from-getOption-when-no-pref : sans preference, on ne pousse rien et on aligne le selecteur", async () => {
  const m = await montageSortant({ prete: false, qualiteBundle: "best" });
  m.peerInfo();
  assert.equal(m.qual.value, "best", "le selecteur dit la qualite reelle, pas « Equilibre »");
  assert.ok(!m.touches.some(([n]) => n === "image_quality"), "aucune qualite poussee : le bundle envoie deja la sienne");
  const stockees = prefsStockees(m) || {};
  assert.ok(stockees.quality === undefined && stockees.fps === undefined && stockees.codec === undefined,
    "et aucun reglage n'est memorise a la place de l'utilisateur (seul l'indice de la barre l'est)");
  const inconnue = await montageSortant({ prete: false, qualiteBundle: "n'importe quoi" });
  inconnue.peerInfo();
  assert.equal(inconnue.qual.value, "balanced");
});

test("I1 : un codec force memorise qui ne tient pas redevient « auto », et le dit", async () => {
  const m = await montageSortant({ init: { "rd-prefs": JSON.stringify({ v: 1, codec: "h265" }) } });
  assert.equal(m.w.RD.forced, "h265");
  m.w.RD.codec = "h265";
  // Un repli est declenche par la chaine de decodage : on le provoque par le chemin public le plus proche.
  m.w.__rdFallback && m.w.__rdFallback("configuration impossible");
  assert.ok(m.w.__rdFallback, "fallbackToSoftware doit etre joignable pour ce test (window.__rdFallback)");
  assert.equal(m.w.RD.forced, "auto");
  assert.equal(m.cod.value, "auto");
  assert.equal(prefsStockees(m).codec, "auto");
  assert.ok(m.toasts().some((t) => /H265 indisponible/.test(t.texte) && t.erreur), JSON.stringify(m.toasts()));
});

// ---- la fausse banniere relais, et la reprise parasite
function relais(m, { pairMort = false } = {}) {
  const ws = new m.w.WebSocket("wss://h/ws/relay");
  ws.emettre("open", {});
  if (!pairMort) ws.emettre("message", {});
  return ws;
}

test("I1 no-banner-after-normal-close : la fermeture normale d'une session n'est pas « cle refusee »", async () => {
  const m = await montageSortant({ prete: false });
  m.peerInfo();                                          // session etablie
  const ws = relais(m);
  ws.emettre("close", { code: 1006, wasClean: false, reason: "" });
  assert.equal(m.banniere(), null, "RD.ready reste vrai apres la fin de la session");

  // Le veilleur (800 ms) constate la fin de session AVANT que l'evenement « close »
  // n'arrive (la liaison passe par CLOSING) : ce n'est pas non plus « cle refusee ».
  const m2 = await montageSortant({ prete: false });
  m2.peerInfo();
  let vivante = true;
  m2.w.getComputedStyle = () => ({ display: vivante ? "block" : "none" });
  const veilleur = () => m2.bac.minuteurs.filter((t) => t.ms === 800 && !t.once).forEach((t) => t.f());
  veilleur();                                            // session vivante : __rdEtait passe a vrai
  vivante = false;
  veilleur();                                            // transition « en session » -> « plus en session »
  assert.equal(m2.w.RD.ready, true, "la fin de session ne remet pas RD.ready a zero");
  relais(m2).emettre("close", { code: 1006, wasClean: false, reason: "" });
  assert.equal(m2.banniere(), null);
});

test("I1 banner-when-relay-closes-before-peer_info / banner-removed-on-peer_info", async () => {
  const m = await montageSortant({ prete: false });
  m.peerInfo();
  m.w.connect = () => 1;
  m.bac.minuteurs.filter((t) => t.ms === 300 && !t.once).forEach((t) => t.f());
  m.w.connect();                                         // nouvelle tentative : pas prete
  const ws = relais(m, { pairMort: true });
  ws.emettre("close", { code: 1006, wasClean: false, reason: "" });    // en moins de 5 s : hbbr a rejete la cle
  assert.ok(m.banniere(), "la banniere fonctionne aussi sur une reconnexion (elle etait muette apres la 1re session)");
  m.peerInfo();                                          // la tentative suivante reussit
  assert.equal(m.banniere(), null, "une session reussie efface la banniere de l'echec precedent");
});

test("I1 spurious-reprise-cancelled-while-session-live : la fermeture de la liaison « fichiers » ne relance rien", async () => {
  const m = await montageSortant({ vivante: true });
  let connects = 0; m.w.connect = () => { connects++; };
  const repere = m.bac.minuteurs.length;
  m.w.__rdReprise();
  assert.equal(m.bac.minuteurs.slice(repere).filter((t) => t.once && t.ms >= 1000).length, 0,
    "session vivante : aucune reprise n'est meme planifiee");
  assert.equal(connects, 0);

  // Session morte : la reprise se planifie ; elle revient a la vie avant l'echeance.
  let vivante = false;
  m.w.getComputedStyle = () => ({ display: vivante ? "block" : "none" });
  const r2 = m.bac.minuteurs.length;
  m.w.__rdReprise();
  const t = m.bac.minuteurs.slice(r2).find((x) => x.once && x.ms >= 1000);
  assert.ok(t, "session morte : une reprise est planifiee");
  vivante = true; t.f();
  assert.equal(connects, 0, "la session est revenue entre-temps : connect() n'est pas rappele par-dessus");
  // Et si elle est bien morte a l'echeance, la reprise a lieu.
  vivante = false;
  m.w.__rdReprise();
  const t2 = m.bac.minuteurs.slice(r2).filter((x) => x.once && x.ms >= 1000).pop();
  t2.f();
  assert.equal(connects, 1);
});


// ====================================================================
// Barre repliable (I2) : structure, etat, persistance, greffons.
// ====================================================================
const ordre = (bar) => bar.children.map((c) => c.className || c.tag);

test("I2 bar-collapsed-by-default : repliee sans preference, poignee derniere enfant", async () => {
  const m = await montageSortant();
  assert.ok(m.bar.classes.has("replie"), "repliee par defaut");
  const h = m.bar.children[m.bar.children.length - 1];
  assert.equal(h.className, "rdhandle", "la poignee est la derniere enfant");
  assert.equal(h.attrs["aria-expanded"], "false");
  assert.equal(h.attrs["aria-controls"], "rdbar");
  assert.ok(h.attrs["aria-label"] && h.title, "nom accessible");
  assert.equal(h.type, "button");
  assert.ok(ordre(m.bar).indexOf("quit") < ordre(m.bar).indexOf("rdhandle"), "quit precede la poignee");
});

test("I2 expand-on-click-aria-and-persist-across-reload", async () => {
  const m = await montageSortant();
  const h = m.bar.children.find((c) => c.className === "rdhandle");
  h.onclick();
  assert.ok(!m.bar.classes.has("replie"));
  assert.equal(h.attrs["aria-expanded"], "true");
  assert.equal(prefsStockees(m).bar, "ouverte");
  // Rechargement : elle reste ouverte.
  const relue = await montageSortant({ init: { "rd-prefs": m.bac.stockage.getItem("rd-prefs") } });
  assert.ok(!relue.bar.classes.has("replie"), "l'etat ouvert survit au rechargement");
  // Et on peut la replier, ce qui se memorise aussi.
  relue.bar.children.find((c) => c.className === "rdhandle").onclick();
  assert.ok(relue.bar.classes.has("replie"));
  assert.equal(prefsStockees(relue).bar, "repliee");
});

test("I2 fichiers-button-before-quit-direct-child : le greffon de B4 garde sa place, la poignee reste derniere", async () => {
  const m = await montageSortant();
  const o = ordre(m.bar);
  assert.ok(o.includes("rdfilesbtn"), "le greffon fichiers s'est greffe : " + o);
  assert.ok(o.indexOf("rdfilesbtn") < o.indexOf("quit"), "avant Quitter : " + o);
  assert.equal(o[o.length - 1], "rdhandle", "la poignee reste la derniere : " + o);
  // Un bouton de presse-papier recu s'insere en TETE, jamais apres la poignee.
  m.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [{ format: 0, compress: false, content: utf8("x") }] } });
  const o2 = ordre(m.bar);
  assert.equal(o2[0], "rdppbtn");
  assert.equal(o2[o2.length - 1], "rdhandle");
});

test("I2 attention-reveals-ppbtn-when-collapsed : un presse-papier recu ne deplie pas la barre, il montre son bouton", async () => {
  const m = await montageSortant();
  assert.ok(m.bar.classes.has("replie"));
  m.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [{ format: 0, compress: false, content: utf8("x") }] } });
  assert.ok(m.bar.classes.has("replie"), "l'etat replie n'est pas change");
  assert.ok(m.bar.classes.has("attention"), "la classe transitoire est posee");
  assert.equal(prefsStockees(m)?.bar, undefined, "et le choix memorise n'est pas touche");
  // La regle CSS qui rend ce bouton visible et cliquable malgre le repli.
  assert.match(html, /#rdbar\.replie > :not\(\.rdhandle\):not\(\.rdppbtn\)\{display:none\}/);
  assert.match(html, /#rdbar\.replie \.rdhandle,#rdbar\.replie \.rdppbtn\{pointer-events:auto\}/);
});

test("I2 collapsed-click-through (CSS) : le conteneur replie ne recoit plus le pointeur, sans toucher a display", () => {
  const r = /#rdbar\.replie\{([^}]*)\}/.exec(html);
  assert.ok(r, "regle #rdbar.replie absente");
  assert.match(r[1], /pointer-events:none/);
  assert.match(r[1], /padding:0/);
  assert.match(r[1], /background:none/);
  assert.match(r[1], /border:0/);
  assert.ok(!/display\s*:/.test(r[1]), "#rdbar.replie ne pose pas display : le veilleur le pose en ligne");
  // Aucune regle CSS ne pose display sur #rdbar lui-meme, hors « none » deja la.
  const regles = [...html.matchAll(/(^|\n)\s*#rdbar\s*\{([^}]*)\}/g)].map((x) => x[2]);
  for (const r2 of regles) { const d = /display\s*:\s*(\w+)/.exec(r2); assert.ok(!d || d[1] === "none", "#rdbar ne doit poser que display:none (le veilleur pose flex en ligne)"); }
});

test("I2 handle-min-24px : la cible tactile de la poignee", () => {
  const r = /#rdbar \.rdhandle\{([^}]*)\}/.exec(html);
  assert.ok(r);
  const px = (prop) => { const m = new RegExp(prop + ":(\\d+)px").exec(r[1]); return m ? +m[1] : 0; };
  assert.ok(px("min-width") >= 24 && px("min-height") >= 24, r[1]);
  const c = /#rdbar\.replie \.rdhandle\{([^}]*)\}/.exec(html);
  assert.ok(c && /width:28px/.test(c[1]) && /height:28px/.test(c[1]), "28 px replie");
});

test("I2 escape-on-bar-collapses-and-sends-no-input_key : Echap sur la barre, pas sur le document", async () => {
  const m = await montageSortant();
  const h = m.bar.children.find((c) => c.className === "rdhandle");
  h.onclick();                                              // ouverte
  const av = m.touches.length;
  const clavier = (e) => m.bar.ecouteurs.keydown.forEach((f) => f({ preventDefault() {}, ...e }));
  clavier({ key: "Escape", target: { tagName: "SELECT" } });
  assert.ok(!m.bar.classes.has("replie"), "un <select> garde Echap pour fermer sa liste");
  clavier({ key: "a", target: { tagName: "BUTTON" } });
  assert.ok(!m.bar.classes.has("replie"));
  const avantFocus = m.player.focuses, repere = m.bac.minuteurs.length;
  clavier({ key: "Escape", target: { tagName: "BUTTON" } });
  assert.ok(m.bar.classes.has("replie"), "Echap replie");
  assert.equal(prefsStockees(m).bar, "repliee");
  assert.equal(m.player.focuses, avantFocus, "le focus ne revient PAS au canvas avant le keyup : le canvas recevrait un keyup sans keydown");
  assert.equal((m.ecouteurs.keydown || []).length, 0, "aucun ecouteur Echap sur le document");
  // Le keyup d'Echap arrive : alors seulement, le canvas reprend le focus.
  const keyups = (m.ecouteurs.keyup || []).slice();
  assert.equal(keyups.length, 1, "un ecouteur keyup ephemere est arme");
  keyups.forEach((f) => f({ key: "a" }));
  m.bac.tick(repere);
  assert.equal(m.player.focuses, avantFocus, "une autre touche ne rend pas le focus");
  keyups.forEach((f) => f({ key: "Escape" }));
  m.bac.tick(repere);
  assert.equal(m.player.focuses, avantFocus + 1, "apres le keyup d'Echap, le canvas reprend le focus");
  assert.equal(m.touches.length, av, "rien n'est envoye au poste distant");
  // Le canvas, lui, continue de transmettre Echap au poste distant.
  m.player.ecouteurs.keydown.forEach((f) => f({ key: "Escape", preventDefault() {}, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }));
  assert.ok(m.touches.some(([n, a]) => n === "input_key" && /esc/i.test(a.name)), JSON.stringify(m.touches));
});

test("I2 : l'indice de la barre repliee n'apparait qu'a la premiere session", async () => {
  const m = await montageSortant({ prete: false });
  m.peerInfo();
  const indices = m.toasts().filter((t) => /clique sur ⚙/.test(t.texte));
  assert.equal(indices.length, 1);
  assert.equal(prefsStockees(m).hint, true);
  const relue = await montageSortant({ prete: false, init: { "rd-prefs": m.bac.stockage.getItem("rd-prefs") } });
  relue.peerInfo();
  assert.equal(relue.toasts().filter((t) => /clique sur ⚙/.test(t.texte)).length, 0, "plus jamais ensuite");
  // Barre ouverte : pas d'indice a donner.
  const ouverte = await montageSortant({ prete: false, init: { "rd-prefs": JSON.stringify({ v: 1, bar: "ouverte" }) } });
  ouverte.peerInfo();
  assert.equal(ouverte.toasts().filter((t) => /clique sur ⚙/.test(t.texte)).length, 0);
});


// ====================================================================
// Dix dernieres connexions (I3) : sous le champ « Id » du formulaire du bundle.
// ====================================================================
const recentStocke = (m) => JSON.parse(m.bac.stockage.getItem("rd-recent") || "null");
const PEERS = JSON.stringify({
  "111111111": { tm: 100, password: "secret1" }, "222222222": { tm: 300 }, "333333333": { tm: 200 } });

test("I3 chips-under-id-type-button : une ligne sous « Id », des <button type=button>, un groupe etiquete", async () => {
  const m = await montageSortant({ formulaire: true, init: { peers: PEERS, id: "444444444" } });
  const lignes = m.form.tbody.children;
  const iId = lignes.indexOf(m.form.ligneId);
  assert.ok(m.zone(), "la zone des pastilles existe");
  // Comparaison par identite : un assert.equal sur des noeuds fictifs cycliques (parent <-> enfants)
  // fabriquerait, en cas d'echec, un diff geant qui fige le banc.
  assert.ok(lignes[iId + 1] && lignes[iId + 1].children[1].children[0] === m.zone(), "juste sous la ligne « Id »");
  assert.ok(lignes[iId + 2] && lignes[iId + 2].children[1].children[0] === m.form.go, "et avant la ligne « Connect »");
  assert.equal(m.zone().attrs.role, "group");
  assert.match(m.zone().attrs["aria-label"], /Dernières connexions/);
  // Amorcage : dernier ID saisi d'abord, puis peers par « tm » decroissant.
  assert.deepEqual(plat(m.libelles()), ["444 444 444", "222 222 222", "333 333 333", "111 111 111"]);
  for (const c of m.pastilles()) {
    assert.equal(c.children[0].type, "button");
    assert.equal(c.children[1].type, "button");
    assert.equal(c.children[1].attrs.tabindex, "-1", "la croix est reservee a la souris");
    assert.equal(c.children[1].attrs["aria-hidden"], "true");
  }
  assert.equal(m.zone().children.at(-1).className, "rdchip-clear");
});

test("I3 : rien a afficher sans historique, et pas de bouton « Effacer » orphelin", async () => {
  const m = await montageSortant({ formulaire: true });
  assert.ok(m.zone());
  assert.equal(m.zone().children.length, 0);
  assert.deepEqual(recentStocke(m), { v: 1, ids: [] }, "la cle est ecrite meme vide : un retrait ne sera pas reamorce");
});

test("I3 click-fills-and-focuses-connect : chiffres seuls dans le champ, focus sur Connect", async () => {
  const m = await montageSortant({ formulaire: true, init: { peers: PEERS } });
  m.champId = m.form.champId;
  m.pastilles()[1].children[0].onclick();                    // « 333 333 333 » (222 puis 333 puis 111)
  assert.equal(m.form.champId.value, "333333333", "le bundle n'enleve pas les espaces : chiffres seuls");
  assert.equal(m.form.go.focuses, 1, "le focus va au bouton Connect");
});

test("I3 x-and-Delete-remove : la croix, la touche Suppr, et « Effacer »", async () => {
  const m = await montageSortant({ formulaire: true, init: { peers: PEERS } });
  assert.equal(m.pastilles().length, 3);
  m.pastilles()[0].children[1].onclick();                     // croix sur 222…
  assert.deepEqual(plat(m.libelles()), ["333 333 333", "111 111 111"]);
  let evite = false;
  m.pastilles()[0].children[0].ecouteurs.keydown.forEach((f) => f({ key: "Delete", preventDefault() { evite = true; } }));
  assert.equal(evite, true);
  assert.deepEqual(plat(m.libelles()), ["111 111 111"]);
  m.pastilles()[0].children[0].ecouteurs.keydown.forEach((f) => f({ key: "a", preventDefault() { throw new Error("pas Suppr"); } }));
  assert.equal(m.pastilles().length, 1, "une autre touche ne retire rien");
  // Et le retrait tient apres rechargement (pas de reamorcage).
  const relue = await montageSortant({ formulaire: true, init: { peers: PEERS, "rd-recent": m.bac.stockage.getItem("rd-recent") } });
  assert.deepEqual(plat(relue.libelles()), ["111 111 111"]);
  relue.zone().children.at(-1).onclick();                     // « Effacer »
  assert.equal(relue.zone().children.length, 0, "liste vide, plus de bouton « Effacer »");
  assert.deepEqual(recentStocke(relue), { v: 1, ids: [] });
});

test("I3 recorded-only-after-peer_info / rerender : une session reussie, pas un clic sur Connect", async () => {
  const m = await montageSortant({ formulaire: true, prete: false });
  assert.equal(m.pastilles().length, 0);
  m.w.connect = () => 1;
  m.bac.minuteurs.filter((t) => t.ms === 300 && !t.once).forEach((t) => t.f());
  m.w.connect();                                              // un clic sur Connect, sans peer_info
  assert.equal(m.pastilles().length, 0, "une tentative qui n'aboutit pas n'est pas enregistree");
  m.peerInfo();                                               // curConn._id = « 123456789 »
  assert.deepEqual(plat(m.libelles()), ["123 456 789"], "la liste est a jour pour le retour au formulaire");
  assert.deepEqual(plat(recentStocke(m).ids.map((e) => e.id)), ["123456789"]);
  // Une autre session la rejoint en tete, sans doublon.
  m.w.curConn._id = "987654321"; m.peerInfo(); m.w.curConn._id = "123 456 789"; m.peerInfo();
  assert.deepEqual(plat(m.libelles()), ["123 456 789", "987 654 321"]);
});

test("I3 cap-10 : dix pastilles au plus, meme avec plus d'entrees", async () => {
  const ids = {}; for (let i = 0; i < 12; i++) ids[String(100000000 + i)] = { tm: 1000 + i };
  const m = await montageSortant({ formulaire: true, init: { peers: JSON.stringify(ids) } });
  assert.equal(m.pastilles().length, 10);
  assert.equal(m.libelles()[0], "100 000 011", "le plus recent d'abord");
});

test("I3 xss-ids-render-as-text : un contenu de stockage malveillant ne devient jamais du balisage", async () => {
  const mauvais = JSON.stringify({ v: 1, ids: [
    { id: "<img src=x onerror=alert(1)>", t: 9 }, { id: "123456789\"><script>", t: 8 },
    { id: "555555555", t: 7 }, { id: "12345", t: 6 } ] });
  const m = await montageSortant({ formulaire: true, init: { "rd-recent": mauvais } });
  assert.deepEqual(plat(m.libelles()), ["555 555 555"], "seul l'identifiant valide survit");
  // Statique : la section n'emploie jamais innerHTML.
  const debut = html.indexOf("// ----------------------------------------------- dernieres connexions");
  const fin = html.indexOf("window.__rdSessionReady = sessionPrete;");
  assert.ok(debut > 0 && fin > debut);
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(html.slice(debut, fin)), "textContent uniquement");
});

test("I3 : la CSS defait le style du bouton « Connect » que le bundle applique a tout bouton de #connect", () => {
  assert.match(html, /#app>#connect #rd-recents button\{[^}]*background:transparent/);
  assert.match(html, /#app>#connect #rd-recents \.rdchip-x\{/);
});


// ====================================================================
// Corrections issues de la relecture independante.
// ====================================================================
test("review : isPasteChord — seulement une LETTRE d'un alphabet non latin sur KeyV", () => {
  const { clip } = chargerLib();
  const c = (key) => clip.isPasteChord({ key, code: "KeyV", ctrlKey: true });
  for (const [k, attendu, nom] of [["м", true, "cyrillique"], ["ν", true, "grec"], ["ر", true, "arabe"], ["ה", true, "hebreu"],
      [";", false, "ponctuation"], ["3", false, "chiffre"], [".", false, "point"], ["é", false, "lettre latine accentuee"],
      ["k", false, "Dvorak"], ["Dead", false, "touche morte"], ["", false, "vide"], ["ab", false, "plusieurs caracteres"]]) {
    assert.equal(c(k), attendu, nom);
  }
  assert.equal(clip.isPasteChord({ key: "v", code: "KeyV", ctrlKey: true }), true);
  assert.equal(clip.isPasteChord({ key: 5, code: "KeyV", ctrlKey: true }), false, "key non textuelle");
});

test("review : sortieVideSuspecte — vide n'est legitime que si la trame declare 0", () => {
  const { clip } = chargerLib();
  const vide = new Uint8Array(0), plein = new Uint8Array(3);
  assert.equal(clip.sortieVideSuspecte(trameRLE(1000), plein), false);
  assert.equal(clip.sortieVideSuspecte(trameRLE(1000), vide), true, "declare 1000, rend vide : echec silencieux");
  assert.equal(clip.sortieVideSuspecte(trameSansTaille(1000), vide), true, "rien de declare : suspect");
  assert.equal(clip.sortieVideSuspecte(Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, 0x00, 0x01, 0x00, 0x00]), vide), false,
    "une trame qui DECLARE 0 octet est un vrai bloc vide");
  assert.equal(clip.sortieVideSuspecte(trameRLE(10), undefined), true);
});

test("review : decompress — pas de magic zstd, aucune allocation demandee au decodeur", async () => {
  const { clip } = chargerLib();
  const dec = decodeurFactice(1);
  for (const garbage of [Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]), Uint8Array.from([0x28, 0xb5]), utf8("pas du zstd du tout")]) {
    await assert.rejects(clip.decompress(dec, garbage), (e) => e.code === "DECODE" && /pas une trame zstd/.test(e.detail));
  }
  assert.equal(dec.appels.length, 0, "le decodeur n'a pas ete sollicite");
});

test("review : sessionPrete envoie le ratio 1,5 AVANT le preset — le choix de l'utilisateur l'emporte", async () => {
  const m = await montageSortant({ prete: false, init: { "rd-prefs": JSON.stringify({ v: 1, quality: "low", fps: 15 }) } });
  m.peerInfo();
  const i150 = m.journal.indexOf("opt:custom_image_quality"), iPreset = m.journal.indexOf("set:image_quality"), iFps = m.journal.indexOf("opt:custom_fps");
  assert.ok(i150 >= 0 && iPreset >= 0, m.journal.join(" | "));
  assert.ok(i150 < iPreset, "le pair applique les options dans l'ordre d'arrivee : le preset doit venir APRES le ratio : " + m.journal.join(" | "));
  assert.ok(iFps >= 0);
  // Sans preference de qualite : le ratio par defaut, et aucun preset.
  const vierge = await montageSortant({ prete: false });
  vierge.peerInfo();
  assert.ok(vierge.journal.includes("opt:custom_image_quality") && !vierge.journal.includes("set:image_quality"));
});

test("review : un crochet de session qui leve ne prive pas la session de son menu ni du codec", async () => {
  const m = await montageSortant({ prete: false });
  m.w.__rdSessionReady = () => { throw new Error("boom"); };
  const avant = m.options().length;
  m.peerInfo();
  assert.equal(m.w.RD.ready, true);
  assert.ok(m.options().slice(avant).some((o) => o.supported_decoding), "la negociation du codec a bien eu lieu apres l'echec : " + JSON.stringify(m.options()));
  assert.ok(m.selRes.children.length >= 1, "le menu de resolutions a ete construit");
});

test("review : un depot lent ne supprime pas l'image PLUS RECENTE qui a pris l'emplacement", async () => {
  const m = await montageEntrant();
  const a = { multi_clipboards: { clipboards: [{ format: 21, compress: true, content: trameRLE(2 * MIO), width: 1024, height: 512 }] } };
  const b = { multi_clipboards: { clipboards: [{ format: 21, compress: true, content: trameRLE(2 * MIO, 0x30), width: 1024, height: 512 }] } };
  const repere = m.bac.minuteurs.length;
  m.w.__rdPpFiltrer(a);
  const boutonA = m.barre.querySelector('[data-kind="image"]');
  boutonA.onclick();                                       // clic AVANT la fin de la conversion de A
  m.w.__rdPpFiltrer(b);                                    // B prend l'emplacement
  m.bac.tick(repere); await m.vider();
  assert.equal(m.ecrits.length, 1, "A a bien ete depose");
  assert.deepEqual(plat(boutons(m.barre)), ["Image reçue ⇩"], "le bouton de B est reste");
  // Et un second clic depose B.
  m.barre.querySelector('[data-kind="image"]').onclick(); await m.vider();
  assert.equal(m.ecrits.length, 2);
  assert.deepEqual(plat(boutons(m.barre)), []);
});

test("review : si la CONVERSION a echoue, le message dit la vraie cause, pas « le navigateur a refuse »", async () => {
  const m = await montageEntrant({ decodeur: "ancien", ecriture: "refuse" });   // write() rejette NotAllowedError sans attendre la promesse
  const repere = m.bac.minuteurs.length;
  m.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [{ format: 21, compress: true, content: trameRLE(2 * MIO), width: 1024, height: 512 }] } });
  m.bac.tick(repere); await m.vider();
  m.barre.querySelector('[data-kind="image"]').onclick(); await m.vider();
  const t = m.toasts();
  assert.ok(t.length === 1 && /Décompression/.test(t[0].texte) && !/refusé/.test(t[0].texte), JSON.stringify(t));
  assert.deepEqual(plat(boutons(m.barre)), [], "erreur definitive : plus de bouton");
});

test("review : le delai de rejeu du texte riche se calcule en OCTETS, pas en unites UTF-16", async () => {
  const m = await montageSortant();
  const html_ = "é".repeat(700000);                        // 700 000 caracteres = 1,4 Mo en UTF-8
  const ev = { preventDefault() {}, clipboardData: { items: [], files: [], getData: (t) => (t === "text/html" ? html_ : "") } };
  m.ecouteurs.paste.forEach((f) => f(ev));
  assert.equal(m.rejeux()[0].ms, 400, "1,4 Mo -> 150 + 250 ms ; en caracteres (700 000) ce serait resté a 150");
});

test("review : verify.sh refuse un argument inconnu au lieu de lancer le chemin Docker", () => {
  for (const args of [["--sans-dockr"], ["--no-docker"], ["--sans-docker", "extra"]]) {
    let code = 0, sortie = "";
    try { execFileSync("bash", [path.join(RACINE, "scripts", "verify.sh"), ...args], { stdio: "pipe" }); }
    catch (e) { code = e.status; sortie = String(e.stderr); }
    assert.equal(code, 2, args.join(" "));
    assert.match(sortie, /argument|attendu/);
  }
  const aide = execFileSync("bash", [path.join(RACINE, "scripts", "verify.sh"), "--help"]).toString();
  assert.match(aide, /--sans-docker/);
});


// ====================================================================
// Constats de l'audit independant.
// ====================================================================
test("audit F1 : une ancienne liaison relais qui se ferme APRES un connect() n'est ni « cle refusee » ni une reprise", async () => {
  const m = await montageSortant({ prete: false });
  m.peerInfo();                                            // session 1 etablie
  const ft = new m.w.WebSocket("wss://h/ws/relay");        // la liaison de la connexion « fichiers », ouverte pendant la session
  ft.emettre("open", {}); ft.emettre("message", {});
  m.w.connect = () => 1;
  m.bac.minuteurs.filter((t) => t.ms === 300 && !t.once).forEach((t) => t.f());
  m.w.connect();                                           // la reprise auto relance : nouvelle epoque, RD.ready = false
  m.horloge.decalage = 25000;                              // la liaison « fichiers » avait 25 s de vie
  let reprises = 0; m.w.__rdReprise = () => { reprises++; };
  ft.emettre("close", { code: 1006, wasClean: false, reason: "" });
  assert.equal(m.banniere(), null, "une liaison d'une epoque revolue ne dit rien de l'etablissement de la nouvelle session");
  assert.equal(reprises, 0, "et ne relance pas connect() par-dessus la tentative en cours");
});

test("audit F1 : une liaison de l'epoque COURANTE garde ses bannieres et sa reprise", async () => {
  const m = await montageSortant({ prete: false });
  m.peerInfo();
  m.w.connect = () => 1;
  m.bac.minuteurs.filter((t) => t.ms === 300 && !t.once).forEach((t) => t.f());
  m.w.connect();
  let reprises = 0; m.w.__rdReprise = () => { reprises++; };
  const neuve = new m.w.WebSocket("wss://h/ws/relay");
  neuve.emettre("open", {}); neuve.emettre("message", {});
  m.horloge.decalage = 25000;
  neuve.emettre("close", { code: 1006, wasClean: false, reason: "" });
  assert.ok(m.banniere(), "le pair n'est jamais arrive : la banniere « n'a pas rejoint le relais » est legitime");
  assert.equal(reprises, 1, "et la fermeture de la liaison de la session courante declenche la reprise");
});

test("audit F7 : « Quitter » n'eteint plus la reprise auto pour toujours", async () => {
  const m = await montageSortant({ vivante: false });
  const quit = m.bar.children.find((c) => c.className === "quit");
  quit.onclick();                                          // deconnexion VOULUE
  const repere = m.bac.minuteurs.length;
  m.w.__rdReprise();
  assert.equal(m.bac.minuteurs.slice(repere).filter((t) => t.once && t.ms >= 1000).length, 0, "voulue : pas de reprise");
  m.w.connect = () => 1;
  m.bac.minuteurs.filter((t) => t.ms === 300 && !t.once).forEach((t) => t.f());
  m.w.connect();                                           // l'utilisateur se reconnecte : nouvelle intention
  const r2 = m.bac.minuteurs.length;
  m.w.__rdReprise();
  assert.equal(m.bac.minuteurs.slice(r2).filter((t) => t.once && t.ms >= 1000).length, 1, "la reprise auto est de nouveau active");
});

test("audit F3 : chaque echec du collage TEXTE se voit aussi", async () => {
  const coller = async (m, dt) => {
    let evite = false;
    m.ecouteurs.paste.forEach((f) => f({ preventDefault() { evite = true; }, clipboardData: { items: [], files: [], getData: (t) => dt[t] || "" } }));
    await m.vider(); return evite;
  };
  const m1 = await montageSortant();
  await coller(m1, { "text/plain": "x".repeat(1048577) });
  assert.ok(m1.toasts().some((t) => t.erreur && /trop volumineux/.test(t.texte)), JSON.stringify(m1.toasts()));
  const m2 = await montageSortant({ prete: false });
  await coller(m2, { "text/plain": "bonjour" });
  assert.ok(m2.toasts().some((t) => t.erreur && /session n'est pas prête/.test(t.texte)), JSON.stringify(m2.toasts()));
  const m3 = await montageSortant({ version: "1.2.7" });
  await coller(m3, { "text/html": "<b>x</b>" });
  assert.ok(m3.toasts().some((t) => t.erreur && /trop ancien/.test(t.texte)), JSON.stringify(m3.toasts()));
  const m4 = await montageSortant();
  await coller(m4, {});
  assert.ok(m4.toasts().some((t) => t.erreur && /ni du texte ni une image/.test(t.texte)), JSON.stringify(m4.toasts()));
  // Et le chemin qui marche ne produit aucun retour d'erreur.
  const ok = await montageSortant();
  await coller(ok, { "text/plain": "bonjour" });
  assert.equal(ok.toasts().length, 0);
});

test("audit B20 : un collage d'image n'ouvre PAS en plus le televersement de fichiers", async () => {
  const m = await montageSortant();
  await m.collerImage(new Blob([new Uint8Array(100)], { type: "image/png" }));
  assert.equal(images(m).length, 1);
  assert.equal(m.depotsFichiers.n, 0, "la capture d'ecran partait AUSSI au televersement avant c110499");
  // Un fichier qui n'est pas une image, lui, va bien au televersement.
  let evite = false; const fichier = new Blob([new Uint8Array(10)], { type: "application/pdf" });
  m.ecouteurs.paste.forEach((f) => f({ preventDefault() { evite = true; },
    clipboardData: { items: [{ kind: "file", type: "application/pdf", getAsFile: () => fichier }], files: [fichier], getData: () => "" } }));
  assert.equal(m.depotsFichiers.n, 1);
});

test("audit C23 : le vrai next() de la liaison passe par ppFiltrer (le crochet est bien installe)", async () => {
  const m = await montageSortant();
  const msg = { clipboard: { format: 22, compress: false, content: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), width: 1, height: 1 } };
  // Comme le bundle dans start() : une liaison NEUVE est affectee a la connexion.
  // L'accroche sur _ws l'instrumente a l'affectation, sans attendre le veilleur.
  m.w.curConn._ws = { ...m.w.curConn._ws, next: async () => msg };
  const recu = await m.w.curConn._ws.next();
  assert.equal(recu.clipboard, undefined, "l'image est retiree du message avant le bundle");
  assert.ok(m.bar.children.some((c) => c.className === "rdppbtn"), "et son bouton est apparu : le message a bien traverse ppFiltrer");
});

test("audit D06 : l'ecouteur keyup ephemere d'Echap ne s'accumule pas", async () => {
  const m = await montageSortant();
  m.bar.children.find((c) => c.className === "rdhandle").onclick();          // ouverte
  const echap = () => m.bar.ecouteurs.keydown.forEach((f) => f({ key: "Escape", preventDefault() {}, target: { tagName: "BUTTON" } }));
  const repere = m.bac.minuteurs.length;
  echap();
  assert.equal((m.ecouteurs.keyup || []).length, 1);
  (m.ecouteurs.keyup || []).slice().forEach((f) => f({ key: "Escape" }));
  assert.equal((m.ecouteurs.keyup || []).length, 0, "retire apres le keyup");
  // Le keyup ne vient jamais : le delai de garde le retire.
  m.bar.children.find((c) => c.className === "rdhandle").onclick();          // ouverte de nouveau
  const r2 = m.bac.minuteurs.length;
  echap();
  assert.equal((m.ecouteurs.keyup || []).length, 1);
  const garde = m.bac.minuteurs.slice(r2).find((t) => t.once && t.ms === 1500);
  assert.ok(garde, "un delai de garde de 1,5 s est arme");
  garde.f();
  assert.equal((m.ecouteurs.keyup || []).length, 0, "l'ecouteur ne reste pas arme");
});

test("audit F5 : un PNG recu sans signature est une erreur definitive, pas un « DataError » generique", async () => {
  const m = await montageEntrant();
  const repere = m.bac.minuteurs.length;
  m.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [{ format: 22, compress: false, content: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), width: 1, height: 1 }] } });
  m.bac.tick(repere); await m.vider();
  m.barre.querySelector('[data-kind="image"]').onclick(); await m.vider();
  assert.equal(m.ecrits.length, 0);
  assert.ok(m.toasts().some((t) => t.erreur && /Décompression|corrompues/.test(t.texte)), JSON.stringify(m.toasts()));
  assert.deepEqual(plat(boutons(m.barre)), [], "definitive : plus de bouton");
  const { clip } = chargerLib();
  assert.equal(clip.estPng(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), true);
  assert.equal(clip.estPng(new Uint8Array(3)), false);
  assert.equal(clip.estPng(null), false);
});

test("audit F5 : les dimensions d'une image ENVOYEE sont plafonnees (32 Mpixels)", async () => {
  const { clip } = chargerLib();
  assert.deepEqual(plat(clip.reduirePixels(5000, 6000)), { w: 5000, h: 6000 }, "30 Mpx : sous 32 Mi pixels (33 554 432)");
  const c = clip.reduirePixels(6000, 6000);                     // 36 Mpx : au-dessus, donc ramene sous la limite
  assert.ok(c.w * c.h <= clip.LIM.PIXELS_MAX && c.w < 6000 && c.w === c.h, JSON.stringify(c));
  const r = clip.reduirePixels(8000, 6000);
  assert.ok(r.w * r.h <= clip.LIM.PIXELS_MAX && r.w < 8000, JSON.stringify(r));
  assert.ok(Math.abs(r.w / r.h - 8000 / 6000) < 0.01, "rapport conserve");
  assert.deepEqual(plat(clip.reduirePixels(100, 100)), { w: 100, h: 100 });
  // Bout en bout : un PNG plat de 9000 x 6000 (54 Mpx) part reduit, avec un retour.
  const m = await montageSortant({ dims: { w: 9000, h: 6000 } });
  await m.collerImage(new Blob([new Uint8Array(1000)], { type: "image/png" }));
  const cb = images(m)[0].multi_clipboards.clipboards[0];
  assert.ok(cb.width * cb.height <= clip.LIM.PIXELS_MAX && cb.width < 9000, `${cb.width}x${cb.height}`);
  assert.ok(m.toasts().some((t) => /réduite de 9000×6000/.test(t.texte)), JSON.stringify(m.toasts()));
});

test("audit F5 : un ID de plus de 32 chiffres et un horodatage a 9e99 ne s'installent pas en tete", () => {
  const { recent, normId } = chargerLib();
  assert.equal(normId("1".repeat(32)), "1".repeat(32));
  assert.equal(normId("1".repeat(33)), null);
  assert.equal(normId("1".repeat(300000)), null);
  const s = stock({ init: { "rd-recent": JSON.stringify({ v: 1, ids: [{ id: "111111111", t: 1000 }, { id: "222222222", t: 9e99 }] }) } });
  const r = recent.create(s, { now: () => 2000 });
  assert.equal(r.list()[0].id, "222222222");
  assert.ok(r.list()[0].t <= 2000 + 86400000, "horodatage borne a maintenant + un jour : " + r.list()[0].t);
  r.add("333333333");                                        // maintenant = 2000 : doit passer AVANT l'entree falsifiee ? non : elle est bornee a 2000 + 1 jour
  const peers = { "444444444": { tm: 1e300 } };
  const r2 = recent.create(stock(), { now: () => 5000 });
  r2.seedFrom(peers, "", "");
  assert.ok(r2.list()[0].t <= 5000 + 86400000);
});

test("audit F5 : Retour arriere retire une pastille comme Suppr (portables Mac)", async () => {
  const m = await montageSortant({ formulaire: true, init: { peers: PEERS } });
  let evite = false;
  m.pastilles()[0].children[0].ecouteurs.keydown.forEach((f) => f({ key: "Backspace", preventDefault() { evite = true; } }));
  assert.equal(evite, true);
  assert.equal(m.pastilles().length, 2);
});

test("audit F5 : la region aria-live des retours existe des le debut, vide", async () => {
  const m = await montageSortant();
  const zone = m.doc.body.children.find((c) => c.id === "rdtoasts");
  assert.ok(zone, "creee avec la barre, avant tout retour");
  assert.equal(zone.attrs["aria-live"], "polite");
  assert.equal(zone.children.length, 0);
});

test("audit F5 : l'anneau de focus d'une pastille n'est pas rogne par overflow:hidden", () => {
  assert.match(html, /#app>#connect #rd-recents \.rdchip:focus-within\{outline:2px solid/);
});

test("audit F6 : check-syntax.sh est un vrai controle de script CLASSIQUE (un « return; » de premier niveau est refuse)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rdsyntax-"));
  try {
    const f = path.join(tmp, "page.html");
    fs.writeFileSync(f, "<!DOCTYPE html><html><body><script>var a = 1;\nreturn;\n</script></body></html>");
    let code = 0;
    try { execFileSync("bash", [path.join(RACINE, "scripts", "check-syntax.sh"), f], { stdio: "pipe" }); }
    catch (e) { code = e.status; }
    assert.notEqual(code, 0, "« node --check » laissait passer ceci ; un navigateur abandonne le bloc en entier");
    fs.writeFileSync(f, "<!DOCTYPE html><html><body><script>var a = 1;\n</script></body></html>");
    execFileSync("bash", [path.join(RACINE, "scripts", "check-syntax.sh"), f], { stdio: "pipe" });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("audit F8 : aucune reference externe dans la page (ni CDN, ni URL absolue, ni police distante)", () => {
  assert.ok(!/https?:\/\//i.test(html), "une URL absolue est apparue dans le gabarit");
  for (const m of html.matchAll(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)) {
    assert.ok(!/^(?:https?:)?\/\//i.test(m[1]), "reference externe : " + m[1]);
  }
  assert.ok(!/@import\s+url\(\s*["']?(?:https?:)?\/\//i.test(html));
});

// ====================================================================
// Codecs : la logique pure (RDLib.codec), puis le vrai cablage.
// ====================================================================
test("codec meilleur : h265 > h264 > av1 > vp9, hors codecs qui ont echoue", () => {
  const { codec } = chargerLib();
  assert.deepEqual(plat(codec.ORDRE), ["h265", "h264", "av1", "vp9"]);
  assert.equal(codec.meilleur({ h265: true, h264: true, av1: true, vp9: true }, {}), "h265");
  assert.equal(codec.meilleur({ h265: true, h264: true, vp9: true }, { h265: true }), "h264");
  assert.equal(codec.meilleur({ h265: false, av1: true, vp9: true }, {}), "av1");
  assert.equal(codec.meilleur({ vp9: true }, { vp9: true }), null);
  assert.equal(codec.meilleur({}, {}), null);
  assert.equal(codec.meilleur(undefined, undefined), null);
});

test("codec capacites : auto annonce tout ce qui est decodable, force n'annonce que lui, VP9 toujours", () => {
  const { codec } = chargerLib();
  const caps = { h265: true, h264: true, av1: false, vp9: true };
  assert.deepEqual(plat(codec.capacites("h265", false, caps, {})),
    { ability_h265: 1, ability_h264: 1, ability_av1: 0, ability_vp9: 1, prefer: 3 });
  assert.deepEqual(plat(codec.capacites("h264", false, caps, { h265: true })),
    { ability_h265: 0, ability_h264: 1, ability_av1: 0, ability_vp9: 1, prefer: 2 }, "un codec qui a echoue n'est plus annonce");
  assert.deepEqual(plat(codec.capacites("h264", true, caps, {})),
    { ability_h265: 0, ability_h264: 1, ability_av1: 0, ability_vp9: 1, prefer: 2 }, "force : lui seul, sinon le pair en choisirait un autre");
  assert.deepEqual(plat(codec.capacites("av1", true, {}, {})),
    { ability_h265: 0, ability_h264: 0, ability_av1: 1, ability_vp9: 1, prefer: 5 });
  // Logiciel, ou un nom inconnu : la declaration d'avant, VP9 seul.
  assert.deepEqual(plat(codec.capacites(null, false, caps, {})), { ability_h265: 0, ability_vp9: 1, prefer: 1 });
  assert.deepEqual(plat(codec.capacites("divx", true, caps, {})), { ability_h265: 0, ability_vp9: 1, prefer: 1 });
  // Les valeurs de « prefer » sont celles de SupportedDecoding.PreferCodec (message.proto).
  assert.deepEqual(plat(codec.PREFER), { vp9: 1, h264: 2, h265: 3, av1: 5 });
});

test("codec flux : le champ reellement present dans le VideoFrame", () => {
  const { codec } = chargerLib();
  const lot = { frames: [] };
  assert.equal(codec.flux({ h264s: lot }).nom, "h264");
  assert.equal(codec.flux({ av1s: lot }).lot, lot);
  assert.equal(codec.flux({ vp9s: lot }).nom, "vp9");
  assert.equal(codec.flux({ vp8s: lot }), null, "VP8 n'est jamais annonce : pas de chemin pour lui");
  assert.equal(codec.flux({}), null);
  assert.equal(codec.flux(null), null);
});

test("prefs : h264 et av1 sont des codecs memorisables", () => {
  const { prefs } = chargerLib();
  const p = prefs.create(stock());
  p.set({ codec: "h264" }); assert.equal(p.get().codec, "h264");
  p.set({ codec: "av1" });  assert.equal(p.get().codec, "av1");
  p.set({ codec: "vp8" });  assert.equal(p.get().codec, "av1", "une valeur hors liste est ignoree");
});

// Une session dont la connexion est instrumentee par patchConn (veilleur 800 ms).
async function montageVideo({ caps = {}, codec = null, ...reste } = {}) {
  const m = await montageSortant(reste);
  // Une connexion NEUVE, comme le bundle en cree une par session : elle est
  // instrumentee a l'affectation de window.curConn.
  const { __rdPatchedWs, __rdOrigHandle, __rdOrigDraw, ...base } = m.w.curConn;
  const c = { ...base, _ws: { ...base._ws } };
  m.logiciel = []; m.acks = { n: 0 }; m.cles = { n: 0 }; m.decodes = [];
  c.handleVideoFrame = function (vf) { m.logiciel.push(vf); };
  c.draw = () => {}; c.msgbox = () => {};
  c.sendVideoReceived = () => { m.acks.n++; };
  c.refresh = () => { m.cles.n++; };
  m.w.EncodedVideoChunk = class { constructor(o) { this.o = o; } };
  m.w.VideoDecoder = class { constructor(o) { this.o = o; this.state = "configured"; }
    configure(cfg) { m.config = cfg; } decode(ch) { m.decodes.push(ch.o.type); } reset() {} close() { this.state = "closed"; }
    get decodeQueueSize() { return 0; } };
  m.w.RD.caps = caps; m.w.RD.codec = codec; m.w.RD.rates = {};
  m.w.curConn = c;
  m.trame = (champ, cle = true) => c.handleVideoFrame({ [champ]: { frames: [{ key: cle, pts: 0, data: new Uint8Array(8) }] } });
  m.decl = () => m.options().filter((o) => o.supported_decoding).map((o) => plat(o.supported_decoding));
  return m;
}

test("codec : le decodeur SUIT le flux recu — un pair sans H265 qui emet du VP9 n'est plus un ecran noir", async () => {
  const m = await montageVideo({ caps: { h265: true, vp9: true }, codec: "h265" });
  m.trame("vp9s");
  assert.equal(m.w.RD.codec, "vp9", "le decodeur WebCodecs est passe en VP9");
  assert.equal(m.config.codec, "vp09.00.50.08");
  assert.deepEqual(m.decodes, ["key"], "la trame qui annonce le changement est decodee, pas jetee");
  assert.equal(m.logiciel.length, 0, "rien n'est parti au decodeur logiciel, dont le canvas est masque");
  assert.equal(m.acks.n, 1, "et la trame est acquittee");
  // Le pair passe ensuite en H264 (il a lu notre declaration) : on suit encore.
  m.w.RD.caps.h264 = true;
  m.trame("h264s");
  assert.equal(m.w.RD.codec, "h264");
  assert.equal(m.config.codec, "avc1.640033");
  assert.equal(m.acks.n, 2);
});

test("codec : un flux que WebCodecs ne decode pas ici est tolere au demarrage, puis la session passe en logiciel ET le dit au pair", async () => {
  const m = await montageVideo({ caps: { h264: true }, codec: "h264" });
  for (let i = 0; i < 30; i++) m.trame("vp9s");
  assert.equal(m.w.RD.codec, "h264", "les premieres trames sont toujours du VP9 : on ne conclut pas");
  assert.equal(m.logiciel.length, 30, "elles vont au decodeur d'origine, qui les acquitte");
  assert.equal(m.decl().length, 0);
  m.trame("vp9s");
  assert.equal(m.w.RD.codec, null, "au-dela, WebCodecs est abandonne pour la session");
  assert.deepEqual(m.decl().at(-1), { ability_h265: 0, ability_vp9: 1, prefer: 1 }, "le pair n'emettra plus que du VP9");
  // Une trame du bon codec remet le compteur a zero.
  const n = await montageVideo({ caps: { h264: true }, codec: "h264" });
  for (let i = 0; i < 20; i++) n.trame("vp9s");
  n.trame("h264s");
  for (let i = 0; i < 20; i++) n.trame("vp9s");
  assert.equal(n.w.RD.codec, "h264");
});

test("codec : le repli descend l'echelle (h265 -> h264 -> logiciel) au lieu de tomber droit en logiciel", async () => {
  const m = await montageVideo({ caps: { h265: true, h264: true }, codec: "h265" });
  m.w.__rdFallback("erreurs de decodage repetees");
  assert.equal(m.w.RD.codec, "h264");
  assert.equal(m.w.RD.rates.h265, true, "H265 n'est plus propose sur cette page");
  assert.deepEqual(m.decl().at(-1), { ability_h265: 0, ability_h264: 1, ability_av1: 0, ability_vp9: 1, prefer: 2 });
  assert.equal(m.w.curConn.handleVideoFrame === m.w.curConn.__rdOrigHandle, false, "le chemin WebCodecs reste en place");
  m.w.__rdFallback("erreurs de decodage repetees");
  assert.equal(m.w.RD.codec, null, "plus rien a essayer : logiciel");
  assert.deepEqual(m.decl().at(-1), { ability_h265: 0, ability_vp9: 1, prefer: 1 });
  // La session suivante ne retente pas ce qui a echoue.
  m.peerInfo();
  assert.equal(m.w.RD.codec, null);
});

test("codec : en automatique, chaque session repart du meilleur codec encore valable", async () => {
  const m = await montageVideo({ caps: { h264: true, vp9: true }, codec: null, prete: false });
  m.peerInfo();
  assert.equal(m.w.RD.codec, "h264");
  assert.deepEqual(m.decl().at(-1), { ability_h265: 0, ability_h264: 1, ability_av1: 0, ability_vp9: 1, prefer: 2 });
});

test("codec : une erreur du decodeur redemande une image-cle (le decodeur suivant ne peut repartir que d'elle)", async () => {
  const m = await montageVideo({ caps: { h265: true }, codec: "h265" });
  m.trame("h265s");
  const avant = m.cles.n;
  m.w.RD.dec.o.error(new Error("boom"));
  assert.equal(m.w.RD.wantKey, true);
  assert.equal(m.cles.n, avant + 1);
});

// ====================================================================
// Actions sur le poste distant, ecrans, retours du pair, 2FA.
// ====================================================================
// La modale de la page (bloc fichiers), telle que le DOM fictif la garde : la
// derniere boite construite.
function boite(m) {
  const modal = m.doc.body.children.find((c) => c.id === "rdmodal");
  const b = modal && modal.children.at(-1);
  if (!b) return null;
  const btns = b.children.find((c) => c.className === "btns").children;
  const champ = b.children.find((c) => c.tag === "input") || null;
  return { titre: b.children[0].textContent, champ,
           ok: (v) => { if (champ && v !== undefined) champ.value = v; btns.at(-1).onclick(); },
           annuler: () => btns[0].onclick() };
}
const menuActions = (m) => m.bar.children.find((c) => c.className === "rdactions");
const menuEcrans = (m) => m.bar.children.find((c) => c.className === "rdecrans");
const choisir = (sel, v) => { sel.value = v; sel.onchange(); };

test("actions : Ctrl+Alt+Suppr et verrouillage passent par le bundle, et le selecteur revient a son libelle", async () => {
  const m = await montageSortant();
  const act = menuActions(m);
  assert.ok(act, "le menu est un enfant direct de la barre");
  assert.equal(act.children[0].textContent, "Actions");
  const avant = m.player.focuses;
  choisir(act, "cad");
  choisir(act, "lock");
  assert.deepEqual(m.touches.filter(([n]) => n === "ctrl_alt_del" || n === "lock_screen").map(([n]) => n), ["ctrl_alt_del", "lock_screen"]);
  assert.equal(act.value, "");
  assert.ok(m.player.focuses >= avant + 2, "le canvas reprend le clavier apres chaque action");
});

test("actions : une option basculee est cochee d'apres l'etat du bundle, pas d'apres le clic", async () => {
  const m = await montageSortant();
  const etat = {};
  m.w.curConn.getOption = (k) => etat[k];
  const act = menuActions(m);
  const libelle = (v) => act.children.find((o) => o.value === v).textContent;
  choisir(act, "opt:disable-audio");
  assert.deepEqual(m.touches.at(-1), ["toggle_option", "disable-audio"]);
  assert.equal(libelle("opt:disable-audio"), "Couper le son distant", "le bundle n'a rien retenu : pas de coche");
  etat["disable-audio"] = true;
  m.w.__rdActions();
  assert.equal(libelle("opt:disable-audio"), "✓ Couper le son distant");
  assert.equal(act.children.length, 9, "la liste est reconstruite, pas empilee");
});

test("actions : bloquer la saisie — deux ordres distincts, et l'etat vient de la reponse du pair", async () => {
  const m = await montageSortant();
  const act = menuActions(m), c = m.w.curConn;
  const libelle = () => act.children.find((o) => o.value === "opt:block-input").textContent;
  choisir(act, "opt:block-input");
  assert.deepEqual(m.touches.at(-1), ["toggle_option", "block-input"]);
  assert.equal(libelle(), "Bloquer la saisie locale", "pas de coche tant que le pair n'a pas confirme");
  m.w.__rdPairFiltrer(c, { misc: { back_notification: { block_input_state: 2 } } });
  assert.equal(libelle(), "✓ Bloquer la saisie locale");
  choisir(act, "opt:block-input");
  assert.deepEqual(m.touches.at(-1), ["toggle_option", "unblock-input"]);
  // Un refus se voit, et ne coche rien.
  const n = await montageSortant();
  n.w.__rdPairFiltrer(n.w.curConn, { misc: { back_notification: { block_input_state: 3, details: "No permission" } } });
  assert.ok(n.toasts().some((t) => t.erreur && /refusé de bloquer/.test(t.texte) && /No permission/.test(t.texte)), JSON.stringify(n.toasts()));
  // Une nouvelle session repart debloquee.
  m.peerInfo();
  assert.equal(libelle(), "Bloquer la saisie locale");
});

test("actions : un mode confidentialite refuse est DECOCHE dans le bundle, sinon il serait redemande a chaque session", async () => {
  const m = await montageSortant();
  const poses = [];
  m.w.curConn.setOption = (k, v) => poses.push([k, v]);
  const msg = { misc: { back_notification: { privacy_mode_state: 3 } } };
  assert.equal(m.w.__rdPairFiltrer(m.w.curConn, msg), msg, "le message continue vers le bundle");
  assert.deepEqual(poses, [["privacy-mode", false]]);
  assert.ok(m.toasts().some((t) => t.erreur && /ne propose pas le mode confidentialité/.test(t.texte)));
  m.w.__rdPairFiltrer(m.w.curConn, { misc: { back_notification: { privacy_mode_state: 4 } } });
  assert.deepEqual(poses.at(-1), ["privacy-mode", true]);
});

test("actions : redemarrer demande confirmation ; un refus n'envoie rien", async () => {
  const m = await montageSortant();
  const act = menuActions(m);
  // Le bundle REMPLACE window.confirm par sa validation de mot de passe : la
  // page ne doit jamais s'en servir. Si elle le faisait, ce test le verrait.
  let natif = 0;
  m.w.confirm = () => { natif++; return true; };
  choisir(act, "restart");
  assert.equal(boite(m).titre, "Redémarrer le poste distant ?");
  boite(m).annuler(); await m.vider();
  assert.ok(!m.envoyes.some((x) => x.misc && x.misc.restart_remote_device));
  choisir(act, "restart");
  boite(m).ok(); await m.vider();
  assert.ok(m.envoyes.some((x) => x.misc && x.misc.restart_remote_device === true));
  assert.equal(natif, 0, "window.confirm n'est jamais appele");
});

test("retour du pair : table des etats, valeurs inconnues sans effet", () => {
  const { pair } = chargerLib();
  assert.deepEqual(plat(pair.retour({ block_input_state: 4 })), { option: "block-input", actif: false, ok: true, texte: "Saisie locale débloquée sur le poste distant.", details: "" });
  assert.equal(pair.retour({ block_input_state: 3, details: " No permission " }).details, "No permission", "les details accompagnent un echec, a part du texte traduisible");
  assert.equal(pair.retour({ privacy_mode_state: 9 }).actif, false);
  assert.equal(pair.retour({ privacy_mode_state: 10 }).actif, true, "l'arret a echoue : le mode est toujours actif");
  for (const v of [{ block_input_state: 0 }, { privacy_mode_state: 0 }, { privacy_mode_state: 99 }, { block_input_state: "__proto__" }, {}, null, "x"]) {
    assert.equal(pair.retour(v).option, null, JSON.stringify(v));
  }
  assert.equal(pair.retour({ block_input_state: 2, details: "bruit" }).details, "", "les details n'accompagnent qu'un echec");
});

test("ecrans : le selecteur n'apparait qu'avec plusieurs ecrans, et suit la reponse du pair", async () => {
  const m = await montageSortant({ prete: false });
  const ecr = menuEcrans(m);
  const info = (displays, current_display = 0) => m.w.onGlobalEvent(JSON.stringify({ name: "peer_info",
    displays: JSON.stringify(displays), current_display: JSON.stringify(current_display) }));
  info([{ width: 2560, height: 1440 }]);
  assert.equal(ecr.style.display, "none", "un seul ecran : rien a choisir");
  info([{ width: 2560, height: 1440 }, { width: 1920, height: 1080 }], 1);
  assert.equal(ecr.style.display, "");
  assert.deepEqual(ecr.children.map((o) => o.textContent), ["Écran 1 (2560×1440)", "Écran 2 (1920×1080)"]);
  assert.equal(ecr.value, "1", "l'ecran affiche est celui que le pair annonce");
  assert.equal(m.w.RD.W, 1920);
  choisir(ecr, "0");
  assert.deepEqual(m.touches.at(-1), ["switch_display", 0], "un NOMBRE : le bundle l'encode en int32");
  assert.equal(m.w.RD.display, 1, "rien ne change avant la reponse du pair");
  m.w.onGlobalEvent(JSON.stringify({ name: "switch_display", display: "0", width: "2560", height: "1440" }));
  assert.equal(m.w.RD.display, 0);
  assert.equal(ecr.value, "0");
  // Rechoisir l'ecran deja affiche n'envoie rien.
  const n = m.touches.length;
  choisir(ecr, "0");
  assert.equal(m.touches.length, n);
});

test("2fa : le code est demande dans la modale, envoye en auth_2fa, et l'erreur n'atteint pas le bundle", async () => {
  const m = await montageSortant({ prete: false });
  const c = m.w.curConn;
  let natif = 0;
  m.w.prompt = () => { natif++; return "000000"; };
  let p = m.w.__rdPairFiltrer(c, { login_response: { error: "2FA Required" } });
  await m.vider();
  assert.equal(boite(m).titre, "Vérification en deux étapes");
  boite(m).ok("123 456");
  assert.deepEqual(plat(await p), {}, "un message vide : le bundle n'affiche pas « Login Error »");
  assert.deepEqual(plat(m.envoyes.at(-1)), { auth_2fa: { code: "123456" } }, "envoye avant peer_info, donc sans passer par rdSend");
  // Code refuse par le pair : on redemande, avec un autre titre.
  p = m.w.__rdPairFiltrer(c, { login_response: { error: "Wrong 2FA Code" } });
  await m.vider();
  assert.equal(boite(m).titre, "Code refusé");
  boite(m).ok("654321");
  await p;
  assert.equal(m.envoyes.at(-1).auth_2fa.code, "654321");
  // Saisie invalide : redemandee sans rien envoyer ; annulation : l'erreur passe au bundle.
  const avant = m.envoyes.length;
  const msg = { login_response: { error: "2FA Required" } };
  p = m.w.__rdPairFiltrer(c, msg);
  await m.vider();
  boite(m).ok("abc"); await m.vider();
  assert.equal(boite(m).titre, "Code refusé", "une saisie qui n'est pas un code est redemandee");
  boite(m).annuler();
  assert.equal(await p, msg);
  assert.equal(m.envoyes.length, avant);
  assert.equal(natif, 0, "pas de prompt() natif : il gelerait la page");
  // Les autres erreurs, et une connexion reussie, ne sont pas touchees.
  for (const autre of [{ login_response: { error: "Wrong Password" } }, { login_response: { peer_info: {} } }, { video_frame: {} }, null]) {
    assert.equal(m.w.__rdPairFiltrer(c, autre), autre);
  }
});

test("2fa : code2fa n'accepte que six chiffres", () => {
  const { pair } = chargerLib();
  assert.equal(pair.code2fa(" 123 456 "), "123456");
  for (const v of ["12345", "1234567", "12a456", "", null, 123456]) assert.equal(pair.code2fa(v), null, String(v));
  assert.equal(pair.demande2fa("2FA Required"), "demande");
  assert.equal(pair.demande2fa("Wrong 2FA Code"), "faux");
  assert.equal(pair.demande2fa("Wrong Password"), null);
});

test("barre : elle passe a la ligne au lieu de deborder d'une fenetre etroite", () => {
  assert.match(html, /#rdbar\{[^}]*flex-wrap:wrap;[^}]*max-width:100vw/);
});

// ====================================================================
// Entrees : molette, tactile, souris, latence.
// ====================================================================
test("molette : une souris fait un cran par cran, un trackpad cumule ses pixels", () => {
  const { molette } = chargerLib();
  const m = molette.creer(100);
  assert.deepEqual(plat(m.pousser(0, 100, 0)), { x: 0, y: -1 }, "vers le bas : cran negatif, comme avant");
  assert.deepEqual(plat(m.pousser(0, -120, 0)), { x: 0, y: 1 });
  assert.deepEqual(plat(m.pousser(0, 3, 1)), { x: 0, y: -1 }, "Firefox compte en lignes : 3 lignes = un cran");
  // Un trackpad : soixante evenements de 4 px ne font pas soixante crans.
  const t = molette.creer(100);
  let crans = 0;
  for (let i = 0; i < 60; i++) crans += t.pousser(0, 4, 0).y;
  assert.equal(crans, -2);
  // Un demi-tour jette le reste accumule dans l'autre sens.
  const d = molette.creer(100);
  d.pousser(0, 90, 0);
  assert.deepEqual(plat(d.pousser(0, -20, 0)), { x: 0, y: 0 });
  assert.deepEqual(plat(d.pousser(0, -80, 0)), { x: 0, y: 1 });
  // Borne, et pas de -0 qui passerait pour un envoi.
  assert.equal(molette.creer(100).pousser(0, 1e6, 0).y, -10);
  assert.ok(Object.is(molette.creer(100).pousser(0, 0, 0).y, 0));
  assert.deepEqual(plat(molette.creer(100).pousser("x", undefined, 0)), { x: 0, y: 0 });
});

test("tactile : toucher = clic, glisser = bouton tenu, appui long = clic droit, deux doigts = molette", () => {
  const { tactile } = chargerLib();
  const noms = (a) => plat(a).map((x) => x.a);
  // Toucher bref.
  let t = tactile.creer();
  assert.deepEqual(noms(t.down(1, 50, 50)), ["move"]);
  assert.deepEqual(noms(t.move(1, 53, 52)), [], "sous le seuil : ce n'est pas un glisser");
  assert.deepEqual(plat(t.up(1)), [{ a: "down", x: 50, y: 50 }, { a: "up", x: 50, y: 50 }]);
  assert.equal(t.etat(), "repos");
  // Glisser : le bouton descend au point de DEPART, et remonte au point d'arrivee.
  t = tactile.creer();
  t.down(1, 10, 10);
  assert.deepEqual(plat(t.move(1, 40, 10)), [{ a: "down", x: 10, y: 10 }, { a: "move", x: 40, y: 10 }]);
  assert.deepEqual(noms(t.move(1, 80, 30)), ["move"]);
  assert.deepEqual(plat(t.up(1)), [{ a: "up", x: 80, y: 30 }]);
  // Appui long : clic droit, puis le lever du doigt ne clique pas une seconde fois.
  t = tactile.creer();
  t.down(1, 5, 5);
  assert.deepEqual(plat(t.long()), [{ a: "clic-droit", x: 5, y: 5 }]);
  assert.deepEqual(plat(t.up(1)), []);
  // Un appui long n'a plus lieu une fois le glisser commence.
  t = tactile.creer(); t.down(1, 0, 0); t.move(1, 50, 0);
  assert.deepEqual(plat(t.long()), []);
  // Deux doigts : molette dans le sens naturel, et aucun clic au lever.
  t = tactile.creer();
  t.down(1, 100, 100); t.down(2, 200, 100);
  assert.deepEqual(plat(t.move(1, 100, 60)), [{ a: "wheel", dx: 0, dy: 20 }], "les doigts montent : le contenu aussi, donc defilement vers le bas");
  assert.deepEqual(plat(t.up(1)), []);
  assert.deepEqual(plat(t.move(2, 300, 300)), [], "le doigt restant ne pilote plus rien");
  assert.deepEqual(plat(t.up(2)), []);
  assert.equal(t.etat(), "repos");
  // Un second doigt pendant un glisser relache d'abord le bouton.
  t = tactile.creer(); t.down(1, 0, 0); t.move(1, 50, 0);
  assert.deepEqual(noms(t.down(2, 90, 0)), ["up"]);
  // Annulation par le navigateur : ce qui est tenu est relache.
  t = tactile.creer(); t.down(1, 0, 0); t.move(1, 50, 0);
  assert.deepEqual(noms(t.cancel()), ["up"]);
  assert.deepEqual(plat(t.up(1)), [], "un lever qui arrive apres l'annulation est ignore");
});

test("souris : un bouton enfonce est relache quand la fenetre perd le focus ; les coordonnees restent dans l'image", async () => {
  const bac0 = await montageSortant();
  const c = bac0.player;
  c.width = 800; c.height = 600;
  c.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 300 });
  const ev = (x, y, button = 0) => ({ clientX: x, clientY: y, button, preventDefault() {}, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false });
  c.ecouteurs.mousedown.forEach((f) => f(ev(300, 200)));
  assert.deepEqual(bac0.touches.at(-1), ["send_mouse", { type: "down", buttons: "left", x: 400, y: 300, alt: "false", ctrl: "false", shift: "false", command: "false" }]);
  // Hors de l'image (la capture du pointeur y ramene les evenements) : borne.
  c.ecouteurs.mousemove.forEach((f) => f(ev(9999, -50)));
  assert.deepEqual([bac0.touches.at(-1)[1].x, bac0.touches.at(-1)[1].y], [799, 0]);
  // La page pose son ecouteur « blur » sur window : on le retrouve par un second montage espion.
  const m = await montageSortantAvecBlur();
  m.player.width = 800; m.player.height = 600;
  m.player.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  m.player.ecouteurs.mousedown.forEach((f) => f(ev(10, 20, 2)));
  const avant = m.touches.length;
  m.blur.forEach((f) => f());
  assert.deepEqual(m.touches.slice(avant), [["send_mouse", { type: "up", buttons: "right", x: 10, y: 20, alt: "false", ctrl: "false", shift: "false", command: "false" }]]);
  m.blur.forEach((f) => f());
  assert.equal(m.touches.length, avant + 1, "rien a relacher la seconde fois");
});
async function montageSortantAvecBlur() {
  const m = await montageSortant();
  // Recabler un canvas neuf en capturant ce que la page ecoute sur window.
  const blur = [];
  m.w.addEventListener = (t, f) => { if (t === "blur") blur.push(f); };
  const neuf = elementRecord("canvas");
  neuf.id = "player"; neuf.ecouteurs = {}; neuf.parent = elementRecord("div");
  neuf.addEventListener = (t, f) => { (neuf.ecouteurs[t] ||= []).push(f); };
  m.reg.player = neuf;
  m.bac.minuteurs.filter((t) => t.ms === 400 && !t.once).forEach((t) => t.f());
  return { ...m, player: neuf, blur };
}

test("tactile (cablage) : un toucher sur le canvas devient un clic gauche, sans modificateur", async () => {
  const m = await montageSortant();
  const c = m.player;
  c.width = 800; c.height = 600;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  c.setPointerCapture = () => {};
  const p = (x, y) => ({ pointerType: "touch", pointerId: 7, clientX: x, clientY: y });
  const avant = m.touches.length;
  c.ecouteurs.pointerdown.forEach((f) => f(p(120, 80)));
  c.ecouteurs.pointerup.forEach((f) => f(p(120, 80)));
  assert.deepEqual(m.touches.slice(avant).map(([n, a]) => [n, a.type, a.buttons, a.x, a.y]),
    [["send_mouse", "", "", 120, 80], ["send_mouse", "down", "left", 120, 80], ["send_mouse", "up", "left", 120, 80]]);
  // Une souris ne passe PAS par la machine tactile (elle a ses propres evenements).
  const n = m.touches.length;
  c.ecouteurs.pointerdown.forEach((f) => f({ pointerType: "mouse", pointerId: 1, clientX: 5, clientY: 5 }));
  assert.equal(m.touches.length, n);
  assert.equal(c.style.touchAction, "none");
});

test("latence : lue dans le message test_delay, plus dans la console", async () => {
  const m = await montageSortant();
  const msg = { test_delay: { last_delay: 42, target_bitrate: 5000 } };
  assert.equal(m.w.__rdPairFiltrer(m.w.curConn, msg), msg, "le message continue vers le bundle, qui y repond");
  assert.deepEqual(plat(m.w.RD.stats.delay), [42]);
  assert.equal(m.w.RD.stats.bitrate, 5000);
  assert.ok(!/S\.delay\.push\(a\.last_delay\)/.test(html), "la console n'est plus une source de mesure");
});

test("accroches : connect() est protege a l'affectation, et une liaison neuve est instrumentee sans minuteur", async () => {
  const m = await montageSortant({ prete: true });
  m.w.connect = () => 7;
  assert.equal(m.w.connect(), 7);
  assert.equal(m.w.RD.ready, false, "protege sans attendre le minuteur de 300 ms");
  const c = { ...m.w.curConn, handleVideoFrame() {}, draw() {} };
  m.w.curConn = c;
  const brut = async () => null;
  c._ws = { _websocket: { readyState: 1 }, sendMessage() {}, next: brut };
  assert.notEqual(c._ws.next, brut, "next() de la liaison neuve est enveloppe des son affectation");
});

test("memorisation : le mot de passe du pair n'est garde que si l'utilisateur le veut", async () => {
  const veilleur = (m) => m.bac.minuteurs.filter((t) => t.ms === 800 && !t.once).forEach((t) => t.f());
  const m = await montageSortant();
  let etat = false; const poses = [];
  m.w.curConn.getRemember = () => etat;
  m.w.curConn.setRemember = (v) => { etat = v; poses.push(v); };
  veilleur(m);
  assert.deepEqual(poses, [true], "par defaut, comme avant");
  const n = await montageSortant({ init: { "rd-prefs": JSON.stringify({ v: 1, remember: false }) } });
  let e2 = true; const p2 = [];
  n.w.curConn.getRemember = () => e2;
  n.w.curConn.setRemember = (v) => { e2 = v; p2.push(v); };
  veilleur(n);
  assert.deepEqual(p2, [false], "decoche : le bundle efface le mot de passe a la prochaine connexion reussie");
});

test("titre : l'onglet porte le nom du poste pendant la session", async () => {
  const m = await montageSortant({ prete: false });
  m.w.curConn._peerInfo.hostname = "mac-mini\u0007";
  m.peerInfo();
  assert.equal(m.doc.title, "mac-mini — RustDesk");
  const n = await montageSortant({ prete: false });
  n.peerInfo();
  assert.equal(n.doc.title, "123 456 789 — RustDesk", "sans nom de poste : l'ID");
});

// ====================================================================
// Securite du deploiement : en-tetes, injection HTML du bundle, manifeste.
// ====================================================================
test("nginx : chaque bloc qui declare un add_header repete les en-tetes de securite (nginx n'herite pas)", () => {
  const conf = lire(path.join(RACINE, "nginx.conf.template"));
  const exiges = ["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "Content-Security-Policy"];
  const blocsLoc = [...conf.matchAll(/^[ \t]*location[^{\n]*\{([^}]*)\}/gm)].map((m) => m[0]);
  const avec = blocsLoc.filter((b) => /add_header/.test(b));
  assert.equal(avec.length, 3, "les trois blocs qui posent le cookie de session");
  for (const b of avec) for (const h of exiges) assert.ok(b.includes("add_header " + h), h + " manque dans : " + b.split("\n")[0]);
  const niveauServeur = conf.replace(/^[ \t]*location[^{\n]*\{[^}]*\}/gm, "");
  for (const h of exiges) assert.ok(niveauServeur.includes("add_header " + h), h + " manque au niveau server");
  const csp = /add_header Content-Security-Policy "([^"]+)"/.exec(conf)[1];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!/https?:|\*/.test(csp.replace(/wss?:\/\/\$host/g, "")), "aucun hote tiers, aucun joker : " + csp);
});

avecVendor("patch 6 : le texte venu du pair est echappe avant innerHTML", () => {
  const b = lire(BUNDLE);
  assert.ok(!/font-weight: bold;">'\+t\+"<\/div>"/.test(b), "une concatenation brute de t subsiste");
  assert.equal((b.match(/font-weight: bold;">'\+String\(t\)\.replace\(/g) || []).length, 2);
  // L'expression injectee, evaluee telle quelle.
  const ech = /String\(t\)\.replace\(\/\[[^\]]+\]\/g,x=>"&#"\+x\.charCodeAt\(0\)\+";"\)/.exec(b)[0];
  const f = new Function("t", "return " + ech);
  assert.equal(f('<img src=x onerror="alert(1)">'), "&#60;img src=x onerror=&#34;alert(1)&#34;&#62;");
  assert.equal(f("Wrong Password"), "Wrong Password");
});

test("manifeste : la page est installable, et rien n'y pointe hors du deploiement", () => {
  const m = JSON.parse(lire(path.join(RACINE, "web", "manifest.json")));
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, ".");
  for (const i of m.icons) {
    assert.ok(!/^(?:https?:)?\/\//.test(i.src));
    assert.ok(fs.existsSync(path.join(RACINE, "web", i.src)), i.src + " absent de web/");
  }
  assert.ok(m.icons.some((i) => i.sizes === "192x192") && m.icons.some((i) => i.sizes === "512x512"));
  // Derriere l'authentification Basic, le manifeste n'est servi qu'avec les identifiants.
  assert.match(html, /<link rel="manifest" href="manifest\.json" crossorigin="use-credentials">/);
  const extraction = lire(path.join(RACINE, "scripts", "extract-assets.sh"));
  for (const f of ["manifest.json", "icon-192.png", "icon-512.png"]) assert.ok(extraction.includes(f), f + " n'est pas copie dans html/");
});

// ====================================================================
// Langue : le francais est la cle, l'anglais la traduction.
// ====================================================================
test("i18n : francais par defaut, anglais sur demande, substitution des arguments", () => {
  const { i18n } = chargerLib();
  const fr = i18n.creer("fr"), en = i18n.creer("en");
  assert.equal(fr("Quitter"), "Quitter");
  assert.equal(en("Quitter"), "Quit");
  assert.equal(en("Écran {0}", 2), "Display 2");
  assert.equal(fr("reconnexion {0}/6 dans {1} s", 3, 4), "reconnexion 3/6 dans 4 s");
  assert.equal(en("un texte que personne n'a traduit"), "un texte que personne n'a traduit", "absent du dictionnaire : le francais, jamais du vide");
  assert.equal(en("toString"), "toString", "une cle heritee d'Object n'est pas une traduction");
  assert.equal(en("Écran {0}"), "Display ", "un argument manquant ne s'affiche pas « undefined »");
  // Le choix memorise, sinon le navigateur ; francais si la langue est inconnue.
  assert.equal(i18n.langue("en", "fr-FR"), "en");
  assert.equal(i18n.langue(undefined, "fr-CH"), "fr");
  assert.equal(i18n.langue(undefined, "de-DE"), "en");
  assert.equal(i18n.langue("xx", undefined), "fr");
});

test("i18n : chaque texte de l'interface a sa traduction, avec les memes emplacements", () => {
  const lib = chargerLib(), EN = lib.i18n.EN;
  // Les cles ecrites en dur dans la page : T("…").
  const cles = new Set([...html.matchAll(/(?<![\w.])T\("((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse('"' + m[1] + '"')));
  assert.ok(cles.size > 100, "le releve a trouve " + cles.size + " cles : l'expression ne voit plus les appels");
  // Celles qui passent par une table avant d'atteindre T().
  for (const v of Object.values(plat(lib.messages))) cles.add(v);
  for (const v of Object.values(plat(lib.i18n.STATUTS))) cles.add(v);
  for (const etat of [2, 3, 4, 5]) cles.add(lib.pair.retour({ block_input_state: etat }).texte);
  for (const etat of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) cles.add(lib.pair.retour({ privacy_mode_state: etat }).texte);
  for (const m of html.matchAll(/\["(?:disable-audio|disable-clipboard|lock-after-session-end|privacy-mode|block-input)","([^"]+)"\]/g)) cles.add(m[1]);
  for (const m of html.matchAll(/(?:echec|finirJob\(j,)\s*\(?"([^"]+)"\)/g)) cles.add(m[1]);
  const manquantes = [...cles].filter((k) => !Object.prototype.hasOwnProperty.call(EN, k));
  assert.deepEqual(manquantes, [], "textes sans traduction anglaise");
  const emplacements = (t) => (t.match(/\{\d\}/g) || []).sort().join("");
  for (const [k, v] of Object.entries(plat(EN))) {
    assert.ok(typeof v === "string" && v.trim(), "traduction vide : " + k);
    assert.equal(emplacements(v), emplacements(k), "emplacements differents : " + k);
  }
  // Les libelles alignes de la telemetrie gardent leur largeur.
  for (const k of ["aller-retour  p50/p95/p99   ", "décodage      p50/p95/p99   "]) assert.equal(EN[k].length, k.length, k);
});

test("i18n : la barre et les retours suivent la langue memorisee", async () => {
  const m = await montageSortant({ init: { "rd-prefs": JSON.stringify({ v: 1, lang: "en" }) } });
  assert.equal(m.w.__rdLangue, "en");
  assert.equal(m.bar.children.find((c) => c.className === "quit").textContent, "Quit");
  assert.equal(menuActions(m).children[0].textContent, "Actions");
  assert.equal(menuActions(m).children.find((o) => o.value === "opt:privacy-mode").textContent, "Privacy mode");
  m.w.__rdPairFiltrer(m.w.curConn, { misc: { back_notification: { privacy_mode_state: 3, details: "x" } } });
  assert.ok(m.toasts().some((t) => t.texte === "The remote machine does not offer privacy mode. (x)"), JSON.stringify(m.toasts()));
  // Sans preference ni langue de navigateur connue : francais.
  const fr = await montageSortant();
  assert.equal(fr.w.__rdLangue, "fr");
  assert.equal(fr.bar.children.find((c) => c.className === "quit").textContent, "Quitter");
});

// ====================================================================
// Assemblage de la page, et ce que l'historique garde.
// ====================================================================
test("assemblage : chaque source de web/src/ est incluse, aucune directive ne reste dans la page", () => {
  assert.ok(!/@inclure/.test(html), "une directive d'inclusion n'a pas ete resolue");
  const src = path.join(RACINE, "web", "src");
  const squelette = lire(path.join(src, "page.html"));
  for (const f of fs.readdirSync(src).filter((n) => /\.(js|css)$/.test(n))) {
    assert.ok(squelette.includes("@inclure " + f), f + " n'est inclus nulle part");
    assert.ok(html.includes(lire(path.join(src, f)).trimEnd()), f + " n'est pas dans la page assemblee");
  }
  // Le gabarit est un produit : il ne doit pas revenir dans le depot.
  assert.match(lire(path.join(RACINE, ".gitignore")), /^web\/index\.html\.template$/m);
  execFileSync("python3", [path.join(RACINE, "scripts", "build-page.py"), "--verifier"], { stdio: "pipe" });
});

test("historique : le nom du poste accompagne l'ID, nettoye et borne ; rien d'autre n'est ecrit", () => {
  const { recent } = chargerLib();
  const s = stock();
  const r = recent.create(s, { now: horloge() });
  r.add("111111111", "mac-mini");
  r.add("222222222", "  <b>x</b>\u0000" + "a".repeat(80));
  r.add("111111111");                                   // reconnexion sans nom : l'ancien est garde
  const l = plat(r.list());
  assert.equal(l[0].id, "111111111"); assert.equal(l[0].n, "mac-mini");
  assert.equal(l[1].n.length, 40, "borne a 40 caracteres");
  assert.ok(!/\u0000/.test(l[1].n));
  for (const e of JSON.parse(s.m.get("rd-recent")).ids) assert.ok(Object.keys(e).every((k) => ["id", "t", "n"].includes(k)), JSON.stringify(e));
  r.add("333333333", { toString() { return "piege"; } });
  assert.equal(plat(r.list())[0].n, undefined, "un nom qui n'est pas une chaine est ignore");
});

// ====================================================================
// Clavier : traduction des raccourcis entre PC et Mac.
// ====================================================================
const touche = (nom, mods = "") => ({ nom, ctrl: mods.includes("C"), alt: mods.includes("A"), shift: mods.includes("S"), meta: mods.includes("M") });
const ecrit = (r) => [r.ctrl && "Ctrl", r.alt && "Alt", r.shift && "Maj", r.meta && "Cmd", r.nom].filter(Boolean).join("+");

test("clavier mode : PC devant Mac, Mac devant PC, rien entre semblables ou inconnus", () => {
  const { clavier } = chargerLib();
  assert.equal(clavier.mode("Win32", "Mac OS"), "pc-mac");
  assert.equal(clavier.mode("Linux x86_64", "Mac OS"), "pc-mac");
  assert.equal(clavier.mode("MacIntel", "Windows"), "mac-pc");
  assert.equal(clavier.mode("macOS", "Linux"), "mac-pc");
  assert.equal(clavier.mode("Win32", "Windows"), "direct");
  assert.equal(clavier.mode("MacIntel", "Mac OS"), "direct");
  assert.equal(clavier.mode("Win32", ""), "direct", "plateforme du pair inconnue : on ne devine pas");
  assert.equal(clavier.mode(undefined, "Mac OS"), "direct");
});

test("clavier pc-mac : chaque raccourci PC donne le raccourci Mac de MEME EFFET", () => {
  const { clavier } = chargerLib();
  const t = (nom, mods) => ecrit(clavier.traduire("pc-mac", touche(nom, mods)));
  // Le cas general : Ctrl devient Cmd.
  assert.equal(t("c", "C"), "Cmd+c");
  assert.equal(t("z", "CS"), "Maj+Cmd+z");
  assert.equal(t("s", "CA"), "Alt+Cmd+s");
  // Deplacement et effacement par mot : Option, pas Cmd (qui irait en bout de ligne).
  assert.equal(t("LeftArrow", "C"), "Alt+LeftArrow");
  assert.equal(t("RightArrow", "CS"), "Alt+Maj+RightArrow");
  assert.equal(t("Backspace", "C"), "Alt+Backspace");
  assert.equal(t("Delete", "C"), "Alt+Delete");
  // Debut / Fin : sur Mac ces touches ne deplacent pas le curseur.
  assert.equal(t("Home", ""), "Cmd+LeftArrow");
  assert.equal(t("End", "S"), "Maj+Cmd+RightArrow");
  assert.equal(t("Home", "C"), "Cmd+UpArrow");
  assert.equal(t("End", "CS"), "Maj+Cmd+DownArrow");
  // Ceux qui gardent Control : Cmd+Tab ouvrirait le selecteur d'applications, Cmd+Espace Spotlight.
  assert.equal(t("Tab", "C"), "Ctrl+Tab");
  assert.equal(t("Tab", "CS"), "Ctrl+Maj+Tab");
  assert.equal(t("Space", "C"), "Ctrl+Space");
  // Les raccourcis propres a Windows.
  assert.equal(t("y", "C"), "Maj+Cmd+z");
  assert.equal(t("F4", "A"), "Cmd+q");
  assert.equal(t("F4", "C"), "Cmd+w");
  assert.equal(t("Tab", "A"), "Cmd+Tab");
  assert.equal(t("LeftArrow", "A"), "Cmd+[");
  assert.equal(t("Insert", "C"), "Cmd+c");
  assert.equal(t("Delete", "S"), "Cmd+x");
  assert.equal(t("Escape", "CS"), "Alt+Cmd+Escape");
  // La touche Windows devient Control ; avec Ctrl en plus, rien ne bouge.
  assert.equal(t("e", "M"), "Ctrl+e");
  assert.equal(t("x", "CM"), "Ctrl+Cmd+x");
  // Sans modificateur, et les touches qui n'ont pas d'equivalent : intactes.
  for (const n of ["Return", "Escape", "Tab", "LeftArrow", "Delete", "Backspace", "F5", "PageDown"]) assert.equal(t(n, ""), n);
  assert.equal(t("LeftArrow", "S"), "Maj+LeftArrow");
  assert.equal(t("e", "A"), "Alt+e");
  // Hors mode de traduction : tel quel, et l'entree n'est jamais modifiee.
  const entree = touche("c", "C");
  assert.equal(ecrit(clavier.traduire("direct", entree)), "Ctrl+c");
  clavier.traduire("pc-mac", entree);
  assert.deepEqual(entree, touche("c", "C"));
});

test("clavier mac-pc : l'inverse, pour un Mac devant un PC", () => {
  const { clavier } = chargerLib();
  const t = (nom, mods) => ecrit(clavier.traduire("mac-pc", touche(nom, mods)));
  assert.equal(t("c", "M"), "Ctrl+c");
  assert.equal(t("LeftArrow", "M"), "Home");
  assert.equal(t("DownArrow", "MS"), "Ctrl+Maj+End");
  assert.equal(t("LeftArrow", "A"), "Ctrl+LeftArrow");
  assert.equal(t("Backspace", "A"), "Ctrl+Backspace");
  assert.equal(t("z", "MS"), "Ctrl+y");
  assert.equal(t("q", "M"), "Alt+F4");
  assert.equal(t("Tab", "C"), "Ctrl+Tab");
  assert.equal(t("a", ""), "a");
  // Aller puis retour : les raccourcis d'edition courants retombent sur eux-memes.
  for (const [n, m] of [["c", "C"], ["v", "C"], ["LeftArrow", "C"], ["Backspace", "C"], ["Home", ""], ["End", "S"], ["Home", "C"], ["y", "C"], ["F4", "A"], ["Tab", "C"]]) {
    const aller = clavier.traduire("pc-mac", touche(n, m));
    assert.equal(ecrit(clavier.traduire("mac-pc", aller)), ecrit(touche(n, m)), n + " " + m);
  }
});

test("clavier estTexte : AltGr produit un caractere, pas un raccourci", () => {
  const { clavier } = chargerLib();
  const f = (key, o = {}) => clavier.estTexte({ key, ctrl: false, alt: false, meta: false, altGraph: false, ...o }, false);
  assert.equal(f("a"), true);
  assert.equal(f("É"), true);
  // Windows presente AltGr comme Ctrl+Alt : « @ », « # », « € », « { » d'un clavier francais ou suisse.
  for (const c of ["@", "#", "€", "{", "\\", "|", "~"]) assert.equal(f(c, { ctrl: true, alt: true }), true, c);
  assert.equal(f("@", { ctrl: true, alt: true, altGraph: true }), true);
  assert.equal(f("e", { alt: false, ctrl: false, altGraph: true }), true, "AltGr signale par le navigateur");
  // Un vrai raccourci reste un raccourci.
  assert.equal(f("c", { ctrl: true }), false);
  assert.equal(f("s", { ctrl: true, alt: true }), false, "Ctrl+Alt+lettre");
  assert.equal(f("e", { alt: true }), false, "Alt+lettre sur PC : un accelerateur de menu");
  assert.equal(f("v", { meta: true }), false);
  assert.equal(f("Enter"), false);
  // Sur un Mac local, Option compose un caractere.
  assert.equal(clavier.estTexte({ key: "@", alt: true }, true), true);
  assert.equal(clavier.estTexte({ key: "e", alt: true }, true), false);
  assert.equal(clavier.estTexte(null, false), false);
});

test("clavier souris et collage : Ctrl+clic devient Cmd+clic ; le collage rejoue le bon modificateur", () => {
  const { clavier, clip } = chargerLib();
  assert.deepEqual(plat(clavier.souris("pc-mac", { ctrl: true })), { nom: "", ctrl: false, alt: false, shift: false, meta: true });
  assert.equal(clavier.souris("pc-mac", { ctrl: true, meta: true }).ctrl, true, "les deux : intact");
  assert.equal(clavier.souris("direct", { ctrl: true }).ctrl, true);
  assert.equal(clavier.souris("mac-pc", { meta: true, shift: true }).ctrl, true);
  assert.deepEqual(plat(clavier.collerAvec(true, false, "Mac OS")), { ctrl: false, meta: true });
  assert.deepEqual(plat(clavier.collerAvec(true, false, "Windows")), { ctrl: true, meta: false });
  assert.deepEqual(plat(clavier.collerAvec(true, true, "Windows")), { ctrl: true, meta: false }, "Mac devant PC : Ctrl+V");
  assert.deepEqual(plat(clavier.collerAvec(false, false, "Mac OS")), { ctrl: true, meta: false }, "brut : la touche du clavier local");
  assert.deepEqual(plat(clavier.collerAvec(false, true, "Mac OS")), { ctrl: false, meta: true });
  // Maj+Inser est un collage : il ne doit pas AUSSI partir comme une touche.
  assert.equal(clip.isPasteChord({ key: "Insert", shiftKey: true }), true);
  assert.equal(clip.isPasteChord({ key: "Insert", shiftKey: true, ctrlKey: true }), false);
  assert.equal(clip.isPasteChord({ key: "Insert" }), false);
  assert.equal(clip.signature("abc"), clip.signature("abc"));
  assert.notEqual(clip.signature("abc"), clip.signature("abd"));
  assert.notEqual(clip.signature(""), clip.signature(" "));
  assert.equal(clip.signature(undefined), clip.signature(""));
});

test("clavier (cablage) : AltGr part en texte, Maj+Inser n'est pas transmis, un pair Windows n'est pas traduit", async () => {
  const m = await montageSortant();
  const frapper = (o) => m.player.ecouteurs.keydown.forEach((f) => f({ preventDefault() {}, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o }));
  const avant = m.touches.length;
  frapper({ key: "@", ctrlKey: true, altKey: true });
  frapper({ key: "Insert", shiftKey: true });
  frapper({ key: "ArrowLeft", ctrlKey: true });
  assert.deepEqual(m.touches.slice(avant), [["input_string", "@"],
    ["input_key", { name: "LeftArrow", down: "true", press: "false", alt: "true", ctrl: "false", shift: "false", command: "false" }]]);
  const w = await montageSortant({ plateforme: "Windows" });
  const n = w.touches.length;
  w.player.ecouteurs.keydown.forEach((f) => f({ preventDefault() {}, key: "c", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }));
  assert.deepEqual(w.touches.slice(n), [["input_key", { name: "c", down: "true", press: "false", alt: "false", ctrl: "true", shift: "false", command: "false" }]]);
});

// ====================================================================
// Presse-papier : depot automatique, synchronisation sortante.
// ====================================================================
// Le navigateur refuse d'ecrire du texte (pas de geste recent) : le montage ne
// refusait que write(), celui des images.
const refuserTexte = (m) => { m.w.navigator.clipboard.writeText = async () => { const e = new Error("refus"); e.name = "NotAllowedError"; throw e; }; };

test("presse-papier auto : un texte recu est depose sans bouton ni retour, et un refus rend la main au bouton", async () => {
  const m = await montageEntrant();
  m.bac.document.hasFocus = () => true;
  m.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [{ format: 0, compress: false, content: utf8("bonjour") }] } });
  await m.vider();
  assert.deepEqual(m.ecrits, [{ texte: "bonjour" }]);
  assert.deepEqual(plat(boutons(m.barre)), [], "aucun bouton");
  assert.deepEqual(m.toasts(), [], "aucun retour : un presse-papier qui marche ne s'annonce pas");
  // Refus du navigateur : pas d'erreur affichee, le bouton apparait.
  const r = await montageEntrant({ ecriture: "refuse" });
  refuserTexte(r);
  r.bac.document.hasFocus = () => true;
  r.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [{ format: 0, compress: false, content: utf8("plus tard") }] } });
  await r.vider();
  assert.deepEqual(plat(boutons(r.barre)), ["Texte reçu ⇩"]);
  assert.deepEqual(r.toasts(), []);
  // Au geste suivant, le depot est repris — le navigateur accepte cette fois.
  r.w.navigator.clipboard.writeText = async (t) => { r.ecrits.push({ texte: t }); };
  r.w.__rdPpGeste(); await r.vider();
  assert.deepEqual(r.ecrits, [{ texte: "plus tard" }]);
  assert.deepEqual(plat(boutons(r.barre)), []);
});

test("presse-papier auto : apres une perte de focus, le contenu en attente n'est PAS depose d'office", async () => {
  const m = await montageEntrant({ ecriture: "refuse" });
  refuserTexte(m);
  m.bac.document.hasFocus = () => true;
  m.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [{ format: 0, compress: false, content: utf8("ancien") }] } });
  await m.vider();
  m.w.__rdPpBlur();                         // l'utilisateur est parti : il a pu copier autre chose ailleurs
  m.w.navigator.clipboard.writeText = async (t) => { m.ecrits.push({ texte: t }); };
  m.w.__rdPpGeste(); await m.vider();
  assert.deepEqual(m.ecrits, [], "ecraser un contenu plus recent avec un plus ancien serait une faute");
  assert.deepEqual(plat(boutons(m.barre)), ["Texte reçu ⇩"], "le bouton reste, pour qui le veut");
  // Sans le focus a l'arrivee : pas de tentative du tout.
  const n = await montageEntrant();
  n.bac.document.hasFocus = () => false;
  n.w.__rdPpFiltrer({ multi_clipboards: { clipboards: [{ format: 0, compress: false, content: utf8("x") }] } });
  await n.vider();
  assert.deepEqual(n.ecrits, []);
  assert.deepEqual(plat(boutons(n.barre)), ["Texte reçu ⇩"]);
});

test("presse-papier sortant : la synchronisation envoie sans coller, ne renvoie pas deux fois, et Ctrl+V devient immediat", async () => {
  const m = await montageSortant({ init: { "rd-prefs": JSON.stringify({ v: 1, clip: "auto" }) } });
  let local = "copié ici";
  const item = () => ({ types: ["text/plain"], getType: async () => new Blob([local], { type: "text/plain" }) });
  m.w.navigator.clipboard = { read: async () => [item()], writeText: async () => {} };
  m.w.navigator.permissions = { query: async () => ({ state: "granted" }) };
  m.doc.hasFocus = () => true;
  assert.equal(await m.w.__rdClipSync("test"), true);
  assert.equal(new TextDecoder().decode(m.envoyes.at(-1).clipboard.content), "copié ici");
  assert.equal(m.rejeux().length, 0, "synchroniser n'est pas coller");
  const n = m.envoyes.length;
  assert.equal(await m.w.__rdClipSync("test"), false, "rien de neuf : rien ne part");
  assert.equal(m.envoyes.length, n);
  // Ctrl+V du meme contenu : aucun envoi, la frappe est rejouee tout de suite.
  const ev = { preventDefault() {}, clipboardData: { items: [], files: [], getData: (t) => (t === "text/plain" ? "copié ici" : "") } };
  const repere = m.bac.minuteurs.length;
  (m.ecouteurs.paste || []).forEach((f) => f(ev));
  assert.equal(m.envoyes.length, n, "le contenu est deja sur le poste distant");
  const rejeu = m.bac.minuteurs.slice(repere).filter((t) => t.once);
  assert.deepEqual(rejeu.map((t) => t.ms), [30], "plus d'attente de 150 ms");
  rejeu[0].f();
  assert.deepEqual(m.touches.at(-1), ["input_key", { name: "v", down: "false", press: "false", alt: "false", shift: "false", ctrl: "false", command: "true" }]);
  // Un contenu different repart.
  local = "autre chose";
  assert.equal(await m.w.__rdClipSync("test"), true);
  // Sans accord : jamais de lecture.
  const s = await montageSortant();
  let lectures = 0;
  s.w.navigator.clipboard = { read: async () => { lectures++; return []; } };
  s.w.navigator.permissions = { query: async () => ({ state: "granted" }) };
  s.doc.hasFocus = () => true;
  assert.equal(await s.w.__rdClipSync("test"), false);
  assert.equal(lectures, 0);
});

test("clavier (cablage) : le relachement rejoue ce qui est parti, meme si Ctrl a ete lache avant la lettre", async () => {
  const m = await montageSortant();
  const ev = (o) => ({ preventDefault() {}, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });
  const bas = (o) => m.player.ecouteurs.keydown.forEach((f) => f(ev(o)));
  const haut = (o) => m.player.ecouteurs.keyup.forEach((f) => f(ev(o)));
  const avant = m.touches.length;
  bas({ key: "c", code: "KeyC", ctrlKey: true });
  haut({ key: "c", code: "KeyC" });                      // Ctrl deja relache : sans cela, « c » passait pour du texte
  const cmd = { alt: "false", ctrl: "false", shift: "false", command: "true" };
  assert.deepEqual(m.touches.slice(avant), [["input_key", { name: "c", down: "true", press: "false", ...cmd }],
                                            ["input_key", { name: "c", down: "false", press: "false", ...cmd }]]);
  // Une lettre tapee n'envoie rien au relachement, comme avant.
  const n = m.touches.length;
  bas({ key: "a", code: "KeyA" }); haut({ key: "a", code: "KeyA" });
  assert.deepEqual(m.touches.slice(n), [["input_string", "a"]]);
  // Un second relachement de la meme touche ne renvoie rien.
  const k = m.touches.length;
  haut({ key: "c", code: "KeyC" });
  assert.equal(m.touches.length, k);
});
