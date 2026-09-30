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
