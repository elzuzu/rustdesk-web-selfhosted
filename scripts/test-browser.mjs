#!/usr/bin/env node
// Banc navigateur — Chromium reel, sans serveur RustDesk.
//
// Usage :  node scripts/test-browser.mjs [--require-browser] [--channel=chrome]
//
// Ce que le banc Node (test-template.mjs) ne peut PAS voir, parce qu'il repose
// sur un DOM fictif : ou le pointeur tombe vraiment (elementFromPoint), ce que
// le vrai ClipboardItem accepte (une promesse de Blob), le focus reel, la
// regle CSS sibling du HUD, et le VRAI formulaire du bundle pour l'historique.
//
// Prerequis : html/ (extract-assets.sh puis patch-assets.sh) et Playwright :
//   - ici :   NODE_PATH=$(npm root -g) node scripts/test-browser.mjs
//   - en CI : npm i --no-save playwright-core@1.56.1, puis --channel=chrome
// Sans Playwright ni navigateur, le banc s'IGNORE avec un message explicite ;
// --require-browser le fait echouer a la place (la CI le passe).
//
// La session est SIMULEE : on pose un curConn factice dont la liaison est
// « ouverte » et on affiche #canvas, comme le fait une vraie session. Aucun
// message ne part nulle part.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(RACINE, "html");
const GABARIT = path.join(RACINE, "web", "index.html.template");
const EXIGE = process.argv.includes("--require-browser");
const CANAL = (process.argv.find((a) => a.startsWith("--channel=")) || "").slice(10) || process.env.RD_PW_CHANNEL || "";
const MIO = 1024 * 1024;

function finir(code, msg) { console.log(msg); process.exit(code); }
function ignorer(raison) {
  if (EXIGE) finir(1, `✗ banc navigateur exige (--require-browser) mais : ${raison}`);
  finir(0, `⚠ banc navigateur IGNORE : ${raison}`);
}

// createRequire honore NODE_PATH ; « import » ne le fait pas.
const require_ = createRequire(import.meta.url);
let pw = null;
for (const nom of ["playwright", "playwright-core"]) { try { pw = require_(nom); break; } catch { /* suivant */ } }
if (!pw) ignorer("Playwright introuvable (NODE_PATH=$(npm root -g), ou npm i --no-save playwright-core@1.56.1)");
if (!fs.existsSync(path.join(HTML, "js", "dist", "index.js"))) ignorer("html/ absent — ./scripts/extract-assets.sh && ./scripts/patch-assets.sh");

// ------------------------------------------------------------ serveur statique
// La page rendue depuis le gabarit COURANT ; tout le reste vient de html/.
const CLE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP+/=".slice(0, 43) + "=";
// Le gabarit est assemble depuis web/src/ : toujours les sources courantes.
execFileSync("python3", [path.join(RACINE, "scripts", "build-page.py")], { stdio: "pipe" });
const page = fs.readFileSync(GABARIT, "utf8")
  .split("__RD_DOMAIN__").join("localhost")
  .split("__RD_PUBLIC_KEY__").join(CLE)
  .split("__RD_DEFAULT_PEER_ID__").join("");
// La politique de contenu REELLE du deploiement, lue dans nginx.conf.template :
// chaque test tourne donc sous elle, et une violation fait echouer le banc.
const CSP = /add_header Content-Security-Policy "([^"]+)"/.exec(fs.readFileSync(path.join(RACINE, "nginx.conf.template"), "utf8"))[1]
  .split("$host").join("127.0.0.1:*");
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".html": "text/html", ".json": "application/json", ".png": "image/png" };
const serveur = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // Tout le banc tourne sous la politique en mode RAPPORT : Playwright evalue ses
  // attentes (waitForFunction) par eval, qu'une politique appliquee bloquerait.
  // « /?stricte » sert la meme page sous la politique APPLIQUEE, pour un test dedie.
  if (u === "/" || u === "/index.html") {
    const stricte = new URL(req.url, "http://x").searchParams.has("stricte");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", [stricte ? "content-security-policy" : "content-security-policy-report-only"]: CSP });
    res.end(page); return;
  }
  const f = path.join(HTML, path.normalize(u));
  if (!f.startsWith(HTML) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
const URL_PAGE = `http://127.0.0.1:${serveur.address().port}/`;

let navigateur;
try {
  navigateur = await pw.chromium.launch({ headless: true, args: ["--no-sandbox"], ...(CANAL ? { channel: CANAL } : {}) });
} catch (e) {
  serveur.close();
  ignorer("Chromium ne demarre pas : " + String(e.message).split("\n")[0]);
}

// ------------------------------------------------------------------- petit banc
const resultats = [];
async function test(nom, fn, { init = {}, contexte = {} } = {}) {
  // fr-FR : la langue d'ecriture de l'interface ; les tests de traduction passent la leur.
  const ctx = await navigateur.newContext({ viewport: { width: 1200, height: 800 }, locale: "fr-FR", ...contexte });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: URL_PAGE.replace(/\/$/, "") });
  if (Object.keys(init).length) {
    await ctx.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) if (localStorage.getItem("__init_" + k) === null) { localStorage.setItem(k, v); localStorage.setItem("__init_" + k, "1"); } }, init);
  }
  const p = await ctx.newPage();
  const avertissements = [];
  p.on("pageerror", (e) => avertissements.push("pageerror: " + e.message));
  const violations = [];
  await p.exposeFunction("__rdViolation", (v) => violations.push(v));
  await p.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => window.__rdViolation(e.violatedDirective + " <- " + (e.blockedURI || "?") + " @ " + (e.sourceFile || "(sans source)") + ":" + e.lineNumber)); });
  try {
    await fn(p, ctx, avertissements);
    // Seule violation connue, et sans effet : protobufjs tente eval("require")
    // dans un try/catch pour detecter Node. Bloque, il conclut « navigateur ».
    const reelles = violations.filter((v) => !/^script-src <- eval @ .*\/js\/dist\/vendor\.js/.test(v));
    assert.deepEqual(reelles, [], "violation de la politique de contenu du deploiement");
    resultats.push([nom, true]); console.log("  ✓ " + nom);
  } catch (e) {
    resultats.push([nom, false]); console.log("  ✗ " + nom + "\n      " + String(e.message).split("\n").slice(0, 6).join("\n      "));
  } finally { await ctx.close(); }
}

// Une session simulee : liaison « ouverte », #canvas affiche, RD pret. Les
// messages sortants sont captures dans window.__envoyes.
async function sessionSimulee(p, { version = "1.4.2" } = {}) {
  await p.goto(URL_PAGE);
  await p.waitForFunction(() => window.RD && window.RDLib && document.getElementById("rdbar"), null, { timeout: 15000 });
  await p.evaluate((v) => {
    window.__envoyes = []; window.__touches = [];
    window.curConn = { _id: "123456789", _peerInfo: { version: v, platform: "Mac OS" },
      _ws: { _websocket: { readyState: 1 }, sendMessage(m) { window.__envoyes.push(m); }, next: () => new Promise(() => {}) },
      getRemember: () => true, setRemember() {}, getOption: () => undefined };
    const sb = window.setByName; window.setByName = function (n, x) { window.__touches.push([n, x]); try { return sb.apply(this, arguments); } catch (e) { /* pas de vraie session */ } };
    document.getElementById("canvas").style.display = "block";
    window.RD.ready = true;
  }, version);
  await p.waitForFunction(() => getComputedStyle(document.getElementById("rdbar")).display !== "none", null, { timeout: 5000 });
}
const enTete = (s) => console.log("\n" + s);
enTete("Barre repliable — vrai pointeur, vraie CSS");

await test("collapsed-click-through : le coin haut-droit redevient cliquable sur le poste distant", async (p) => {
  await sessionSimulee(p);
  const etat = await p.evaluate(() => {
    const bar = document.getElementById("rdbar"), poignee = bar.querySelector(".rdhandle");
    const r = poignee.getBoundingClientRect();
    // Un point ou la barre DEPLIEE se trouvait (~400 px a gauche de la poignee), au meme niveau.
    const x = Math.round(r.left - 250), y = Math.round(r.top + r.height / 2);
    // Et JUSTE autour de la poignee : un padding, une bordure ou un fond restes sur le
    // conteneur replie mangeraient encore les clics tout autour d'elle.
    const autour = [[r.left - 3, r.top + r.height / 2], [r.left - 3, r.top + 2], [r.left + r.width / 2, r.bottom + 3]]
      .map(([px, py]) => { const c = document.elementFromPoint(px, py); return !!(c && c.closest("#rdbar")); });
    const cible = document.elementFromPoint(x, y);
    return { replie: bar.classList.contains("replie"), x, y, dansBarre: !!(cible && cible.closest("#rdbar")), autour,
             cible: cible && (cible.id || cible.tagName), large: Math.round(bar.getBoundingClientRect().width),
             haut: Math.round(bar.getBoundingClientRect().height) };
  });
  assert.equal(etat.replie, true, "repliee par defaut");
  assert.equal(etat.dansBarre, false, `le point (${etat.x},${etat.y}) doit atteindre le poste distant, pas la barre : ${etat.cible}`);
  assert.deepEqual(etat.autour, [false, false, false], "les points juste autour de la poignee doivent atteindre le poste distant");
  assert.ok(etat.large <= 30 && etat.haut <= 30, `la barre repliee ne fait que sa poignee : ${etat.large}x${etat.haut} px`);
  // Deplier la barre : le MEME point est de nouveau capte — le test sait detecter un blocage.
  await p.click(".rdhandle");
  const depliee = await p.evaluate((pt) => {
    const c = document.elementFromPoint(pt.x, pt.y); return !!(c && c.closest("#rdbar"));
  }, etat);
  assert.equal(depliee, true, "depliee, la barre capte ce point : sinon le test ne prouverait rien");
});

await test("expand-on-click-aria-and-persist-across-reload", async (p) => {
  await sessionSimulee(p);
  const h = p.locator(".rdhandle");
  assert.equal(await h.getAttribute("aria-expanded"), "false");
  const larg = (await h.boundingBox()).width;
  assert.ok(larg >= 24, "cible d'au moins 24 px : " + larg);
  await h.click();
  assert.equal(await h.getAttribute("aria-expanded"), "true");
  await p.reload(); await sessionSimulee(p);
  assert.equal(await p.locator(".rdhandle").getAttribute("aria-expanded"), "true", "ouverte apres rechargement");
  await p.locator(".rdhandle").click();
  await p.reload(); await sessionSimulee(p);
  assert.equal(await p.locator(".rdhandle").getAttribute("aria-expanded"), "false", "repliee apres rechargement");
});

await test("hud-sibling-rule-intact : survoler la barre revele la telemetrie", async (p) => {
  await sessionSimulee(p);
  await p.evaluate(() => { const h = document.getElementById("rdhud"); h.style.opacity = ""; });
  const avant = await p.evaluate(() => +getComputedStyle(document.getElementById("rdhud")).opacity);
  await p.hover(".rdhandle");
  await p.waitForTimeout(400);                               // la transition dure .18 s
  const apres = await p.evaluate(() => +getComputedStyle(document.getElementById("rdhud")).opacity);
  assert.ok(apres === 1 && avant < 1, `HUD : ${avant} -> ${apres}`);
});

await test("escape-on-bar-collapses-and-sends-no-input_key", async (p) => {
  await sessionSimulee(p);
  await p.click(".rdhandle");                                // ouverte ; le clic rend ensuite le focus au canvas
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === "player", null, { timeout: 3000 });
  await p.focus("#rdbar .quit");                              // le focus est dans la barre (l'utilisateur ne peut pas y tabuler : le canvas avale Tab)
  await p.waitForFunction(() => document.activeElement && document.activeElement.className === "quit", null, { timeout: 3000 });
  await p.evaluate(() => { window.__touches.length = 0; });
  await p.keyboard.press("Escape");
  assert.equal(await p.locator(".rdhandle").getAttribute("aria-expanded"), "false", "Echap replie");
  const touches = await p.evaluate(() => window.__touches.filter(([n]) => n === "input_key"));
  assert.equal(touches.length, 0, "rien n'est envoye au poste distant");
  // Le canvas reprend le focus APRES le keyup d'Echap (un setTimeout de plus) : on l'attend.
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === "player", null, { timeout: 3000 });
  // Le canvas, lui, transmet toujours Echap au poste distant.
  await p.keyboard.press("Escape");
  const apres = await p.evaluate(() => window.__touches.filter(([n]) => n === "input_key").length);
  assert.ok(apres >= 1, "Echap sur le canvas part vers le poste distant");
});

await test("fichiers-button-before-quit-direct-child : le greffon fichiers, dans le vrai DOM", async (p) => {
  await sessionSimulee(p);
  await p.waitForFunction(() => document.querySelector("#rdbar .rdfilesbtn"), null, { timeout: 5000 });
  const ordre = await p.evaluate(() => [...document.getElementById("rdbar").children].map((c) => c.className));
  assert.ok(ordre.indexOf("rdfilesbtn") < ordre.indexOf("quit"), ordre.join(","));
  assert.equal(ordre[ordre.length - 1], "rdhandle", ordre.join(","));
});

enTete("Presse-papier entrant — vrai ClipboardItem, vrai decodeur zstd du bundle");

// Une trame zstd faite main (blocs RLE) : voir scripts/test-template.mjs.
const trameRLE = `(total, octet) => {
  const o = [0x28,0xb5,0x2f,0xfd,0xa0, total&255,(total>>>8)&255,(total>>>16)&255,(total>>>24)&255];
  for (let reste = total; reste > 0;) { const n = Math.min(reste, 131072); reste -= n;
    const h = (reste === 0 ? 1 : 0) | 2 | (n << 3); o.push(h&255,(h>>>8)&255,(h>>>16)&255,octet); }
  return Uint8Array.from(o); }`;

await test("capture a fonds unis (taux > 30x) : le PNG depose est l'image ENTIERE, pas du vide", async (p) => {
  await sessionSimulee(p);
  await p.waitForFunction(() => typeof window.__rdZstdDecoder === "function", null, { timeout: 10000 });
  await p.evaluate(`(() => { const rle = ${trameRLE};
    window.__rdPpFiltrer({ multi_clipboards: { clipboards: [
      { format: 21, compress: true, content: rle(1024*512*4, 0xff), width: 1024, height: 512 } ] } }); })()`);
  // Aucun clic : l'image recue est deposee d'elle-meme dans le presse-papier local.
  let pret = false;
  for (let i = 0; i < 100 && !pret; i++) {
    pret = await p.evaluate(async () => { try { return (await navigator.clipboard.read()).some((x) => x.types.includes("image/png")); } catch { return false; } });
    if (!pret) await p.waitForTimeout(100);
  }
  assert.equal(pret, true, "l'image n'est jamais arrivee dans le presse-papier local");
  assert.equal(await p.evaluate(() => !!document.querySelector(".rdppbtn")), false, "pas de bouton : rien a cliquer");
  const lu = await p.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const it = items.find((i) => i.types.includes("image/png"));
    if (!it) return { ok: false, types: items.map((i) => i.types) };
    const blob = await it.getType("image/png");
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext("2d");
    cx.drawImage(bmp, 0, 0);
    const px = cx.getImageData(0, 0, 1, 1).data, fin = cx.getImageData(bmp.width - 1, bmp.height - 1, 1, 1).data;
    return { ok: true, w: bmp.width, h: bmp.height, px: [...px], fin: [...fin] };
  });
  assert.equal(lu.ok, true, JSON.stringify(lu));
  assert.deepEqual([lu.w, lu.h], [1024, 512]);
  // Un seul octet remplit R, V, B ET alpha : 0xFF donne du blanc opaque, la ou
  // l'ancien decodeur donnait une image transparente [0,0,0,0].
  assert.deepEqual(lu.px, [255, 255, 255, 255], "les VRAIS pixels : une image transparente serait [0,0,0,0]");
  assert.deepEqual(lu.fin, [255, 255, 255, 255]);
  const toasts = await p.evaluate(() => [...document.querySelectorAll(".rdtoast")].map((t) => t.textContent));
  assert.deepEqual(toasts, [], "un presse-papier qui marche ne s'annonce pas");
});

// La page n'a pas le focus (ou le navigateur refuse) : le bouton reprend son role.
const sansFocus = (p) => p.evaluate(() => { document.hasFocus = () => false; });

await test("auto-deposit-text : un texte copie sur le poste distant est dans le presse-papier local, sans bouton ni retour", async (p) => {
  await sessionSimulee(p);
  await p.evaluate(() => window.__rdPpFiltrer({ multi_clipboards: { clipboards: [
    { format: 2, compress: false, content: new TextEncoder().encode("<b>gras</b>") },
    { format: 0, compress: false, content: new TextEncoder().encode("gras") } ] } }));
  await p.waitForFunction(async () => { try { return (await navigator.clipboard.readText()) === "gras"; } catch { return false; } }, null, { timeout: 5000 });
  const r = await p.evaluate(async () => { const it = (await navigator.clipboard.read())[0];
    return { html: it.types.includes("text/html") ? await (await it.getType("text/html")).text() : null,
             bouton: !!document.querySelector(".rdppbtn"), toasts: document.querySelectorAll(".rdtoast").length,
             focus: document.activeElement && document.activeElement.id }; });
  assert.match(r.html, /<b>gras<\/b>/, "le texte enrichi suit");
  assert.equal(r.bouton, false); assert.equal(r.toasts, 0);
  // Le texte simple des anciens pairs prend le meme chemin.
  await p.evaluate(() => window.__rdPpFiltrer({ clipboard: { format: 0, compress: false, content: new TextEncoder().encode("ancien pair") } }));
  await p.waitForFunction(async () => { try { return (await navigator.clipboard.readText()) === "ancien pair"; } catch { return false; } }, null, { timeout: 5000 });
});

await test("auto-deposit-refused-then-gesture : refuse par le navigateur, le depot est repris au geste suivant", async (p) => {
  await sessionSimulee(p);
  await p.evaluate(() => { const vrai = navigator.clipboard.writeText.bind(navigator.clipboard); window.__refus = 1;
    navigator.clipboard.writeText = (t) => window.__refus-- > 0 ? Promise.reject(new DOMException("pas de geste", "NotAllowedError")) : vrai(t);
    window.__rdPpFiltrer({ multi_clipboards: { clipboards: [{ format: 0, compress: false, content: new TextEncoder().encode("au second essai") }] } }); });
  await p.waitForSelector('.rdppbtn[data-kind="text"]');
  assert.equal(await p.evaluate(() => document.querySelectorAll(".rdtoast.erreur").length), 0, "un refus n'est pas une erreur a montrer");
  await p.mouse.click(600, 400);                                // un geste dans l'image
  await p.waitForFunction(async () => { try { return (await navigator.clipboard.readText()) === "au second essai"; } catch { return false; } }, null, { timeout: 5000 });
  await p.waitForFunction(() => !document.querySelector(".rdppbtn"));
});

await test("focus-restored-after-deposit : le bouton ne garde pas le clavier", async (p) => {
  await sessionSimulee(p); await sansFocus(p);
  await p.evaluate(() => window.__rdPpFiltrer({ multi_clipboards: { clipboards: [{ format: 0, compress: false, content: new TextEncoder().encode("bonjour") }] } }));
  await p.click('.rdppbtn[data-kind="text"]');
  await p.waitForFunction(() => !document.querySelector('.rdppbtn[data-kind="text"]'), null, { timeout: 5000 });
  assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.id), "player");
  assert.equal(await p.evaluate(() => navigator.clipboard.readText()), "bonjour");
});

await test("attention-reveals-ppbtn-when-collapsed : visible et cliquable barre repliee", async (p) => {
  await sessionSimulee(p); await sansFocus(p);
  await p.evaluate(() => window.__rdPpFiltrer({ multi_clipboards: { clipboards: [{ format: 0, compress: false, content: new TextEncoder().encode("x") }] } }));
  const etat = await p.evaluate(() => {
    const bar = document.getElementById("rdbar"), b = bar.querySelector(".rdppbtn");
    const r = b.getBoundingClientRect(), cible = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { replie: bar.classList.contains("replie"), attention: bar.classList.contains("attention"),
             visible: r.width > 0 && r.height > 0, atteint: cible === b, choix: localStorage.getItem("rd-prefs") };
  });
  assert.equal(etat.replie, true, "la barre reste repliee");
  assert.equal(etat.attention, true);
  assert.ok(etat.visible && etat.atteint, JSON.stringify(etat));
  assert.ok(!etat.choix || !/"bar"/.test(etat.choix), "et le choix memorise n'est pas touche : " + etat.choix);
});

await test("un decodeur qui echoue : erreur visible (role=alert), pas une image blanche", async (p) => {
  await sessionSimulee(p);
  await p.evaluate(() => window.__rdPpFiltrer({ multi_clipboards: { clipboards: [
    { format: 21, compress: true, content: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]), width: 64, height: 64 } ] } }));
  // Depot automatique : un contenu INUTILISABLE reste une erreur a montrer.
  await p.waitForSelector(".rdtoast.erreur", { timeout: 10000 });
  const t = await p.evaluate(() => { const e = document.querySelector(".rdtoast.erreur"); return { texte: e.textContent, role: e.getAttribute("role") }; });
  assert.equal(t.role, "alert");
  assert.match(t.texte, /Décompression|corrompues/);
});

enTete("Presse-papier sortant — vrais evenements « paste », vrai canvas");

// Une image bruitee : quasi incompressible, donc son PNG pese ~ 4 octets par pixel.
const imageBruitee = `(async (w, h) => { const cv = new OffscreenCanvas(w, h), cx = cv.getContext("2d");
  const d = cx.createImageData(w, h); for (let i = 0; i < d.data.length; i += 65536) crypto.getRandomValues(d.data.subarray(i, Math.min(i + 65536, d.data.length)));
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255; cx.putImageData(d, 0, 0);
  return await cv.convertToBlob({ type: "image/png" }); })`;

async function collerImage(p, expr) {
  await p.evaluate(`(async () => { const blob = await (${expr}); const f = new File([blob], "capture.png", { type: blob.type });
    const dt = new DataTransfer(); dt.items.add(f);
    const cible = document.activeElement || document.body;
    cible.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
}

await test("paste-accepted-body-focus-in-live-session : le collage marche meme si un bouton a garde le focus", async (p) => {
  await sessionSimulee(p);
  await p.click(".rdhandle");                                  // un clic sur la barre : le canvas reprend le focus
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === "player", null, { timeout: 3000 });
  await p.evaluate(() => document.activeElement.blur());       // focus sur <body>
  assert.equal(await p.evaluate(() => document.activeElement === document.body), true);
  await collerImage(p, `(${imageBruitee})(64, 64)`);
  await p.waitForFunction(() => window.__envoyes.some((m) => m.multi_clipboards), null, { timeout: 8000 });
  const cb = await p.evaluate(() => { const m = window.__envoyes.find((x) => x.multi_clipboards).multi_clipboards.clipboards[0]; return { format: m.format, w: m.width, h: m.height, sig: [...m.content.slice(0, 4)] }; });
  assert.equal(cb.format, 22); assert.deepEqual(cb.sig, [0x89, 0x50, 0x4e, 0x47], "un vrai PNG");
  assert.deepEqual([cb.w, cb.h], [64, 64]);
});

await test("paste-refused-in-input : dans un champ, le collage appartient a l'utilisateur", async (p) => {
  await sessionSimulee(p);
  await p.evaluate(() => { const i = document.createElement("input"); i.id = "champ"; document.body.appendChild(i); i.focus(); });
  await collerImage(p, `(${imageBruitee})(32, 32)`);
  await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => window.__envoyes.filter((m) => m.multi_clipboards).length), 0);
});

await test("jpeg-inflating-over-limit-is-downscaled-not-refused : une image trop lourde est REDUITE", async (p) => {
  await sessionSimulee(p);
  await collerImage(p, `(${imageBruitee})(2600, 2600)`);     // ~ 27 Mo de PNG bruite : au-dela des 8 Mio
  await p.waitForFunction(() => window.__envoyes.some((m) => m.multi_clipboards) || document.querySelector(".rdtoast.erreur"), null, { timeout: 60000 });
  const r = await p.evaluate(() => {
    const m = window.__envoyes.find((x) => x.multi_clipboards);
    return { envoye: !!m, taille: m && m.multi_clipboards.clipboards[0].content.length,
             w: m && m.multi_clipboards.clipboards[0].width, h: m && m.multi_clipboards.clipboards[0].height,
             toasts: [...document.querySelectorAll(".rdtoast")].map((t) => t.textContent) };
  });
  assert.equal(r.envoye, true, "envoyee, reduite : " + JSON.stringify(r.toasts));
  assert.ok(r.taille <= 8 * 1024 * 1024, "sous la limite : " + r.taille);
  assert.ok(r.w < 2600 && r.h < 2600, `dimensions reduites : ${r.w}x${r.h}`);
  assert.ok(r.toasts.some((t) => /réduite de 2600×2600/.test(t)), JSON.stringify(r.toasts));
});

await test("old-peer-toast-no-send-no-replay : pair anterieur a 1.3.0", async (p) => {
  await sessionSimulee(p, { version: "1.2.7" });
  await collerImage(p, `(${imageBruitee})(32, 32)`);
  await p.waitForSelector(".rdtoast.erreur", { timeout: 8000 });
  assert.equal(await p.evaluate(() => window.__envoyes.filter((m) => m.multi_clipboards).length), 0);
  assert.match(await p.locator(".rdtoast.erreur").first().textContent(), /antérieur à 1\.3\.0/);
});

enTete("Reglages et ecran de connexion — le vrai formulaire du bundle");

await test("selects-init-from-prefs : les selecteurs demarrent sur les choix memorises", async (p) => {
  await p.goto(URL_PAGE);
  await p.waitForSelector("#rdbar", { state: "attached" });
  const v = await p.evaluate(() => { const s = [...document.querySelectorAll("#rdbar select")]; return s.map((x) => x.value); });
  // [resolution, qualite, cadence, codec, ecrans, actions]
  assert.deepEqual(v.slice(1, 4), ["best", "60", "vp9"], JSON.stringify(v));
}, { init: { "rd-prefs": JSON.stringify({ v: 1, quality: "best", fps: 60, codec: "vp9" }) } });

const OUVERTE = { init: { "rd-prefs": JSON.stringify({ v: 1, bar: "ouverte", hint: true }) } };

await test("actions-menu-real-select : choisir une action l'execute et rend le selecteur a son libelle", async (p) => {
  await sessionSimulee(p);
  await p.selectOption("#rdbar select.rdactions", "cad");
  await p.selectOption("#rdbar select.rdactions", "opt:disable-audio");
  const r = await p.evaluate(() => ({ t: window.__touches.map((x) => x[0] + (x[1] === undefined ? "" : ":" + x[1])),
    v: document.querySelector("#rdbar select.rdactions").value,
    n: document.querySelector("#rdbar select.rdactions").options.length,
    ecrans: getComputedStyle(document.querySelector("#rdbar select.rdecrans")).display }));
  assert.ok(r.t.includes("ctrl_alt_del") && r.t.includes("toggle_option:disable-audio"), JSON.stringify(r.t));
  assert.equal(r.v, "");
  assert.equal(r.n, 10, "la liste est reconstruite, pas empilee (neuf actions, plus le presse-papier automatique de Chromium)");
  assert.equal(r.ecrans, "none", "sans second ecran, pas de selecteur d'ecran");
}, OUVERTE);

await test("bar-wraps-in-narrow-window : depliee dans une fenetre etroite, la barre reste dans l'ecran", async (p) => {
  await sessionSimulee(p);
  const r = await p.evaluate(() => { const b = document.getElementById("rdbar").getBoundingClientRect();
    return { gauche: b.left, droite: b.right, large: innerWidth,
             dehors: [...document.querySelectorAll("#rdbar > *")].filter((e) => { const x = e.getBoundingClientRect(); return x.width && (x.left < 0 || x.right > innerWidth); }).length }; });
  assert.ok(r.gauche >= 0 && r.droite <= r.large, JSON.stringify(r));
  assert.equal(r.dehors, 0, "aucun controle hors de l'ecran");
}, { ...OUVERTE, contexte: { viewport: { width: 420, height: 800 } } });

await test("codec-probe-all : les quatre codecs sont sondes, et la declaration n'annonce que ce qui est decodable", async (p) => {
  await sessionSimulee(p);
  await p.waitForFunction(() => window.RD.caps && Object.keys(window.RD.caps).length === 4, null, { timeout: 5000 });
  const r = await p.evaluate(() => { window.__envoyes.length = 0; window.__rdNegotiate();
    const d = window.__envoyes.map((m) => m.misc && m.misc.option && m.misc.option.supported_decoding).filter(Boolean).pop();
    return { caps: window.RD.caps, codec: window.RD.codec, d }; });
  assert.deepEqual(Object.keys(r.caps).sort(), ["av1", "h264", "h265", "vp9"]);
  if (r.codec) {
    for (const n of ["h265", "h264", "av1"]) assert.equal(r.d["ability_" + n], r.caps[n] ? 1 : 0, n + " : " + JSON.stringify(r));
    assert.equal(r.d.ability_vp9, 1);
    assert.equal(r.d.prefer, { vp9: 1, h264: 2, h265: 3, av1: 5 }[r.codec]);
  }
});

await test("restart-uses-page-modal : la confirmation passe par la modale, pas par le window.confirm que le bundle a remplace", async (p) => {
  await sessionSimulee(p);
  await p.selectOption("#rdbar select.rdactions", "restart");
  await p.waitForSelector("#rdmodal.ouvert .boite");
  assert.match(await p.textContent("#rdmodal .boite b"), /Redémarrer le poste distant/);
  await p.click("#rdmodal .boite button:not(.ok)");                       // Annuler
  assert.equal(await p.evaluate(() => window.__envoyes.filter((m) => m.misc && m.misc.restart_remote_device).length), 0);
  await p.selectOption("#rdbar select.rdactions", "restart");
  await p.click("#rdmodal .boite button.ok");
  await p.waitForFunction(() => window.__envoyes.some((m) => m.misc && m.misc.restart_remote_device === true));
}, OUVERTE);

enTete("Entrees — vraie molette, vrai ecran tactile, vrai plein ecran");

const taillerCanvas = (p) => p.evaluate(() => { const c = window.__rdActive(); c.width = 1200; c.height = 800; window.__rdFit(); window.__touches.length = 0; });

await test("wheel-accumulates : un trackpad (petits deltas) ne fait pas un cran par evenement", async (p) => {
  await sessionSimulee(p); await taillerCanvas(p);
  await p.mouse.move(600, 400);
  for (let i = 0; i < 30; i++) await p.mouse.wheel(0, 5);                   // 150 px en tout
  await p.mouse.wheel(0, 100);                                              // un cran de souris
  await p.waitForTimeout(100);
  const crans = await p.evaluate(() => window.__touches.filter((t) => t[0] === "send_mouse").map((t) => JSON.parse(t[1])).filter((a) => a.type === "wheel").map((a) => a.y));
  assert.deepEqual(crans, [-1, -1], JSON.stringify(crans));
});

await test("mouse-release-outside : un glisser termine hors de l'image relache quand meme le bouton", async (p) => {
  await sessionSimulee(p);
  await p.evaluate(() => { const c = window.__rdActive(); c.width = 600; c.height = 400; c.style.width = "600px"; c.style.height = "400px"; window.__touches.length = 0; });
  const r = await p.evaluate(() => { const b = window.__rdActive().getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await p.mouse.move(r.x + 50, r.y + 50);
  await p.mouse.down();
  await p.mouse.move(r.x + r.w + 150, r.y + 50, { steps: 4 });              // hors du canvas
  await p.mouse.up();
  const t = await p.evaluate(() => window.__touches.filter((x) => x[0] === "send_mouse").map((x) => JSON.parse(x[1])));
  const types = t.map((a) => a.type).filter(Boolean);
  assert.deepEqual(types, ["down", "up"], JSON.stringify(types));
  assert.ok(t.every((a) => a.x >= 0 && a.x <= 599), "coordonnees bornees a l'image : " + JSON.stringify(t.map((a) => a.x)));
});

await test("touch-tap-is-left-click : un toucher reel donne UN clic gauche (pas de double via les evenements souris)", async (p) => {
  await sessionSimulee(p); await taillerCanvas(p);
  await p.touchscreen.tap(300, 300);
  await p.waitForTimeout(400);
  const t = await p.evaluate(() => window.__touches.filter((x) => x[0] === "send_mouse").map((x) => JSON.parse(x[1])).map((a) => a.type + ":" + a.buttons));
  assert.deepEqual(t, [":", "down:left", "up:left"], JSON.stringify(t));
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#rdbar .rdclavier")).display !== "none"), true, "ecran tactile : le bouton Clavier est propose");
}, { ...OUVERTE, contexte: { hasTouch: true, isMobile: true, viewport: { width: 1200, height: 800 } } });

await test("soft-keyboard-field : ce qui est tape dans le champ du clavier virtuel part au poste distant", async (p) => {
  await sessionSimulee(p);
  await p.evaluate(() => { window.__touches.length = 0; });
  await p.click("#rdbar .rdclavier");
  assert.equal(await p.evaluate(() => document.activeElement.id), "rdsaisie", "le bouton donne le focus au champ, pas au canvas");
  await p.keyboard.type("é");
  await p.keyboard.press("Backspace");
  const t = await p.evaluate(() => window.__touches.map((x) => x[0] === "input_string" ? "texte:" + x[1] : x[0] + ":" + JSON.parse(x[1]).name));
  assert.deepEqual(t, ["texte:é", "input_key:Backspace"], JSON.stringify(t));
}, { ...OUVERTE, contexte: { hasTouch: true, isMobile: true, viewport: { width: 1200, height: 800 } } });

await test("fullscreen-button : le bouton bascule le plein ecran et son libelle", async (p) => {
  await sessionSimulee(p);
  assert.equal(await p.textContent("#rdbar .rdplein"), "Plein écran");
  await p.click("#rdbar .rdplein");
  await p.waitForFunction(() => !!document.fullscreenElement && document.querySelector("#rdbar .rdplein").textContent === "Fenêtre", null, { timeout: 5000 });
  await p.evaluate(() => document.exitFullscreen());
  // Le libelle suit l'evenement fullscreenchange, qui arrive apres le changement d'etat.
  await p.waitForFunction(() => !document.fullscreenElement && document.querySelector("#rdbar .rdplein").textContent === "Plein écran", null, { timeout: 5000 });
}, OUVERTE);

await test("csp-and-manifest : la page complete se charge sous la politique de contenu, manifeste compris", async (p) => {
  await p.goto(URL_PAGE);
  await p.waitForSelector("#rd-entete", { timeout: 15000 });
  await p.waitForFunction(() => window.RD.caps && Object.keys(window.RD.caps).length === 4);
  const r = await p.evaluate(async () => { const x = await fetch(document.querySelector("link[rel=manifest]").href); return { ok: x.ok, nom: (await x.json()).short_name, csp: !!document.querySelector("#rd-entete img").naturalWidth }; });
  assert.deepEqual(r, { ok: true, nom: "RustDesk", csp: true });
});

await test("csp-enforced : sous la politique APPLIQUEE, la page, le WebAssembly et le decodage fonctionnent", async (p) => {
  await p.goto(URL_PAGE + "?stricte");
  // Pas de waitForFunction ici : il passe par eval, que la politique bloque.
  const attendre = async (f, quoi) => { for (let i = 0; i < 100; i++) { if (await p.evaluate(f)) return; await p.waitForTimeout(100); } assert.fail("jamais vrai : " + quoi); };
  await attendre(() => !!(window.RD && window.RDLib && document.getElementById("rdbar") && document.getElementById("rd-entete")), "page et barre construites");
  await attendre(() => typeof window.__rdZstdDecoder === "function" && typeof window.connect === "function", "bundle charge");
  const r = await p.evaluate(async () => {
    // Une trame zstd minimale : en-tete, bloc brut « abc ».
    const trame = Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, 0x03, 0x19, 0x00, 0x00, 0x61, 0x62, 0x63]);
    const d = await window.__rdZstdDecoder();
    return { texte: new TextDecoder().decode(d.decode(trame, 3)), caps: Object.keys(window.RD.caps || {}).length };
  });
  assert.equal(r.texte, "abc", "le decodeur WebAssembly du bundle tourne sous 'wasm-unsafe-eval'");
  assert.equal(r.caps, 4, "WebCodecs a ete sonde");
});

await test("login-dressing : un titre, un seul champ visible, Entree connecte, la case efface les mots de passe", async (p) => {
  await p.goto(URL_PAGE);
  await p.waitForSelector("#rd-entete");
  assert.equal(await p.textContent("#rd-entete h1"), "RustDesk Web");
  assert.equal(await p.isVisible("#host"), false, "l'hote vient du deploiement : il n'est plus presente comme un champ a remplir");
  assert.equal(await p.isVisible("#key"), false);
  assert.equal(await p.isVisible("#id"), true);
  assert.equal(await p.textContent("label[for=id]"), "ID du poste");
  assert.equal(await p.textContent("#rd-serveur b"), "localhost");
  // Les champs masques gardent leur valeur : le bundle les lit a la connexion.
  assert.equal(await p.inputValue("#host"), "localhost");
  await p.evaluate(() => { window.__clics = 0; document.querySelector("#connect button[onclick]").onclick = () => { window.__clics++; }; });
  await p.fill("#id", "123456789");
  await p.press("#id", "Enter");
  assert.equal(await p.evaluate(() => window.__clics), 1, "Entree dans le champ ID lance la connexion");
  await p.uncheck("#rd-memo input");
  const r = await p.evaluate(() => ({ peers: JSON.parse(localStorage.getItem("peers")), prefs: JSON.parse(localStorage.getItem("rd-prefs")) }));
  assert.equal(r.prefs.remember, false);
  assert.equal(r.peers["111111111"].password, undefined, "le mot de passe memorise est efface");
  assert.equal(r.peers["111111111"].tm, 100, "le reste de la fiche est garde");
}, { init: { peers: JSON.stringify({ "111111111": { tm: 100, password: "secret1" } }) } });

await test("wrong-password-reprompts : « Wrong Password » rouvre le champ au lieu d'une impasse", async (p) => {
  await p.goto(URL_PAGE);
  await p.waitForSelector("#rd-entete");
  await p.evaluate(() => {
    document.querySelector("div#connect").style.display = "none";
    document.querySelector("div#status").style.display = "block";
    document.querySelector("div#text").innerHTML = '<div style="font-weight: bold;">Do you want to enter again?</div>';
  });
  await p.waitForFunction(() => getComputedStyle(document.querySelector("div#password")).display !== "none");
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("div#status")).display), "none");
  assert.match(await p.textContent("#rd-mdp-titre"), /Mot de passe incorrect/);
  assert.equal(await p.evaluate(() => document.activeElement === document.querySelector("div#password input")), true);
  // Un statut ordinaire est traduit sur place.
  await p.evaluate(() => { document.querySelector("div#password").style.display = "none"; document.querySelector("div#status").style.display = "block";
    document.querySelector("div#text").innerHTML = '<div style="font-weight: bold;">Remote desktop is offline</div>'; });
  await p.waitForFunction(() => document.querySelector("div#text").textContent === "Le poste distant est hors ligne.");
});

await test("english-ui : navigateur non francophone, interface en anglais ; le choix de langue est memorise", async (p) => {
  await sessionSimulee(p);
  assert.equal(await p.textContent("#rdbar button.quit"), "Quit");
  assert.equal(await p.textContent("#rdbar .rdplein"), "Full screen");
  assert.equal(await p.evaluate(() => document.documentElement.lang), "en");
  assert.equal(await p.textContent("#connect button[onclick]"), "Connect");
  // La telemetrie est reecrite une fois par seconde.
  await p.waitForFunction(() => /round trip {4}p50\/p95\/p99/.test(document.getElementById("rdhud").textContent), null, { timeout: 5000 });
  await p.evaluate(() => { document.getElementById("canvas").style.display = "none"; document.querySelector("div#connect").style.display = "block"; });
  await Promise.all([p.waitForNavigation(), p.selectOption("#rd-langue", "fr")]);
  await p.waitForSelector("#rd-entete");
  assert.equal(await p.textContent("#connect button[onclick]"), "Connexion");
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("rd-prefs")).lang), "fr");
}, { ...OUVERTE, contexte: { locale: "en-US" } });

enTete("Clavier PC devant un Mac — vraies touches, vrai canvas");

const frappes = (p) => p.evaluate(() => window.__touches.filter((t) => t[0] === "input_key" || t[0] === "input_string")
  .map((t) => { if (t[0] === "input_string") return "texte:" + t[1]; const a = JSON.parse(t[1]); if (a.down !== "true") return null;
    return [a.ctrl === "true" && "Ctrl", a.alt === "true" && "Alt", a.shift === "true" && "Maj", a.command === "true" && "Cmd", a.name].filter(Boolean).join("+"); }).filter(Boolean));

await test("pc-shortcuts-translated : les raccourcis d'un clavier PC produisent le MEME EFFET sur le Mac", async (p) => {
  await sessionSimulee(p);
  // peer_info : c'est lui qui apprend a la page la plateforme du pair, donc le sens de la traduction.
  await p.evaluate(() => { window.onGlobalEvent(JSON.stringify({ name: "peer_info" })); window.__rdActive().focus(); window.__touches.length = 0; });
  for (const k of ["Control+c", "Control+ArrowLeft", "Control+Shift+ArrowRight", "Control+Backspace", "Home", "Shift+End", "Control+Home", "Control+y", "Control+Tab", "Alt+F4", "Control+Insert", "a"])
    await p.keyboard.press(k);
  assert.deepEqual(await frappes(p), ["Cmd+c", "Alt+LeftArrow", "Alt+Maj+RightArrow", "Alt+Backspace", "Cmd+LeftArrow", "Maj+Cmd+RightArrow",
    "Cmd+UpArrow", "Maj+Cmd+z", "Ctrl+Tab", "Cmd+q", "Cmd+c", "texte:a"]);
  assert.equal(await p.textContent("#rdbar .rdclavmode"), "PC→Mac");
  // Ctrl+clic : selection multiple, donc Cmd+clic — un Ctrl+clic serait un clic droit sur le Mac.
  await p.evaluate(() => { const c = window.__rdActive(); c.width = 1200; c.height = 800; window.__rdFit(); window.__touches.length = 0; });
  await p.keyboard.down("Control"); await p.mouse.click(600, 400); await p.keyboard.up("Control");
  const clic = await p.evaluate(() => window.__touches.filter((t) => t[0] === "send_mouse").map((t) => JSON.parse(t[1])).find((a) => a.type === "down"));
  assert.deepEqual([clic.ctrl, clic.command], ["false", "true"]);
  // Mode brut (terminal) : plus rien n'est traduit.
  await p.click("#rdbar .rdclavmode");
  await p.evaluate(() => { window.__rdActive().focus(); window.__touches.length = 0; });
  await p.keyboard.press("Control+c"); await p.keyboard.press("Home");
  assert.deepEqual(await frappes(p), ["Ctrl+c", "Home"]);
}, OUVERTE);

await test("pc-to-pc-untouched : devant un poste Windows, rien n'est traduit et le bouton disparait", async (p) => {
  await sessionSimulee(p);
  await p.evaluate(() => { window.curConn._peerInfo.platform = "Windows"; window.onGlobalEvent(JSON.stringify({ name: "peer_info" })); window.__rdActive().focus(); window.__touches.length = 0; });
  await p.keyboard.press("Control+c"); await p.keyboard.press("Control+ArrowLeft"); await p.keyboard.press("Home");
  assert.deepEqual(await frappes(p), ["Ctrl+c", "Ctrl+LeftArrow", "Home"]);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#rdbar .rdclavmode")).display), "none");
}, OUVERTE);

enTete("Presse-papier automatique — vraie lecture, vraie permission");

const AUTO = { init: { "rd-prefs": JSON.stringify({ v: 1, bar: "ouverte", hint: true, clip: "auto" }) } };
await test("clipboard-sync-on-focus : ce qui est copie ici part au poste distant au retour sur la page, et Ctrl+V colle sans renvoyer", async (p) => {
  await sessionSimulee(p);
  await p.evaluate(async () => { await navigator.clipboard.writeText("copié sur le PC"); window.__envoyes.length = 0; window.dispatchEvent(new Event("focus")); });
  await p.waitForFunction(() => window.__envoyes.some((m) => m.clipboard), null, { timeout: 5000 });
  assert.equal(await p.evaluate(() => new TextDecoder().decode(window.__envoyes.find((m) => m.clipboard).clipboard.content)), "copié sur le PC");
  // Un second retour sans rien de neuf n'envoie rien.
  await p.evaluate(() => { window.__envoyes.length = 0; window.__touches.length = 0; window.dispatchEvent(new Event("focus")); });
  await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => window.__envoyes.length), 0);
  assert.equal(await p.evaluate(() => window.__touches.filter((t) => t[0] === "input_key").length), 0, "la synchronisation ne colle rien d'elle-meme");
  // Coller : le contenu est deja la-bas, seule la frappe Cmd+V part, tout de suite.
  await p.evaluate(() => { window.__rdActive().focus(); const dt = new DataTransfer(); dt.setData("text/plain", "copié sur le PC");
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); });
  await p.waitForFunction(() => window.__touches.some((t) => t[0] === "input_key"), null, { timeout: 2000 });
  const r = await p.evaluate(() => ({ envois: window.__envoyes.length, v: JSON.parse(window.__touches.find((t) => t[0] === "input_key")[1]) }));
  assert.equal(r.envois, 0, "pas de second envoi");
  assert.deepEqual([r.v.name, r.v.command, r.v.ctrl], ["v", "true", "false"]);
  // Ce qui vient du poste distant n'y est pas renvoye au retour suivant.
  await p.evaluate(() => { window.__envoyes.length = 0; window.__rdPpFiltrer({ multi_clipboards: { clipboards: [{ format: 0, compress: false, content: new TextEncoder().encode("vient du Mac") }] } }); });
  await p.waitForFunction(async () => { try { return (await navigator.clipboard.readText()) === "vient du Mac"; } catch { return false; } }, null, { timeout: 5000 });
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => window.__envoyes.length), 0, "pas d'aller-retour");
}, AUTO);

await test("clipboard-sync-opt-in : sans accord, rien n'est lu ; le menu Actions l'active", async (p) => {
  await sessionSimulee(p);
  await p.evaluate(async () => { await navigator.clipboard.writeText("secret"); window.__envoyes.length = 0; window.dispatchEvent(new Event("focus")); });
  await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => window.__envoyes.length), 0, "le presse-papier local n'est jamais lu d'office");
  await p.selectOption("#rdbar select.rdactions", "sync");
  await p.waitForFunction(() => window.__envoyes.some((m) => m.clipboard), null, { timeout: 5000 });
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("rd-prefs")).clip), "auto");
  assert.match(await p.evaluate(() => [...document.querySelector("#rdbar select.rdactions").options].find((o) => o.value === "sync").textContent), /^✓ /);
}, OUVERTE);

const PEERS = JSON.stringify({ "111111111": { tm: 100, password: "secret1" }, "222222222": { tm: 300 }, "333333333": { tm: 200 } });

await test("chips-under-id : sous le champ Id du VRAI formulaire, entre Id et Connect", async (p) => {
  await p.goto(URL_PAGE);
  await p.waitForSelector("#rd-recents", { timeout: 15000 });
  const s = await p.evaluate(() => {
    const zone = document.getElementById("rd-recents"), ligneId = document.getElementById("id").closest("tr");
    const ligneZone = zone.closest("tr"), ligneGo = document.querySelector('#connect button[onclick^="connect"]').closest("tr");
    const chips = [...zone.querySelectorAll(".rdchip-id")];
    const style = getComputedStyle(chips[0]);
    return { apresId: ligneId.nextElementSibling === ligneZone, avantGo: ligneZone.nextElementSibling === ligneGo,
             types: [...zone.querySelectorAll("button")].map((b) => b.type), libelles: chips.map((c) => c.textContent),
             fond: style.backgroundColor, role: zone.getAttribute("role"), label: zone.getAttribute("aria-label"),
             ordreY: [ligneId, ligneZone, ligneGo].map((l) => Math.round(l.getBoundingClientRect().top)) };
  });
  assert.ok(s.apresId && s.avantGo, "ligne placee entre Id et Connect");
  assert.ok(s.types.every((t) => t === "button"), s.types.join());
  assert.deepEqual(s.libelles, ["444 444 444", "222 222 222", "333 333 333", "111 111 111"]);
  assert.notEqual(s.fond, "rgb(2, 78, 255)", "le style du bouton « Connect » du bundle ne s'applique pas aux pastilles : " + s.fond);
  assert.ok(s.ordreY[0] < s.ordreY[1] && s.ordreY[1] < s.ordreY[2], "ordre visuel : " + s.ordreY);
  assert.equal(s.role, "group"); assert.match(s.label, /Dernières connexions/);
}, { init: { peers: PEERS, id: "444444444" } });

await test("click-fills-and-focuses-connect / x-and-Delete-remove : au vrai clavier et a la vraie souris", async (p) => {
  await p.goto(URL_PAGE);
  await p.waitForSelector("#rd-recents .rdchip-id", { timeout: 15000 });
  await p.click("#rd-recents .rdchip-id >> nth=1");           // « 333 333 333 »
  assert.equal(await p.inputValue("#id"), "333333333", "chiffres seuls : le bundle n'enleve pas les espaces");
  assert.equal(await p.evaluate(() => document.activeElement.textContent), "Connexion");
  await p.focus("#rd-recents .rdchip-id >> nth=0");
  await p.keyboard.press("Delete");
  assert.deepEqual(await p.locator("#rd-recents .rdchip-id").allTextContents(), ["333 333 333", "111 111 111"]);
  await p.locator("#rd-recents .rdchip-x").first().click();
  assert.deepEqual(await p.locator("#rd-recents .rdchip-id").allTextContents(), ["111 111 111"]);
  await p.reload(); await p.waitForSelector("#rd-recents");
  assert.deepEqual(await p.locator("#rd-recents .rdchip-id").allTextContents(), ["111 111 111"], "le retrait tient apres rechargement");
  await p.click("#rd-recents .rdchip-clear");
  assert.equal(await p.locator("#rd-recents button").count(), 0);
}, { init: { peers: PEERS } });

await test("recorded-only-after-peer_info : une session reussie, pas un clic sur Connect", async (p) => {
  await p.goto(URL_PAGE);
  await p.waitForSelector("#rd-recents", { state: "attached" });
  assert.equal(await p.locator("#rd-recents .rdchip-id").count(), 0);
  await p.evaluate(() => {
    window.curConn = { _id: "987654321", _peerInfo: { version: "1.4.2" },
      _ws: { _websocket: { readyState: 1 }, sendMessage() {}, next: () => new Promise(() => {}) },
      getRemember: () => true, setRemember() {}, getOption: () => undefined };
    window.onGlobalEvent(JSON.stringify({ name: "peer_info" }));
  });
  assert.deepEqual(await p.locator("#rd-recents .rdchip-id").allTextContents(), ["987 654 321"]);
});

await test("xss-ids-render-as-text : un stockage malveillant ne cree aucun element", async (p, _c, av) => {
  await p.goto(URL_PAGE);
  await p.waitForSelector("#rd-recents", { state: "attached" });
  const s = await p.evaluate(() => ({ imgs: document.querySelectorAll("#rd-recents img, #rd-recents script").length,
                                      libelles: [...document.querySelectorAll("#rd-recents .rdchip-id")].map((c) => c.textContent),
                                      alerte: window.__xss === true }));
  assert.equal(s.imgs, 0); assert.equal(s.alerte, false);
  assert.deepEqual(s.libelles, ["555 555 555"]);
}, { init: { "rd-recent": JSON.stringify({ v: 1, ids: [
  { id: "<img src=x onerror=window.__xss=true>", t: 9 }, { id: "555555555", t: 7 } ] }) } });

// ---------------------------------------------------------------------- bilan
await navigateur.close();
serveur.close();
const ko = resultats.filter(([, ok]) => !ok);
console.log(`\n${resultats.length - ko.length}/${resultats.length} tests navigateur reussis`);
process.exit(ko.length ? 1 : 0);
