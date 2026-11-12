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
import os from "node:os";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
// La console (web/js -> html/rd-console.js) est assemblee ICI, a chaque lancement : un fichier perime
// ferait tester l'ancienne console sans un message.
try { execFileSync("bash", [path.join(RACINE, "scripts", "build-web.sh")], { stdio: "pipe" }); }
catch (e) { finir(1, "✗ scripts/build-web.sh a echoue :\n" + String(e.stderr || e.message)); }

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

// Playwright 1.56.1 desactive la fonctionnalite Chrome « RenderDocument ». Sous Chrome 157 sans tete, cela fait REFUSER
// toute demande de plein ecran (« not granted »), meme sur une page vide : les deux tests de plein ecran echouaient sans
// que la page y soit pour rien. On repasse la liste de Playwright SANS elle — le dernier --disable-features l'emporte.
// Constate le 2026-11-12, a la mise a jour automatique de Chrome 156 -> 157 ; a retirer quand Playwright sera releve.
const FONCTIONS_COUPEES = ["AcceptCHFrame", "AvoidUnnecessaryBeforeUnloadCheckSync", "DestroyProfileOnBrowserClose", "DialMediaRouteProvider",
  "GlobalMediaControls", "HttpsUpgrades", "LensOverlay", "MediaRouter", "PaintHolding", "ThirdPartyStoragePartitioning", "Translate", "AutoDeElevate"];
let navigateur;
try {
  navigateur = await pw.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-features=" + FONCTIONS_COUPEES.join(",")], ...(CANAL ? { channel: CANAL } : {}) });
} catch (e) {
  serveur.close();
  ignorer("Chromium ne demarre pas : " + String(e.message).split("\n")[0]);
}

// ------------------------------------------------------------------- petit banc
const resultats = [];
async function test(nom, fn, { init = {}, contexte = {}, sansConsole = false, webcodecs = false } = {}) {
  // RD_TEST_FILTRE=texte : ne joue que les tests dont le nom contient ce texte (boucle de travail courte, repetition d'un cas).
  if (process.env.RD_TEST_FILTRE && !nom.includes(process.env.RD_TEST_FILTRE)) return;
  // Un test qui ne vaut que pour WebCodecs le DIT (« webcodecs ») : rejoue sans VideoDecoder, il est ignore et annonce,
  // au lieu d'echouer sans que la page y soit pour rien. Il ne compte alors ni comme reussi ni comme rate.
  if (webcodecs && process.env.RD_SANS_VIDEODECODER) { console.log("  – " + nom.split(" : ")[0] + " (ignore : exige WebCodecs)"); return; }
  // fr-FR : la langue d'ecriture de l'interface ; les tests de traduction passent la leur.
  const ctx = await navigateur.newContext({ viewport: { width: 1200, height: 800 }, locale: "fr-FR", ...contexte });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: URL_PAGE.replace(/\/$/, "") });
  if (Object.keys(init).length) {
    await ctx.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) if (localStorage.getItem("__init_" + k) === null) { localStorage.setItem(k, v); localStorage.setItem("__init_" + k, "1"); } }, init);
  }
  // RD_SANS_VIDEODECODER=1 : rejoue le banc sur le chemin du decodeur logiciel (navigateur sans WebCodecs).
  if (process.env.RD_SANS_VIDEODECODER) await ctx.addInitScript(() => { try { delete window.VideoDecoder; } catch (_) {} });
  const p = await ctx.newPage();
  // « sansConsole » : la page SEULE, comme lorsque rd-console.js ne se charge pas. Sa barre d'origine garde alors tous
  // ses controles (menu Actions, ecrans, plein ecran, bouton des raccourcis) ; avec la console, ce sont ses fenetres
  // qui les presentent. Les tests de ces controles-la visent donc la page seule ; ceux de la console, la console.
  if (sansConsole) await p.route(/\/rd-console\.(js|css)$/, (r) => r.abort());
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
async function sessionSimulee(p, { version = "1.4.2", platform = "Mac OS" } = {}) {
  // La sonde de codec est asynchrone ; quand elle retient WebCodecs, le gabarit cree #rdcanvas et l'ACTIVE (focus). On attend
  // ce cablage : sinon le focus peut etre vole au milieu d'un test, aleatoirement (c'est le gabarit, pas la console).
  const sonde = p.waitForEvent("console", { predicate: (m) => /niveau retenu/.test(m.text()), timeout: 15000 }).catch(() => null);
  await p.goto(URL_PAGE);
  await sonde;
  await p.waitForFunction(() => !window.RD.codec || (document.getElementById("rdcanvas") && document.getElementById("rdcanvas").dataset.wired), null, { timeout: 8000 });
  await p.waitForFunction(() => window.RD && window.RDLib && document.getElementById("rdbar"), null, { timeout: 15000 });
  await p.evaluate(([v, plat]) => {
    window.__envoyes = []; window.__touches = []; window.__mouse = [];
    window.curConn = { _id: "123456789", _peerInfo: { version: v, platform: plat }, _options: {},
      _ws: { _websocket: { readyState: 1 }, sendMessage(m) { window.__envoyes.push(m); }, next: () => new Promise(() => {}) },
      getRemember: () => true, setRemember() {}, getOption(n) { return this._options[n]; }, setOption(n, v) { this._options[n] = v; },
      // Ce que le vrai bundle sait faire : le pont (setByName) les appelle. Ici ils ne font que se souvenir.
      inputMouse(m, x, y, a, c, sh, cm) { window.__mouse.push([m, x, y, a, c, sh, cm]); },
      toggleOption(n) { this._options[n] = !this._options[n]; }, ctrlAltDel() {}, lockScreen() {}, switchDisplay() {}, inputKey() {}, inputString() {} };
    const sb = window.setByName; window.setByName = function (n, x) { window.__touches.push([n, x]); try { return sb.apply(this, arguments); } catch (e) { /* pas de vraie session */ } };
    document.getElementById("canvas").style.display = "block";
    document.getElementById("connect").style.display = "none";          // une vraie session masque le formulaire
    window.RD.ready = true;
  }, [version, platform]);
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
  await p.waitForFunction(() => document.activeElement && document.activeElement === window.__rdActive(), null, { timeout: 3000 });
  await p.focus("#rdbar .quit");                              // le focus est dans la barre (l'utilisateur ne peut pas y tabuler : le canvas avale Tab)
  await p.waitForFunction(() => document.activeElement && document.activeElement.className === "quit", null, { timeout: 3000 });
  await p.evaluate(() => { window.__touches.length = 0; });
  await p.keyboard.press("Escape");
  assert.equal(await p.locator(".rdhandle").getAttribute("aria-expanded"), "false", "Echap replie");
  const touches = await p.evaluate(() => window.__touches.filter(([n]) => n === "input_key"));
  assert.equal(touches.length, 0, "rien n'est envoye au poste distant");
  // Le canvas reprend le focus APRES le keyup d'Echap (un setTimeout de plus) : on l'attend.
  await p.waitForFunction(() => document.activeElement && document.activeElement === window.__rdActive(), null, { timeout: 3000 });
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
  assert.equal(await p.evaluate(() => document.activeElement === window.__rdActive()), true, "le canvas actif reprend le focus");
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
  await p.waitForFunction(() => document.activeElement && document.activeElement === window.__rdActive(), null, { timeout: 3000 });
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
  await p.waitForSelector('[data-rd="codec"]', { state: "attached" });
  // Par repere data-rd, pas par « #rdbar select » : la console deplace ces controles dans son tiroir.
  const v = await p.evaluate(() => ["qualite", "cadence", "codec"].map((n) => document.querySelector('[data-rd="' + n + '"]').value));
  assert.deepEqual(v, ["best", "60", "vp9"], JSON.stringify(v));
}, { init: { "rd-prefs": JSON.stringify({ v: 1, quality: "best", fps: 60, codec: "vp9" }) } });

const OUVERTE = { init: { "rd-prefs": JSON.stringify({ v: 1, bar: "ouverte", hint: true }) } };
const SEULE = { ...OUVERTE, sansConsole: true };          // la barre d'origine de la page, sans la console

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
}, SEULE);

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
}, { webcodecs: true });

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
}, SEULE);

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
}, SEULE);

await test("csp-and-manifest : la page complete se charge sous la politique de contenu, manifeste compris", async (p) => {
  await p.goto(URL_PAGE);
  await p.waitForSelector("#rd-entete", { timeout: 15000 });
  await p.waitForFunction(() => window.RD.caps && Object.keys(window.RD.caps).length === 4);
  const r = await p.evaluate(async () => { const x = await fetch(document.querySelector("link[rel=manifest]").href); return { ok: x.ok, nom: (await x.json()).short_name, csp: !!document.querySelector("#rd-entete img").naturalWidth }; });
  assert.deepEqual(r, { ok: true, nom: "RustDesk", csp: true });
}, { webcodecs: true });

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
}, { webcodecs: true });

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

// La page lit la plateforme LOCALE dans le navigateur (userAgentData.platform, sinon navigator.platform). Ces deux tests
// parlent d'un clavier PC : sans cela ils ne passaient que sur une machine Linux ou Windows, et echouaient sur un Mac —
// ou la paire devient « Mac devant Mac » (rien a traduire) puis « Mac devant PC » (traduction inverse).
const clavierPC = (ctx) => ctx.addInitScript(() => {
  try { Object.defineProperty(Navigator.prototype, "userAgentData", { configurable: true, get: () => ({ platform: "Windows" }) }); } catch (_) {}
  try { Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => "Win32" }); } catch (_) {}
});

await test("pc-shortcuts-translated : les raccourcis d'un clavier PC produisent le MEME EFFET sur le Mac", async (p, ctx) => {
  await clavierPC(ctx);
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
}, SEULE);

await test("pc-to-pc-untouched : devant un poste Windows, rien n'est traduit et le bouton disparait", async (p, ctx) => {
  await clavierPC(ctx);
  await sessionSimulee(p);
  await p.evaluate(() => { window.curConn._peerInfo.platform = "Windows"; window.onGlobalEvent(JSON.stringify({ name: "peer_info" })); window.__rdActive().focus(); window.__touches.length = 0; });
  await p.keyboard.press("Control+c"); await p.keyboard.press("Control+ArrowLeft"); await p.keyboard.press("Home");
  assert.deepEqual(await frappes(p), ["Ctrl+c", "Ctrl+LeftArrow", "Home"]);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#rdbar .rdclavmode")).display), "none");
}, SEULE);

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
}, SEULE);

enTete("Liaison, couleurs, nettete — la vraie classe du bundle, le vrai decodeur");

await test("reactive-link-real-class : sur la VRAIE classe de liaison du bundle, un message reveille l'attente sans minuteur", async (p) => {
  await p.goto(URL_PAGE);
  await p.waitForFunction(() => typeof window.connect === "function" && document.getElementById("id"));
  const journal = []; p.on("console", (m) => journal.push(m.text()));
  // Une vraie tentative de connexion : le bundle cree sa connexion et sa liaison (elle echouera, personne n'ecoute).
  await p.evaluate(() => { document.getElementById("id").value = "123456789"; window.connect(); });
  await p.waitForFunction(() => window.curConn && window.curConn._ws, null, { timeout: 10000 });
  await p.waitForFunction(() => Object.getPrototypeOf(window.curConn._ws).__rdReactive === true, null, { timeout: 5000 });
  const r = await p.evaluate(async () => {
    const Classe = window.curConn._ws.constructor;
    const ws = new Classe((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/id", false);
    ws._status = "open";
    // Les minuteurs sont neutralises : l'ancienne attente (setTimeout de 1 ms) ne rendrait jamais.
    const st = window.setTimeout, si = window.setInterval;
    window.setTimeout = () => 0; window.setInterval = () => 0;
    try {
      const attente = ws.next(5000);
      ws._buf.push({ test_delay: { time: 1 } });
      ws._websocket.dispatchEvent(new MessageEvent("message", { data: "x" }));
      const m = await Promise.race([attente, new Promise((res) => st(() => res("jamais"), 1500))]);
      return { m, restant: ws._buf.length };
    } finally { window.setTimeout = st; window.setInterval = si; try { ws.close(); } catch (e) { /* liaison de test */ } }
  });
  assert.deepEqual(r, { m: { test_delay: { time: 1 } }, restant: 0 });
  assert.ok(journal.some((l) => /lecture pilotee par l'arrivee des messages/.test(l)), "la classe du bundle a bien ete remplacee");
});

await test("colour-matrix : un flux sans etiquette, encode en BT.601, est rendu aux bonnes couleurs avec la configuration de la page", async (p) => {
  await p.goto(URL_PAGE);
  await p.waitForFunction(() => window.RDLib && window.RDLib.codec.COULEUR);
  const r = await p.evaluate(async () => {
    if (typeof VideoEncoder === "undefined") return { ignore: "VideoEncoder absent" };
    const W = 640, H = 360, codec = "vp09.00.40.08";
    const sup = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: 2e6, framerate: 30 }).catch(() => null);
    if (!sup || !sup.supported) return { ignore: "encodeur VP9 absent" };
    // Vert pur, converti comme libyuv ARGBToI420 : BT.601, plage limitee.
    const [Y, U, V] = [Math.round(16 + 0.504 * 255), Math.round(128 - 0.291 * 255), Math.round(128 - 0.368 * 255)];
    const buf = new Uint8Array(W * H * 3 / 2); buf.fill(Y, 0, W * H); buf.fill(U, W * H, W * H * 5 / 4); buf.fill(V, W * H * 5 / 4);
    const chunks = [];
    const enc = new VideoEncoder({ output: (c) => chunks.push(c), error: () => {} });
    enc.configure({ codec, width: W, height: H, bitrate: 2e6, framerate: 30 });
    const f = new VideoFrame(buf, { format: "I420", codedWidth: W, codedHeight: H, timestamp: 0,
      colorSpace: { primaries: null, transfer: null, matrix: null, fullRange: null } });   // sans etiquette, comme RustDesk
    enc.encode(f, { keyFrame: true }); f.close(); await enc.flush(); enc.close();
    const lire = async (extra) => { let px = null;
      const dec = new VideoDecoder({ output: (fr) => { const cv = new OffscreenCanvas(W, H), cx = cv.getContext("2d"); cx.drawImage(fr, 0, 0);
        px = [...cx.getImageData(W / 2, H / 2, 1, 1).data].slice(0, 3); fr.close(); }, error: () => {} });
      dec.configure({ codec, codedWidth: W, codedHeight: H, ...extra }); for (const c of chunks) dec.decode(c); await dec.flush(); dec.close(); return px; };
    return { sans: await lire({}), avec: await lire({ colorSpace: window.RDLib.codec.COULEUR }) };
  });
  if (r.ignore) { console.log("      (mesure ignoree : " + r.ignore + ")"); return; }
  assert.ok(r.sans[1] < 230, "sans la configuration, le navigateur suppose BT.709 et le vert est terni : " + JSON.stringify(r.sans));
  assert.ok(r.avec[0] <= 3 && r.avec[1] >= 252 && r.avec[2] <= 5, "avec, le vert est le vert : " + JSON.stringify(r.avec));
}, { webcodecs: true });

await test("pixel-exact-fit : sur un ecran a 125 %, une image de 1920 est affichee sur 1920 pixels physiques, sans interpolation", async (p) => {
  await sessionSimulee(p);
  const r = await p.evaluate(() => { const c = window.__rdActive(); c.width = 1920; c.height = 1080; window.__rdFit();
    const b = c.getBoundingClientRect(); return { css: b.width, phys: b.width * devicePixelRatio, rendu: getComputedStyle(c).imageRendering, dpr: devicePixelRatio }; });
  assert.equal(r.dpr, 1.25);
  assert.equal(r.css, 1536);
  assert.equal(r.phys, 1920);
  assert.equal(r.rendu, "pixelated");
}, { contexte: { viewport: { width: 1560, height: 900 }, deviceScaleFactor: 1.25 } });

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


// ------------------------------------------------------------- console de session
// Le vrai DOM, le vrai pointeur : ce que le banc Node (faux DOM) ne peut pas voir.
enTete("Console de session — vrai DOM, vrai pointeur");

const NOMS6 = ["resolution", "ajuster", "qualite", "cadence", "codec", "swap"];
const montee = (p) => p.waitForFunction(() => document.body.classList.contains("rd-console"), null, { timeout: 8000 });
const ouvrirTiroir = async (p) => {
  await p.click(".rdhandle");                                       // deplie la barre (repliee par defaut)
  await p.click("#rdbar .rdsession");
  await p.waitForFunction(() => !document.getElementById("rddrawer").hidden, null, { timeout: 3000 });
  // Les clics rendent le focus au canvas dans un setTimeout(0) : sous charge il peut arriver APRES le p.focus() d'un test.
  await p.waitForFunction(() => document.activeElement === window.__rdActive(), null, { timeout: 3000 });
};
const grandEcran = (p) => p.evaluate(() => { const c = window.__rdActive(); c.width = 1920; c.height = 1080; window.__rdFit(); });

await test("console-mounts-and-moves-controls : six controles dans le tiroir, les autres restent enfants directs de la barre", async (p) => {
  await sessionSimulee(p); await montee(p);
  await p.waitForSelector("#rdbar .rdfilesbtn", { state: "attached", timeout: 8000 });
  const e = await p.evaluate((noms) => ({
    tiroir: noms.map((n) => !!document.querySelector('#rddrawer [data-rd="' + n + '"]')),
    barre: noms.map((n) => !!document.querySelector('#rdbar [data-rd="' + n + '"]')),
    directs: ["rdsession", "rdfilesbtn", "quit", "rdhandle"].map((c) => { const x = document.querySelector("#rdbar ." + c); return !!x && x.parentNode === document.getElementById("rdbar"); }),
    sections: [...document.querySelectorAll("#rddrawer details summary")].map((x) => x.textContent),
    statut: !!document.getElementById("rdstatut"),
  }), NOMS6);
  assert.deepEqual(e.tiroir, NOMS6.map(() => true), "les six dans le tiroir : " + JSON.stringify(e));
  assert.deepEqual(e.barre, NOMS6.map(() => false), "plus aucun dans la barre");
  assert.deepEqual(e.directs, [true, true, true, true], "session, fichiers, quitter, poignee : enfants directs de #rdbar");
  assert.deepEqual(e.sections, ["Vidéo", "Audio", "Clavier", "Souris", "Affichage"]);
  assert.equal(e.statut, true);
});

await test("console-moved-controls-still-work : qualite, cadence, codec, raccourcis traduits gardent leurs gestionnaires et leurs reglages memorises", async (p, ctx) => {
  await clavierPC(ctx);                                          // un PC devant un Mac : il y a des raccourcis a traduire, quelle que soit la machine du banc
  await sessionSimulee(p); await montee(p);
  await p.evaluate(() => window.onGlobalEvent(JSON.stringify({ name: "peer_info" })));        // la page apprend la plateforme du pair
  await ouvrirTiroir(p);
  await p.selectOption('#rddrawer [data-rd="qualite"]', "best");
  await p.selectOption('#rddrawer [data-rd="cadence"]', "60");
  await p.selectOption('#rddrawer [data-rd="codec"]', "vp9");
  const e = await p.evaluate(() => ({
    touches: window.__touches.filter(([n]) => n === "image_quality"),
    option: window.__envoyes.map((m) => m.misc && m.misc.option && m.misc.option.custom_fps).filter(Boolean),
    prefs: JSON.parse(localStorage.getItem("rd-prefs")), forced: window.RD.forced,
  }));
  assert.deepEqual(e.touches, [["image_quality", "best"]], "setByName(image_quality) part toujours");
  assert.deepEqual(e.option, [60], "custom_fps part toujours");
  assert.deepEqual([e.prefs.quality, e.prefs.fps, e.prefs.codec], ["best", 60, "vp9"], "rd-prefs ecrit comme avant");
  assert.equal(e.forced, "vp9");
  const avant = await p.evaluate(() => localStorage.getItem("rd-swap-ctrl"));
  // Raccourcis traduits : un interrupteur pilote le bouton d'origine, cache dans le tiroir ; l'etat se relit a la source.
  const sw = '#rddrawer .rdsw[data-pour="swap"]';
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('#rddrawer [data-rd="swap"]')).display), "none", "le bouton d'origine est masque");
  assert.equal(await p.isChecked(sw), avant !== "0", "l'interrupteur reflete l'etat memorise");
  await p.click(sw);
  const apres = await p.evaluate(() => localStorage.getItem("rd-swap-ctrl"));
  assert.notEqual(apres, avant, "la traduction bascule et se memorise");
  assert.equal(await p.isChecked(sw), apres !== "0", "et l'interrupteur suit");
});

await test("console-reserves-space-for-bars : l'image se cale entre barre, tiroir et statut, et rien ne la recouvre", async (p) => {
  await sessionSimulee(p); await montee(p); await grandEcran(p);
  const K = await p.evaluate(() => ({ b: RDConsole.layout.BARRE, t: RDConsole.layout.TIROIR, s: RDConsole.layout.STATUT }));
  const cadre = () => p.evaluate(() => { const c = document.getElementById("canvas").getBoundingClientRect();
    return { top: Math.round(c.top), left: Math.round(c.left), bas: Math.round(innerHeight - c.bottom), droite: Math.round(innerWidth - c.right) }; });
  await p.waitForFunction(() => document.getElementById("rdstatut") && !document.getElementById("rdstatut").hidden, null, { timeout: 3000 });
  assert.deepEqual(await cadre(), { top: 0, left: 0, bas: K.s, droite: 0 }, "defaut : barre repliee, tiroir ferme, statut visible");
  await p.click(".rdhandle");
  await p.waitForFunction((n) => Math.round(document.getElementById("canvas").getBoundingClientRect().top) === n, K.b, { timeout: 3000 });
  assert.deepEqual(await cadre(), { top: K.b, left: 0, bas: K.s, droite: 0 }, "barre depliee");
  await p.click("#rdbar .rdsession");
  await p.waitForFunction((n) => Math.round(document.getElementById("canvas").getBoundingClientRect().left) === n, K.t, { timeout: 3000 });
  assert.deepEqual(await cadre(), { top: K.b, left: K.t, bas: K.s, droite: 0 }, "tiroir ouvert : l'image est poussee");
  const s = await p.evaluate(() => {
    const r = (e) => e.getBoundingClientRect(), v = r(window.__rdActive()), b = r(document.getElementById("rdbar")),
          t = r(document.getElementById("rddrawer")), st = r(document.getElementById("rdstatut"));
    const cx = v.left + v.width / 2, cy = v.top + v.height / 2, cible = document.elementFromPoint(cx, cy);
    return { ok: v.top >= b.bottom - 1 && v.left >= t.right - 1 && v.bottom <= st.top + 1, v: [v.left, v.top, v.right, v.bottom], b: b.bottom, t: t.right, st: st.top,
             centre: cible === window.__rdActive(), cibleTag: cible && (cible.id || cible.tagName),
             drawerHit: !!document.elementFromPoint(100, 300).closest("#rddrawer"), barHit: !!document.elementFromPoint(100, 10).closest("#rdbar") };
  });
  assert.ok(s.ok, "l'image ne chevauche ni la barre, ni le tiroir, ni le statut : " + JSON.stringify(s));
  assert.ok(s.centre, "le centre de l'image atteint le canvas, pas une barre : " + s.cibleTag);
  assert.ok(s.drawerHit && s.barHit, "le tiroir et la barre captent bien le pointeur la ou ils sont");
  await p.click("#rddrawer .rdfermer");
  await p.waitForFunction(() => Math.round(document.getElementById("canvas").getBoundingClientRect().left) === 0, null, { timeout: 3000 });
});

await test("console-escape-and-focus : Echap ferme le tiroir sans rien envoyer au poste, et le canvas reprend le clavier", async (p) => {
  await sessionSimulee(p); await montee(p); await ouvrirTiroir(p);
  await p.focus('#rddrawer [data-rd="ajuster"]');
  await p.evaluate(() => { window.__touches.length = 0; });
  await p.keyboard.press("Escape");
  assert.equal(await p.evaluate(() => document.getElementById("rddrawer").hidden), true, "Echap ferme");
  assert.equal((await p.evaluate(() => window.__touches.filter(([n]) => n === "input_key"))).length, 0, "rien n'est envoye au poste distant");
  await p.waitForFunction(() => document.activeElement === window.__rdActive(), null, { timeout: 3000 });
  await p.keyboard.press("Escape");                                  // le canvas, lui, transmet toujours Echap
  assert.ok((await p.evaluate(() => window.__touches.filter(([n]) => n === "input_key").length)) >= 1, "Echap sur le canvas part vers le poste");
  await p.click("#rdbar .rdsession");                                // la barre est deja depliee : on rouvre par le bouton Session
  await p.waitForFunction(() => !document.getElementById("rddrawer").hidden, null, { timeout: 3000 });
  await p.click('#rddrawer [data-rd="ajuster"]');                    // un clic sur un bouton du tiroir rend le clavier au canvas
  await p.waitForFunction(() => document.activeElement === window.__rdActive(), null, { timeout: 3000 });
});

await test("console-status-bar-and-persistence : le resume du HUD, un interrupteur, et des reglages qui survivent au rechargement", async (p) => {
  await sessionSimulee(p); await montee(p);
  await p.evaluate(() => { window.RD.stats.bitrate = 4664; });
  await p.waitForFunction(() => /4664 kbit\/s/.test(document.querySelector(".rdst-ligne").getAttribute("data-ligne") || ""), null, { timeout: 5000 });
  const ligne = await p.evaluate(() => document.querySelector(".rdst-ligne").getAttribute("data-ligne"));
  assert.match(ligne, /^(H\.265|VP9|Logiciel)( \d+×\d+)? \/ 4664 kbit\/s \/ (\d+ i\/s|—)$/, ligne);
  await ouvrirTiroir(p);
  await p.uncheck('#rddrawer .rdsw[data-pour="statut"]');
  assert.equal(await p.evaluate(() => document.getElementById("rdstatut").hidden), true, "la barre de statut se masque");
  const stocke = await p.evaluate(() => JSON.parse(localStorage.getItem("rd-console")));
  assert.equal(stocke.statut, "masquee"); assert.equal(stocke.drawer, "ouvert");
  await p.evaluate(() => { const k = localStorage.getItem("rd-console"); localStorage.setItem("__k", k); });
  await sessionSimulee(p); await montee(p);                          // rechargement
  await p.waitForFunction(() => !document.getElementById("rddrawer").hidden, null, { timeout: 4000 });
  assert.equal(await p.evaluate(() => document.getElementById("rdstatut").hidden), true, "reglage restaure : statut masque");
});

await test("console-failure-falls-back-to-original-bar : une console qui leve laisse la barre d'origine intacte", async (p, ctx) => {
  await ctx.route("**/rd-console.js", (route) => route.fulfill({ contentType: "text/javascript", body: "throw new Error('console cassee');" }));
  await sessionSimulee(p);
  await p.waitForTimeout(1600);
  const e = await p.evaluate((noms) => ({
    classe: document.body.classList.contains("rd-console"),
    barre: noms.map((n) => !!document.querySelector('#rdbar [data-rd="' + n + '"]')),
    tiroir: !!document.getElementById("rddrawer"), statut: !!document.getElementById("rdstatut"),
    visible: getComputedStyle(document.getElementById("rdbar")).display !== "none",
    top: document.documentElement.style.getPropertyValue("--rd-top"),
  }), NOMS6);
  assert.equal(e.classe, false, "aucun habillage sans montage reussi");
  assert.deepEqual(e.barre, NOMS6.map(() => true), "les six controles sont toujours dans la barre");
  assert.equal(e.tiroir || e.statut, false); assert.equal(e.visible, true); assert.equal(e.top, "");
});

await test("console-mount-failure-rolls-back : un echec en plein montage remet tout en place", async (p, ctx) => {
  await ctx.addInitScript(() => {
    const orig = Element.prototype.insertBefore;
    Element.prototype.insertBefore = function (n, r) { if (n && n.className === "rdsession") throw new Error("test : echec de montage"); return orig.call(this, n, r); };
  });
  const logs = []; p.on("console", (m) => logs.push(m.text()));
  await sessionSimulee(p);
  for (let i = 0; i < 40 && !logs.some((l) => /montage abandonne/.test(l)); i++) await p.waitForTimeout(200);
  assert.ok(logs.some((l) => /montage abandonne/.test(l)), "l'abandon est journalise : " + logs.filter((l) => /console/.test(l)).join(" | "));
  const e = await p.evaluate((noms) => ({
    classe: document.body.classList.contains("rd-console"),
    ordre: [...document.querySelectorAll("#rdbar > [data-rd]")].map((x) => x.getAttribute("data-rd")),
    parents: noms.map((n) => { const x = document.querySelector('[data-rd="' + n + '"]'); return x && x.parentNode && x.parentNode.id; }),
    residus: ["rddrawer", "rdstatut"].filter((id) => document.getElementById(id)).concat([...document.querySelectorAll(".rdsession")].map(() => "rdsession")),
    vars: ["--rd-top", "--rd-left", "--rd-bottom"].map((v) => document.documentElement.style.getPropertyValue(v)),
  }), NOMS6);
  assert.equal(e.classe, false);
  assert.deepEqual(e.parents, NOMS6.map(() => "rdbar"), "les six controles sont revenus dans la barre");
  assert.deepEqual(e.ordre.slice(0, 6), NOMS6, "dans leur ordre d'origine : " + e.ordre);
  assert.deepEqual(e.residus, [], "ni tiroir, ni statut, ni bouton orphelin");
  assert.deepEqual(e.vars, ["", "", ""]);
});

await test("console-mouse-coordinates-stay-exact : l'image calee entre les barres ne decale aucun clic sur le poste distant", async (p) => {
  await sessionSimulee(p); await montee(p); await grandEcran(p);
  // Clic au vrai pointeur a une fraction de l'image, rendu en coordonnees distantes (1920×1080).
  const cliquer = async (fx, fy) => {
    const r = await p.evaluate(() => { const b = window.__rdActive().getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; });
    await p.evaluate(() => { window.__touches.length = 0; });
    await p.mouse.move(r.l + r.w * fx, r.t + r.h * fy); await p.mouse.down(); await p.mouse.up();
    return p.evaluate(() => window.__touches.filter(([n]) => n === "send_mouse").map(([, v]) => JSON.parse(v)).filter((m) => m.type === "down").pop());
  };
  const proche = (m, x, y, nom) => {
    assert.ok(m, nom + " : aucun clic recu");
    assert.ok(Math.abs(m.x - x) <= 2 && Math.abs(m.y - y) <= 2, `${nom} : attendu (${x},${y}), recu (${m.x},${m.y})`);
  };
  const dispositions = [
    ["defaut (barre repliee, statut visible)", async () => {}],
    ["barre depliee + tiroir ouvert", async () => { await ouvrirTiroir(p); await p.waitForTimeout(150); }],
    ["tiroir ferme, statut masque", async () => {
      await p.click("#rddrawer .rdfermer"); await p.uncheck('#rddrawer .rdsw[data-pour="statut"]').catch(() => {}); }],
  ];
  for (const [nom, preparer] of dispositions) {
    await preparer(); await grandEcran(p);
    proche(await cliquer(0.5, 0.5), 960, 540, nom + " / centre");
    proche(await cliquer(0.01, 0.01), 19, 11, nom + " / coin haut-gauche");
    proche(await cliquer(0.99, 0.99), 1901, 1069, nom + " / coin bas-droit");
  }
});

// ------------------------------------------------------------------- design
enTete("Console de session — design, accessibilite, ergonomie");

// Mesure de contraste dans la page : le navigateur convertit lui-meme oklch()/light-dark()/color-mix()
// en pixels (canvas), on ne reimplemente donc aucune conversion de couleur.
const MESURE = `(() => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const poser = (c, base) => { cx.fillStyle = base; cx.fillRect(0, 0, 1, 1); cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
  // Fond opaque d'un element : on remonte jusqu'a un fond plein, puis on compose de haut en bas.
  const fond = (el) => { const pile = []; for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor;
      pile.push(c); if (/^(rgb|color|oklch|oklab|lab|lch|hsl)\\(/.test(c) && !/\\/ ?0?\\.\\d+\\)|rgba\\(.*,\\s*0?\\.\\d+\\)/.test(c) && c !== "rgba(0, 0, 0, 0)") break; }
    let base = "#000"; for (const c of pile.reverse()) if (c !== "rgba(0, 0, 0, 0)") base = (() => { const o = poser(c, base); return "rgb(" + o.join(",") + ")"; })(); return base; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const rapport = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const rgb = (c, base) => poser(c, base);
  return { poser, fond, rapport, rgb, lum };
})()`;

await test("console-contrast-wcag : texte >= 4,5:1 et composants >= 3:1, en clair comme en sombre", async (p) => {
  await sessionSimulee(p); await montee(p); await grandEcran(p);
  await p.waitForSelector("#rdbar .rdfilesbtn", { state: "attached", timeout: 8000 });
  await p.evaluate(() => { window.RD.stats.delay = [25, 28, 30]; });
  await ouvrirTiroir(p);
  await p.waitForFunction(() => document.querySelector(".rdst-ligne .rdseg"), null, { timeout: 5000 });
  const mesurer = (theme) => p.evaluate(({ MESURE, theme }) => {
    document.body.setAttribute("data-rd-theme", theme);
    // Les couleurs transitent sur 120 a 160 ms : on lit l'etat d'arrivee, pas un instant du trajet.
    document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { /* infinie */ } });
    const M = eval(MESURE), q = (s) => document.querySelector(s);
    q(".rdst-etat").textContent = "Reprise 1/6";
    const temp = (jeton) => { const e = document.createElement("i"); e.style.color = "var(--" + jeton + ")"; document.body.appendChild(e);
      const c = getComputedStyle(e).color; e.remove(); return c; };
    const texte = (nom, fg, bg, seuil) => { const f = M.fond(bg), c = getComputedStyle(fg).color;
      return { nom, seuil, r: M.rapport(M.rgb(c, f), M.rgb(f, "#000")), }; };
    const compo = (nom, couleur, bg, seuil) => { const f = M.fond(bg); return { nom, seuil, r: M.rapport(M.rgb(couleur, f), M.rgb(f, "#000")) }; };
    const sw = q('#rddrawer .rdsw[data-pour="coalesce"]'), sel = q('#rddrawer select');
    return [
      texte("libelle du tiroir", q("#rddrawer .rdlib"), q("#rddrawer"), 4.5),
      texte("aide du tiroir", q("#rddrawer .rdaide"), q("#rddrawer"), 4.5),
      texte("titre de section", q("#rddrawer summary"), q("#rddrawer"), 4.5),
      texte("rtt du statut", q("#rdstatut .rdrtt"), q("#rdstatut"), 4.5),
      texte("resume du statut", q("#rdstatut .rdst-ligne"), q("#rdstatut"), 4.5),
      texte("etat de reprise", q("#rdstatut .rdst-etat"), q("#rdstatut"), 4.5),
      texte("pastille du poste", q("#rdbar .rdpair"), q("#rdbar .rdpair"), 4.5),
      texte("bouton Session actif", q("#rdbar .rdsession"), q("#rdbar .rdsession"), 4.5),
      texte("bouton Fichiers", q("#rdbar .rdfilesbtn"), q("#rdbar .rdfilesbtn"), 4.5),
      texte("bouton Quitter", q("#rdbar .quit"), q("#rdbar .quit"), 4.5),
      texte("segment inactif", q('.rdsegmented [aria-checked="false"]'), q(".rdsegmented"), 4.5),
      texte("segment actif", q('.rdsegmented [aria-checked="true"]'), q('.rdsegmented [aria-checked="true"]'), 4.5),
      texte("liste deroulante", sel, sel, 4.5),
      compo("bord d'un interrupteur", getComputedStyle(sw).borderTopColor, q("#rddrawer"), 3),
      compo("bord d'une liste deroulante", getComputedStyle(sel).borderTopColor, q("#rddrawer"), 3),
      compo("anneau de focus sur la barre", temp("rd-focus"), q("#rdbar"), 3),
      compo("anneau de focus sur le tiroir", temp("rd-focus"), q("#rddrawer"), 3),
      compo("point de liaison fluide", temp("rd-ok"), q("#rdstatut"), 3),
      compo("point de liaison correcte", temp("rd-warn"), q("#rdstatut"), 3),
      compo("point de liaison lente", temp("rd-bad"), q("#rdstatut"), 3),
    ];
  }, { MESURE, theme });
  for (const theme of ["clair", "sombre"]) {
    const m = await mesurer(theme);
    const mauvais = m.filter((x) => !(x.r >= x.seuil));
    assert.deepEqual(mauvais.map((x) => `${x.nom} : ${x.r.toFixed(2)}:1 < ${x.seuil}`), [], `theme ${theme} — pire : ` +
      m.slice().sort((a, b) => a.r / a.seuil - b.r / b.seuil).slice(0, 3).map((x) => `${x.nom} ${x.r.toFixed(2)}:1`).join(", "));
  }
}, { contexte: { colorScheme: "light" } });

await test("console-theme : « auto » suit le systeme, « clair » et « sombre » le forcent, et le choix survit au rechargement", async (p) => {
  await sessionSimulee(p); await montee(p);
  await p.waitForSelector("#rdbar .rdfilesbtn", { state: "attached", timeout: 8000 });
  const fond = () => p.evaluate(`(() => { const M = ${MESURE}; return M.lum(M.rgb(M.fond(document.getElementById("rddrawer")), "#000")); })()`);
  await ouvrirTiroir(p);
  assert.equal(await p.getAttribute("body", "data-rd-theme"), "auto", "defaut : auto");
  assert.ok(await fond() > 0.5, "systeme clair + auto : tiroir clair");
  await p.emulateMedia({ colorScheme: "dark" });
  assert.ok(await fond() < 0.1, "systeme sombre + auto : tiroir sombre");
  await p.click('.rdsegmented [data-valeur="clair"]');
  assert.ok(await fond() > 0.5, "« clair » force le clair malgre un systeme sombre");
  assert.equal(await p.getAttribute('.rdsegmented [data-valeur="clair"]', "aria-checked"), "true");
  await p.emulateMedia({ colorScheme: "light" });
  await p.click('.rdsegmented [data-valeur="sombre"]');
  assert.ok(await fond() < 0.1, "« sombre » force le sombre malgre un systeme clair");
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("rd-console")).theme), "sombre");
  await sessionSimulee(p); await montee(p);                            // rechargement
  await p.waitForFunction(() => !document.getElementById("rddrawer").hidden, null, { timeout: 4000 });
  assert.equal(await p.getAttribute("body", "data-rd-theme"), "sombre", "le choix est restaure");
  assert.ok(await fond() < 0.1);
  // La zone de l'image, elle, reste noire dans les deux themes : c'est le poste distant, pas l'interface.
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("canvas")).backgroundColor), "rgb(0, 0, 0)");
}, { contexte: { colorScheme: "light" } });

await test("console-keyboard-controls : le contrOle segmente (fleches) et les interrupteurs (Espace) se pilotent au clavier", async (p) => {
  await sessionSimulee(p); await montee(p); await ouvrirTiroir(p);
  const GT = '.rdsegmented:has([data-valeur="clair"])';                    // le groupe du theme : il y en a plusieurs dans le tiroir
  const actif = () => p.evaluate((g) => [...document.querySelectorAll(g + " [role=radio]")].map((b) => b.getAttribute("aria-checked") + ":" + b.tabIndex).join(" "), GT);
  assert.equal(await actif(), "true:0 false:-1 false:-1", "un seul segment dans l'ordre de tabulation (Auto)");
  await p.focus(GT + ' [aria-checked="true"]');
  await p.keyboard.press("ArrowRight");
  assert.equal(await actif(), "false:-1 true:0 false:-1", "fleche droite : « clair »");
  assert.equal(await p.evaluate(() => document.activeElement.getAttribute("data-valeur")), "clair", "le focus suit le choix");
  await p.keyboard.press("ArrowLeft");
  assert.equal(await p.evaluate(() => document.activeElement.getAttribute("data-valeur")), "auto", "fleche gauche : « auto » : " + await p.evaluate(() => document.activeElement.outerHTML.slice(0, 160)));
  await p.keyboard.press("ArrowLeft");
  assert.equal(await p.evaluate(() => document.activeElement.getAttribute("data-valeur")), "sombre", "boucle de « auto » vers « sombre » : " + await p.evaluate(() => document.activeElement.outerHTML.slice(0, 160)));
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("rd-console")).theme), "sombre");
  const sw = '#rddrawer .rdsw[data-pour="coalesce"]';
  const avant = await p.evaluate(() => window.RD.coalesce);
  await p.focus(sw); await p.keyboard.press("Space");
  assert.equal(await p.evaluate(() => window.RD.coalesce), !avant, "Espace bascule l'interrupteur, et le reglage reel");
  assert.equal(await p.getAttribute(sw, "role"), "switch");
  assert.equal(await p.evaluate(() => document.querySelector('#rddrawer [data-rd="resolution"]').getAttribute("aria-labelledby") !== null), true, "les champs sont nommes par leur libelle");
  assert.equal(await p.evaluate(() => { const c = document.querySelector('#rddrawer [data-rd="codec"]'); return !!document.getElementById(c.getAttribute("aria-describedby")); }), true, "et decrits par leur aide");
});

await test("console-top-bar-and-link : icones et libelles, poste distant, et sante de la liaison mesuree", async (p) => {
  await sessionSimulee(p); await montee(p);
  await p.click(".rdhandle");
  await p.waitForSelector("#rdbar .rdfilesbtn svg", { timeout: 8000 });
  const e = await p.evaluate(() => ({
    noms: [".rdsession", ".rdfilesbtn", ".quit"].map((s) => document.querySelector("#rdbar " + s).textContent.trim()),
    icones: [".rdsession", ".rdfilesbtn", ".quit"].map((s) => !!document.querySelector("#rdbar " + s + " > svg.rdico[aria-hidden=true]")),
    poste: document.querySelector("#rdbar .rdpair").textContent.trim(), posteVisible: !document.querySelector("#rdbar .rdpair").hidden,
    directs: [".rdfilesbtn", ".quit"].map((s) => document.querySelector("#rdbar " + s).parentNode === document.getElementById("rdbar")),
    ordre: [...document.getElementById("rdbar").children].filter((x) => getComputedStyle(x).display !== "none").map((x) => x.className.split(" ")[0] || x.tagName),
  }));
  assert.deepEqual(e.noms, ["Session", "Fichiers", "Quitter"], "le texte reste la : nom accessible garanti");
  assert.deepEqual(e.icones, [true, true, true]);
  assert.equal(e.poste, "123 456 789"); assert.equal(e.posteVisible, true);
  assert.deepEqual(e.directs, [true, true], "habiller() ne deplace rien : enfants directs conserves");
  assert.deepEqual(e.ordre.slice(0, 2), ["rdsession", "rdpair"], "Session puis poste distant : " + e.ordre);
  assert.equal(e.ordre[e.ordre.length - 1], "rdhandle", "la poignee reste en dernier");
  const lien = (delais) => p.evaluate((d) => { window.RD.stats.delay = d; return null; }, delais)
    .then(() => p.waitForFunction((n) => document.querySelector("#rdstatut .rdlien").getAttribute("data-sante") === n, null, { timeout: 4000 }));
  await p.waitForSelector("#rdstatut:not([hidden])");
  await p.evaluate(() => { window.RD.stats.delay = [22, 25, 31]; });
  await p.waitForFunction(() => document.querySelector("#rdstatut .rdlien").getAttribute("data-sante") === "bonne", null, { timeout: 4000 });
  assert.equal(await p.textContent("#rdstatut .rdrtt"), "25 ms");
  assert.match(await p.getAttribute("#rdstatut .rdlien", "title"), /25 ms.*fluide/);
  await p.evaluate(() => { window.RD.stats.delay = [90, 100, 110]; });
  await p.waitForFunction(() => document.querySelector("#rdstatut .rdlien").getAttribute("data-sante") === "moyenne", null, { timeout: 4000 });
  await p.evaluate(() => { window.RD.stats.delay = [200, 210, 260]; });
  await p.waitForFunction(() => document.querySelector("#rdstatut .rdlien").getAttribute("data-sante") === "mauvaise", null, { timeout: 4000 });
  assert.match(await p.getAttribute("#rdstatut .rdlien", "title"), /lente/);
  await p.evaluate(() => { window.RD.stats.delay = []; });
  await p.waitForFunction(() => document.querySelector("#rdstatut .rdlien").getAttribute("data-sante") === "inconnue", null, { timeout: 4000 });
  assert.equal(await p.textContent("#rdstatut .rdrtt"), "—", "aucune mesure : un tiret, jamais « 0 ms »");
});

await test("console-reduced-motion : avec « reduire les animations », plus aucune transition notable", async (p) => {
  await sessionSimulee(p); await montee(p); await ouvrirTiroir(p);
  const d = await p.evaluate(() => { const t = (s) => Math.max(...getComputedStyle(document.querySelector(s)).transitionDuration.split(",").map(parseFloat));
    return [t("#rddrawer"), t("#rddrawer summary"), t('#rddrawer .rdsw'), t("#rdbar .rdsession")]; });
  for (const v of d) assert.ok(v < 0.001, "transition de " + v + " s");
}, { contexte: { reducedMotion: "reduce" } });

await test("console-motion-by-default : sans preference, le tiroir s'anime (entree en fondu et glissement)", async (p) => {
  await sessionSimulee(p); await montee(p); await ouvrirTiroir(p);
  const t = await p.evaluate(() => getComputedStyle(document.getElementById("rddrawer")).transitionDuration);
  assert.ok(t.split(",").some((v) => parseFloat(v) >= 0.15), "duree de transition : " + t);
});

await test("console-forced-colors : en couleurs forcees, bordures et textes suivent les couleurs du systeme", async (p) => {
  await sessionSimulee(p); await montee(p); await ouvrirTiroir(p);
  const e = await p.evaluate(() => { const d = document.getElementById("rddrawer"), cs = getComputedStyle(d);
    return { forces: matchMedia("(forced-colors: active)").matches, bord: cs.borderRightColor, texte: cs.color, fond: cs.backgroundColor }; });
  assert.equal(e.forces, true);
  assert.equal(e.bord, e.texte, "bordure = CanvasText = texte");
  assert.notEqual(e.fond, e.texte, "fond et texte restent distincts");
}, { contexte: { forcedColors: "active" } });

await test("console-touch-targets : sur un ecran tactile, les cibles font au moins 44 px", async (p) => {
  await sessionSimulee(p); await montee(p);
  await p.click(".rdhandle");
  await p.waitForSelector("#rdbar .rdfilesbtn svg", { timeout: 8000 });
  await p.tap("#rdbar .rdsession");
  await p.waitForFunction(() => !document.getElementById("rddrawer").hidden, null, { timeout: 3000 });
  const e = await p.evaluate(() => ({ grossier: matchMedia("(pointer: coarse)").matches,
    h: Object.fromEntries([["session", "#rdbar .rdsession"], ["fichiers", "#rdbar .rdfilesbtn"], ["quitter", "#rdbar .quit"],
      ["liste", '#rddrawer [data-rd="qualite"]'], ["ajuster", '#rddrawer [data-rd="ajuster"]'], ["fermer", "#rddrawer .rdfermer"],
      ["segment", '.rdsegmented [aria-checked="true"]'], ["interrupteur", '#rddrawer .rdsw[data-pour="coalesce"]']]
      .map(([n, s]) => [n, Math.round(document.querySelector(s).getBoundingClientRect().height)])) }));
  assert.equal(e.grossier, true, "pointeur grossier detecte");
  for (const n of ["session", "fichiers", "quitter", "liste", "ajuster", "fermer"]) assert.ok(e.h[n] >= 44, `${n} : ${e.h[n]} px`);
  assert.ok(e.h.segment >= 36 && e.h.interrupteur >= 28, `segment ${e.h.segment} px, interrupteur ${e.h.interrupteur} px`);
}, { contexte: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });

await test("console-bottom-sheet : sur ecran etroit, une feuille posee sur l'image, scrollable, avec poignee", async (p) => {
  await sessionSimulee(p); await montee(p); await grandEcran(p); await ouvrirTiroir(p);
  await p.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { /* infinie */ } }));   // fin du glissement d'entree
  const e = await p.evaluate(() => { const d = document.getElementById("rddrawer"), r = d.getBoundingClientRect(), c = d.querySelector(".rdcorps"),
    poignee = getComputedStyle(d.querySelector(".rdtete"), "::before");
    return { haut: Math.round(r.height), vue: innerHeight, bas: Math.round(innerHeight - r.bottom),
             defile: c.scrollHeight > c.clientHeight, ov: getComputedStyle(c).overscrollBehaviorY, poignee: poignee.content,
             rayon: getComputedStyle(d).borderTopLeftRadius, libellesMasques: Math.round(document.querySelector("#rdbar .rdsession .rdlbl").getBoundingClientRect().width) };
  });
  assert.ok(e.haut <= e.vue * 0.7 + 1, `feuille <= 70 % de la hauteur : ${e.haut}/${e.vue}`);
  assert.equal(e.bas, 30, "posee juste au-dessus de la barre de statut");
  assert.equal(e.defile, true, "le contenu defile dans la feuille");
  assert.equal(e.ov, "contain", "le defilement ne remonte pas vers la page");
  assert.notEqual(e.poignee, "none"); assert.notEqual(e.rayon, "0px");
  assert.ok(e.libellesMasques <= 2, "libelles de la barre haute masques visuellement (mais lisibles par un lecteur d'ecran)");
}, { contexte: { viewport: { width: 390, height: 844 } } });

await test("console-narrow-screen : sur ecran etroit le tiroir est une feuille basse qui ne pousse pas l'image", async (p) => {
  await sessionSimulee(p); await montee(p); await grandEcran(p); await ouvrirTiroir(p);
  const e = await p.evaluate(() => { const t = document.getElementById("rddrawer").getBoundingClientRect(), c = document.getElementById("canvas").getBoundingClientRect();
    return { largeTiroir: Math.round(t.width), gauche: Math.round(t.left), poussee: Math.round(c.left), hud: getComputedStyle(document.getElementById("rdhud")).display }; });
  assert.equal(e.largeTiroir, 390, "le tiroir occupe toute la largeur : " + JSON.stringify(e));
  assert.equal(e.poussee, 0, "l'image n'est pas poussee a gauche");
  assert.equal(e.hud, "none", "le HUD ne recouvre pas la feuille");
}, { contexte: { viewport: { width: 390, height: 844 } } });

// ------------------------------------------------------- ecran de connexion
enTete("Ecran de connexion — carte, accessibilite, telephone");
const formulaire = async (p) => { await p.goto(URL_PAGE); await p.waitForSelector("#id[data-rdlogin]", { timeout: 15000 }); await p.waitForSelector("#rd-entete", { timeout: 15000 });   /* l'habillage de la page (en-tete, label, pied) arrive a son premier tick */ };

await test("login-no-horizontal-overflow-on-phones : a 360 et 390 px la page ne deborde plus (elle se dezoomait a 477 px)", async (p) => {
  for (const largeur of [360, 390, 430, 1200]) {
    await p.setViewportSize({ width: largeur, height: 800 });
    await formulaire(p);
    const e = await p.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, id: [r("#id").left, r("#id").right], carte: [r("#connect").left, r("#connect").right],
               go: Math.round(r("#connect td > button").height), idH: Math.round(r("#id").height), tailleId: parseFloat(getComputedStyle(document.getElementById("id")).fontSize) }; });
    assert.ok(e.sw <= e.iw, `${largeur} px : scrollWidth ${e.sw} > ${e.iw}`);
    assert.ok(e.id[0] >= e.carte[0] && e.id[1] <= e.carte[1], `${largeur} px : le champ Id sort de la carte : ${JSON.stringify(e)}`);
    assert.ok(e.go >= 44 && e.idH >= 44, `${largeur} px : cibles trop petites (Connect ${e.go}, Id ${e.idH})`);
    assert.ok(e.tailleId >= 16, `${largeur} px : champ a ${e.tailleId} px, iOS zoomerait au focus`);
  }
});

await test("login-name-enter-once-and-hint : le champ est nomme, Entree lance UNE connexion, « Aller » sur le clavier mobile", async (p) => {
  await formulaire(p);
  await p.waitForSelector('#id[inputmode="numeric"]', { timeout: 5000 });     // pose par le gabarit a son premier tick (400 ms)
  await p.waitForSelector('#id[enterkeyhint="go"]', { timeout: 5000 });       // pose par la console (05-login.js)
  const e = await p.evaluate(() => ({ nom: document.querySelector('label[for="id"]').textContent, visibles: ["host", "key", "id"].map((i) => !!document.getElementById(i).offsetParent),
    num: document.getElementById("id").getAttribute("inputmode") }));
  assert.equal(e.nom, "ID du poste", "le champ a un vrai <label>");
  assert.deepEqual(e.visibles, [false, false, true], "l'hote et la cle viennent du deploiement : seul l'ID se remplit");
  assert.equal(e.num, "numeric", "clavier numerique conserve");
  await p.evaluate(() => { window.__go = 0; window.connect = function () { window.__go++; }; });
  await p.waitForTimeout(450);                                   // laisse protegerConnect (300 ms) re-envelopper : il appelle encore notre sonde
  await p.fill("#id", "123456789");
  await p.press("#id", "Enter");
  assert.equal(await p.evaluate(() => window.__go), 1, "Entree dans Id lance la connexion, UNE fois (la page et la console ne l'ecoutent pas toutes les deux)");
  await p.press("#id", "Shift+Enter"); await p.press("#id", "Control+Enter");
  assert.equal(await p.evaluate(() => window.__go), 1, "Maj/Ctrl+Entree ne declenchent rien : le raccourci reste a l'utilisateur");
  await p.click("#connect td > button");
  assert.equal(await p.evaluate(() => window.__go), 2, "le bouton marche toujours comme avant");
});

await test("login-focus-follows-pointer-type : le curseur arrive dans Id a la souris", async (p) => {
  await formulaire(p);
  assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.id), "id", "pointeur precis : Id est actif");
});
await test("login-no-forced-keyboard-on-touch : sur tactile, le clavier a l'ecran n'est pas force", async (p) => {
  await formulaire(p);
  assert.equal(await p.evaluate(() => document.activeElement === document.body), true, "aucun champ actif d'office");
}, { contexte: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });

await test("login-contrast-and-states : texte >= 4,5:1, bordures >= 3:1, anneau de focus visible, cartes d'attente et de mot de passe", async (p) => {
  await formulaire(p);
  const m = await p.evaluate(`(() => { const M = ${MESURE}, q = (s) => document.querySelector(s);
    const texte = (nom, fg, bg, seuil, pseudo) => { const f = M.fond(bg), c = getComputedStyle(fg, pseudo || null).color; return { nom, seuil, r: M.rapport(M.rgb(c, f), M.rgb(f, "#000")) }; };
    const bord = (nom, el, bg) => { const f = M.fond(bg); return { nom, seuil: 3, r: M.rapport(M.rgb(getComputedStyle(el).borderTopColor, f), M.rgb(f, "#000")) }; };
    return [ texte("titre de la carte", q("#rd-entete h1"), q("#connect"), 4.5), texte("sous-titre", q("#rd-entete p"), q("#connect"), 4.5),
             texte("etiquette de champ", q("#connect td > label"), q("#connect"), 4.5),
             texte("ID saisi", q("#id"), q("#id"), 4.5), texte("bouton Connexion", q("#connect td > button"), q("#connect td > button"), 4.5),
             texte("memorisation", q("#rd-memo"), q("#connect"), 4.5), texte("serveur", q("#rd-serveur"), q("#connect"), 4.5), texte("langue", q("#rd-langue"), q("#rd-langue"), 4.5),
             bord("bord du champ Id", q("#id"), q("#connect")), bord("bord du choix de langue", q("#rd-langue"), q("#connect")) ]; })()`);
  const mauvais = m.filter((x) => !(x.r >= x.seuil));
  assert.deepEqual(mauvais.map((x) => `${x.nom} : ${x.r.toFixed(2)}:1 < ${x.seuil}`), [], "pire : " + m.slice().sort((a, b) => a.r / a.seuil - b.r / b.seuil).slice(0, 3).map((x) => `${x.nom} ${x.r.toFixed(2)}:1`).join(", "));
  await p.focus("#id");
  const ombre = await p.evaluate(() => getComputedStyle(document.getElementById("id")).boxShadow);
  assert.notEqual(ombre, "none", "anneau de focus sur Id");
  const autres = await p.evaluate(() => { const o = {}; for (const id of ["password", "status"]) { const e = document.getElementById(id); e.style.display = "block";
      o[id] = { avant: getComputedStyle(e, "::before").content, rayon: getComputedStyle(e).borderTopLeftRadius, largeur: Math.round(e.getBoundingClientRect().width) }; }
    o.titreMdp = document.getElementById("rd-mdp-titre").textContent; o.titres = [getComputedStyle(document.getElementById("connect"), "::before").content, document.querySelectorAll("#connect h1").length]; return o; });
  // Un seul titre par carte : celui que la page ecrit (traduit), plus aucun titre en CSS — sauf l'ecran d'attente, qui n'en a pas d'autre.
  assert.deepEqual(autres.titres, ["none", 1], "carte de connexion : le titre de la page, pas de doublon en CSS");
  assert.equal(autres.password.avant, "none"); assert.equal(autres.titreMdp, "Mot de passe du poste distant");
  assert.equal(autres.status.avant, '"Connexion en cours"');
  for (const k of ["password", "status"]) { assert.notEqual(autres[k].rayon, "0px", k + " : carte arrondie"); assert.ok(autres[k].largeur <= 432, k + " : largeur " + autres[k].largeur); }
});

await test("login-recents-still-under-id : la carte garde les pastilles de dernieres connexions entre Id et Connect", async (p) => {
  await p.goto(URL_PAGE); await p.waitForSelector("#rd-recents .rdchip-id", { timeout: 15000 });
  const e = await p.evaluate(() => { const zone = document.getElementById("rd-recents"), r = (x) => x.getBoundingClientRect(),
      id = document.getElementById("id"), go = document.querySelector("#connect td > button");
    return { ordre: r(id).bottom <= r(zone).top + 1 && r(zone).bottom <= r(go).top + 1, dans: r(zone).right <= r(document.getElementById("connect")).right && r(zone).left >= r(document.getElementById("connect")).left,
             libelles: [...zone.querySelectorAll(".rdchip-id")].map((c) => c.textContent) }; });
  assert.ok(e.ordre, "les pastilles restent sous Id et au-dessus de Connect");
  assert.ok(e.dans, "et dans la carte");
  assert.deepEqual(e.libelles, ["222 222 222", "333 333 333", "111 111 111"], "tri par recence conserve");
}, { init: { peers: JSON.stringify({ "111111111": { tm: 100, password: "secret1" }, "222222222": { tm: 300 }, "333333333": { tm: 200 } }) } });

// ============================================================ fonctions de session
enTete("Poste distant — actions, ecrans, options, liaison");
const toucheDe = (p, nom) => p.evaluate((n) => window.__touches.filter(([x]) => x === n).map(([, v]) => v), nom);
const ouvrirBarre = async (p) => { await p.click(".rdhandle"); await p.waitForSelector("#rdbar .rdtool", { timeout: 8000 }); };
const ouvrirPop = async (p, id) => { await p.click(`#rdbar [data-rd="${id}"]`); await p.waitForSelector(`#rdpop-${id}:popover-open`, { timeout: 4000 }); };
const prete = async (p, opts) => { await sessionSimulee(p, opts); await montee(p); await ouvrirBarre(p); };
const pairInfo = (p, ecrans, courant = 0) => p.evaluate(([e, c]) => window.onGlobalEvent(JSON.stringify({ name: "peer_info", displays: JSON.stringify(e), current_display: String(c) })), [ecrans, courant]);

await test("poste-actions : Ctrl+Alt+Suppr et verrouillage partent par le pont du bundle ; le redemarrage exige deux clics", async (p) => {
  await prete(p, { platform: "Windows" }); await ouvrirPop(p, "poste");
  await p.click('#rdpop-poste [data-action="cad"]');
  assert.deepEqual(await toucheDe(p, "ctrl_alt_del"), [""], "message ctrl_alt_del");
  await p.click('#rdpop-poste [data-action="verrou"]');
  assert.deepEqual(await toucheDe(p, "lock_screen"), [""]);
  const restart = () => p.evaluate(() => window.__envoyes.filter((m) => m.misc && m.misc.restart_remote_device === true).length);
  await p.click('#rdpop-poste [data-action="redemarrer"]');
  assert.equal(await restart(), 0, "un seul clic ne redemarre RIEN");
  assert.match(await p.textContent('#rdpop-poste [data-action="redemarrer"]'), /Confirmer le redémarrage/);
  await p.click('#rdpop-poste [data-action="redemarrer"]');
  assert.equal(await restart(), 1, "le second clic envoie restart_remote_device");
  await p.waitForFunction(() => !document.getElementById("rdpop-poste").matches(":popover-open"), null, { timeout: 3000 });
});

await test("poste-gating : une fonction impossible sur ce poste est grisee avec sa raison, jamais cachee", async (p) => {
  await prete(p, { platform: "Mac OS" }); await ouvrirPop(p, "poste");
  const e = await p.evaluate(() => ({ cad: document.querySelector('#rdpop-poste [data-action="cad"]').disabled,
    cadRaison: document.querySelector('#rdpop-poste [data-action="cad"]').title,
    priv: document.querySelector('#rdpop-poste .rdsw[data-pour="privacy-mode"]').disabled,
    privRaison: document.querySelector('#rdpop-poste [data-indisponible] .rdaide').textContent,
    verrou: document.querySelector('#rdpop-poste [data-action="verrou"]').disabled }));
  assert.equal(e.cad, true); assert.match(e.cadRaison, /Windows, Linux/);
  assert.equal(e.priv, true); assert.match(e.privRaison, /Windows seulement/);
  assert.equal(e.verrou, false, "verrouiller reste disponible");
});

await test("poste-options : confidentialite, blocage (deux ordres), presse-papier, curseur — l'etat relu a la source", async (p) => {
  await prete(p, { platform: "Windows" }); await ouvrirPop(p, "poste");
  const sw = (n) => `#rdpop-poste .rdsw[data-pour="${n}"]`;
  await p.click(sw("privacy-mode"));
  assert.deepEqual(await toucheDe(p, "toggle_option"), ["privacy-mode"]);
  assert.equal(await p.isChecked(sw("privacy-mode")), true, "l'interrupteur suit l'etat du pair");
  // Blocage de saisie : l'interrupteur ne se coche que lorsque le POSTE a confirme (BackNotification, lue par la page).
  const retourPair = (etat) => p.evaluate((n) => window.__rdPairFiltrer(window.curConn, { misc: { back_notification: { block_input_state: n } } }), etat);
  await p.click(sw("block-input"));
  assert.equal(await p.isChecked(sw("block-input")), false, "ordre envoye, pas encore confirme : l'interrupteur ne ment pas");
  await retourPair(2);                                           // « saisie bloquee »
  await p.waitForFunction((s) => document.querySelector(s).checked === true, sw("block-input"), { timeout: 3000 });
  await p.click(sw("block-input")); await retourPair(4);         // « saisie debloquee »
  await p.waitForFunction((s) => document.querySelector(s).checked === false, sw("block-input"), { timeout: 3000 });
  assert.deepEqual((await toucheDe(p, "toggle_option")).slice(1), ["block-input", "unblock-input"], "bloquer puis debloquer : deux ordres distincts");
  assert.equal(await p.isChecked(sw("disable-clipboard")), true, "presse-papier partage : actif tant qu'il n'est pas desactive");
  await p.click(sw("disable-clipboard"));
  assert.equal(await p.isChecked(sw("disable-clipboard")), false);
  await p.click(sw("show-remote-cursor")); await p.click(sw("lock-after-session-end"));
  assert.deepEqual((await toucheDe(p, "toggle_option")).slice(-2), ["show-remote-cursor", "lock-after-session-end"]);
});

await test("poste-ecrans : la liste des moniteurs apparait quand il y en a plusieurs, et suit l'ecran courant", async (p) => {
  await prete(p, { platform: "Windows" });
  await pairInfo(p, [{ width: 1920, height: 1080, name: "Principal" }]);
  await ouvrirPop(p, "poste");
  assert.equal(await p.locator("#rdpop-poste .rdecran").count(), 0, "un seul ecran : pas de choix");
  await pairInfo(p, [{ width: 1920, height: 1080, name: "Principal" }, { width: 1280, height: 720 }], 0);
  await p.waitForSelector("#rdpop-poste .rdecran");
  assert.equal(await p.locator("#rdpop-poste .rdecran").count(), 2);
  assert.match(await p.textContent('#rdpop-poste [data-ecran="0"]'), /Écran 1 — Principal.*1920×1080/);
  assert.equal(await p.getAttribute('#rdpop-poste [data-ecran="0"]', "aria-checked"), "true");
  await p.click('#rdpop-poste [data-ecran="1"]');
  assert.deepEqual(await toucheDe(p, "switch_display"), [1], "switch_display avec l'indice de l'ecran");
  await p.evaluate(() => window.onGlobalEvent(JSON.stringify({ name: "switch_display", display: "1" })));
  await p.waitForFunction(() => document.querySelector('#rdpop-poste [data-ecran="1"]').getAttribute("aria-checked") === "true", null, { timeout: 3000 });
});

await test("audio-son : « Son du poste » pilote disable-audio et suit son etat", async (p) => {
  await sessionSimulee(p); await montee(p); await ouvrirTiroir(p);
  const sw = '#rddrawer .rdsw[data-pour="son"]';
  assert.equal(await p.isChecked(sw), true);
  await p.click(sw);
  assert.deepEqual(await toucheDe(p, "toggle_option"), ["disable-audio"]);
  assert.equal(await p.isChecked(sw), false, "le son est coupe");
});

await test("statut-liaison : « Relais » toujours, « Chiffre » seulement quand connection_ready le dit", async (p) => {
  await sessionSimulee(p); await montee(p);
  await p.waitForSelector("#rdstatut .rdtag-relais");
  const tags = () => p.evaluate(() => [...document.querySelectorAll("#rdstatut .rdtag")].map((t) => t.textContent));
  assert.deepEqual(await tags(), ["Relais"], "avant connection_ready : pas de mention de chiffrement");
  await p.evaluate(() => window.onGlobalEvent(JSON.stringify({ name: "connection_ready", secure: "true", direct: "false" })));
  await p.waitForFunction(() => document.querySelectorAll("#rdstatut .rdtag").length === 2);
  assert.deepEqual(await tags(), ["Relais", "Chiffré"]);
  await p.evaluate(() => window.onGlobalEvent(JSON.stringify({ name: "connection_ready", secure: "false", direct: "false" })));
  await p.waitForFunction(() => /Non chiffré/.test(document.querySelector("#rdstatut .rdtags").textContent));
  assert.equal(await p.evaluate(() => !!document.querySelector("#rdstatut .rdtag-alerte")), true, "un echange non chiffre est signale en alerte");
});

await test("plein-ecran : le bouton bascule le plein ecran, masque tiroir et statut (epure) et remet tout a la sortie", async (p) => {
  await prete(p);
  await p.click('#rdbar [data-rd="plein"]');
  await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 });
  await p.waitForFunction(() => document.body.classList.contains("rd-plein"), null, { timeout: 3000 });
  const e = await p.evaluate(() => ({ statut: document.getElementById("rdstatut").hidden, pressed: document.querySelector('[data-rd="plein"]').getAttribute("aria-pressed"),
                                       libelle: document.querySelector('[data-rd="plein"]').title }));
  assert.equal(e.statut, true, "plein ecran epure : pas de barre de statut"); assert.equal(e.pressed, "true"); assert.match(e.libelle, /Quitter le plein écran/);
  await p.evaluate(() => document.exitFullscreen());
  await p.waitForFunction(() => !document.fullscreenElement && !document.body.classList.contains("rd-plein"), null, { timeout: 3000 });
  assert.equal(await p.evaluate(() => document.getElementById("rdstatut").hidden), false, "la barre de statut revient");
});

await test("vue-pixel : « 1:1 » affiche un pixel distant par pixel d'ecran, avec defilement", async (p) => {
  await sessionSimulee(p); await montee(p); await grandEcran(p); await ouvrirTiroir(p);
  const mesure = () => p.evaluate(() => { const c = window.__rdActive(), z = document.getElementById("canvas"), r = c.getBoundingClientRect();
    return { w: Math.round(r.width), dpr: window.devicePixelRatio, defile: z.scrollWidth > z.clientWidth + 1, vue: document.body.getAttribute("data-rd-vue") }; });
  const a = await mesure(); assert.equal(a.vue, "ajuste"); assert.equal(a.defile, false);
  await p.click('.rdsegmented:has([data-valeur="pixel"]) [data-valeur="pixel"]');
  await p.waitForFunction(() => document.body.getAttribute("data-rd-vue") === "pixel");
  const b = await mesure();
  assert.equal(b.w, Math.round(1920 / b.dpr), "largeur = pixels distants / ratio de l'ecran"); assert.equal(b.defile, true, "l'image deborde : la zone defile");
  await p.click('.rdsegmented:has([data-valeur="pixel"]) [data-valeur="ajuste"]');
  await p.waitForFunction(() => document.body.getAttribute("data-rd-vue") === "ajuste");
  assert.ok((await mesure()).w < 1920, "retour a l'image ajustee");
});

enTete("Entrees — souris, molette, clavier");
const molette = async (p, dx, dy) => { await p.mouse.move(600, 400); await p.mouse.wheel(dx, dy); await p.waitForTimeout(80); };
const dernierMouse = (p) => p.evaluate(() => window.__mouse[window.__mouse.length - 1]);

await test("entree-defauts : avec les reglages par defaut, les messages de souris partent exactement comme avant", async (p) => {
  await sessionSimulee(p); await montee(p); await grandEcran(p);
  await p.mouse.move(600, 400); await p.mouse.down(); await p.mouse.up(); await molette(p, 0, 100);
  const m = await p.evaluate(() => window.__mouse.map((x) => x.slice(0, 3)));
  assert.deepEqual(m.filter((x) => x[0] !== 0), [[9, 600, 400 - 0].slice(0, 1).concat([m.find((x) => x[0] === 9)[1], m.find((x) => x[0] === 9)[2]]), [10, m.find((x) => x[0] === 10)[1], m.find((x) => x[0] === 10)[2]], [3, 0, -1]],
    "clic gauche (9), relache (10), un cran de molette vers le bas (3, 0, -1) : " + JSON.stringify(m));
});

await test("entree-molette : vitesse et sens de defilement", async (p) => {
  await sessionSimulee(p); await montee(p); await grandEcran(p); await ouvrirTiroir(p);
  await p.locator('#rddrawer .rdslider[data-pour="taux"]').fill("4");
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("rd-console")).taux), 4, "le reglage est memorise");
  await molette(p, 0, 100);
  assert.deepEqual((await dernierMouse(p)).slice(0, 3), [3, 0, -4], "vitesse x4, sens standard");
  await p.selectOption('#rddrawer select[data-pour="sens"]', "vertical");
  await molette(p, 0, 100);
  assert.deepEqual((await dernierMouse(p)).slice(0, 3), [3, 0, 4], "vertical inverse");
  await p.selectOption('#rddrawer select[data-pour="sens"]', "les-deux");
  await molette(p, 100, 0);
  assert.deepEqual((await dernierMouse(p)).slice(0, 3), [3, 4, 0], "horizontal inverse aussi (x = -(-1) * 4)");
  await p.selectOption('#rddrawer select[data-pour="sens"]', "standard"); await p.locator('#rddrawer .rdslider[data-pour="taux"]').fill("1");
  await molette(p, 0, -100);
  assert.deepEqual((await dernierMouse(p)).slice(0, 3), [3, 0, 1], "retour aux reglages par defaut");
});

await test("entree-bouton-principal : « Droit » echange gauche et droit ; les autres boutons ne bougent pas", async (p) => {
  await sessionSimulee(p); await montee(p); await grandEcran(p); await ouvrirTiroir(p);
  await p.click('.rdsegmented:has([data-valeur="droit"]) [data-valeur="droit"]');
  await p.mouse.move(600, 400); await p.mouse.down(); await p.mouse.up();
  const l = await p.evaluate(() => window.__mouse.map((x) => x[0]).filter((m) => m !== 0));
  assert.deepEqual(l, [17, 18], "clic gauche physique -> bouton droit distant (1|2<<3, 2|2<<3)");
  await p.mouse.down({ button: "right" }); await p.mouse.up({ button: "right" });
  assert.deepEqual((await p.evaluate(() => window.__mouse.map((x) => x[0]).filter((m) => m !== 0))).slice(2), [9, 10], "clic droit physique -> gauche distant");
  await p.mouse.down({ button: "middle" }); await p.mouse.up({ button: "middle" });
  assert.deepEqual((await p.evaluate(() => window.__mouse.map((x) => x[0]).filter((m) => m !== 0))).slice(4), [33, 34], "le milieu ne bouge pas (1|4<<3)");
});

await test("entree-retour-avance : les boutons 4 et 5 partent comme Retour / Avance, plus comme un clic gauche", async (p) => {
  await sessionSimulee(p); await montee(p); await grandEcran(p);
  await p.evaluate(() => { const c = window.__rdActive(); for (const [t, b] of [["mousedown", 3], ["mouseup", 3], ["mousedown", 4], ["mouseup", 4]]) c.dispatchEvent(new MouseEvent(t, { button: b, bubbles: true, cancelable: true })); });
  assert.deepEqual(await p.evaluate(() => window.__mouse.map((x) => x[0])), [65, 66, 129, 130], "Retour = 1|8<<3, Avance = 1|16<<3 (et leurs relachements)");
  assert.equal(await p.evaluate(() => window.__touches.filter(([n, v]) => n === "send_mouse" && /"left"/.test(v)).length), 0, "aucun clic gauche parasite");
});

await test("entree-souris-relative : mouvements relatifs (type 5) avec sensibilite, sans mouvement absolu, et grisee sur un vieux pair", async (p) => {
  await sessionSimulee(p, { version: "1.4.9", platform: "Windows" }); await montee(p); await grandEcran(p); await ouvrirTiroir(p);
  await p.evaluate(() => { const c = window.__rdActive(); c.requestPointerLock = () => { Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => c }); }; });
  await p.click('.rdsegmented:has([data-valeur="relatif"]) [data-valeur="relatif"]');
  await p.locator('#rddrawer .rdslider[data-pour="sensib"]').fill("20");
  await p.mouse.move(600, 400); await p.mouse.down(); await p.mouse.up();
  assert.equal(await p.evaluate(() => !!document.pointerLockElement), true, "un clic dans l'image capture la souris");
  await p.evaluate(() => { window.__mouse.length = 0; window.__touches.length = 0; const c = window.__rdActive();
    c.dispatchEvent(new MouseEvent("mousemove", { movementX: 7, movementY: -3, bubbles: true, cancelable: true })); });
  assert.deepEqual((await dernierMouse(p)).slice(0, 3), [5, 14, -6], "type 5, deplacement x sensibilite 2,0");
  assert.equal(await p.evaluate(() => window.__touches.filter(([n]) => n === "send_mouse").length), 0, "le gabarit n'envoie AUCUN mouvement absolu (il couperait le mode relatif)");
  await p.evaluate(() => { window.__mouse.length = 0; window.__rdActive().dispatchEvent(new MouseEvent("mousemove", { movementX: 0, movementY: 0, bubbles: true })); });
  assert.equal(await p.evaluate(() => window.__mouse.length), 0, "pas de message vide");
});
await test("entree-souris-relative-version : sur un pair < 1.4.5 le choix « Relatif » est grise avec sa raison", async (p) => {
  await sessionSimulee(p, { version: "1.4.2", platform: "Windows" }); await montee(p); await ouvrirTiroir(p);
  const e = await p.evaluate(() => { const l = [...document.querySelectorAll("#rddrawer .rdrow")].find((r) => r.querySelector('[data-valeur="relatif"]'));
    return { off: [...l.querySelectorAll("button")].every((b) => b.disabled), raison: l.querySelector(".rdaide").textContent, indispo: l.hasAttribute("data-indisponible") }; });
  assert.equal(e.off, true); assert.match(e.raison, /RustDesk 1\.4\.5/); assert.equal(e.indispo, true);
});

await test("entree-anti-veille : un battement d'un pixel apres 45 s d'inactivite, jamais avant, jamais s'il est desactive", async (p) => {
  await sessionSimulee(p, { version: "1.4.9", platform: "Windows" }); await montee(p); await ouvrirTiroir(p);
  const battre = () => p.evaluate(() => { window.RDConsole.entree.jiggle(); return window.__mouse.length; });
  await p.evaluate(() => window.RDConsole.entree._inactiver(60000));
  assert.equal(await battre(), 0, "desactive par defaut : rien");
  await p.click('#rddrawer .rdsw[data-pour="jiggle"]');
  await p.evaluate(() => window.RDConsole.entree._inactiver(10000));
  assert.equal(await battre(), 0, "actif mais l'utilisateur vient de bouger : rien");
  await p.evaluate(() => window.RDConsole.entree._inactiver(60000));
  assert.equal(await battre(), 1); assert.deepEqual((await dernierMouse(p)).slice(0, 3), [5, -1, 0], "pair recent : mouvement RELATIF invisible (type 5, un pixel)");
  await p.evaluate(() => window.RDConsole.entree._inactiver(60000));
  await battre(); assert.equal((await dernierMouse(p))[1], 1, "le battement alterne (-1 puis +1) : pas de derive");
});
await test("entree-anti-veille-ancien-pair : sur un pair < 1.4.5, un mouvement absolu d'un pixel", async (p) => {
  await sessionSimulee(p, { version: "1.4.2" }); await montee(p); await ouvrirTiroir(p);
  await p.click('#rddrawer .rdsw[data-pour="jiggle"]'); await p.evaluate(() => window.RDConsole.entree._inactiver(60000));
  await p.evaluate(() => window.RDConsole.entree.jiggle());
  assert.equal((await dernierMouse(p))[0], 0, "type 0 : mouvement absolu");
});

await test("entree-touches-physiques : Impr. ecran, Menu, Pause… partent au poste (le gabarit les ignorait)", async (p) => {
  await sessionSimulee(p); await montee(p); await grandEcran(p);
  const msg = () => p.evaluate(() => window.__touches.filter(([n]) => n === "input_key").map(([, v]) => JSON.parse(v)).map((m) => m.name + ":" + m.down + ":" + m.press));
  await p.evaluate(() => { const c = window.__rdActive(); c.focus();
    c.dispatchEvent(new KeyboardEvent("keydown", { code: "ContextMenu", key: "ContextMenu", bubbles: true, cancelable: true }));
    c.dispatchEvent(new KeyboardEvent("keyup", { code: "ContextMenu", key: "ContextMenu", bubbles: true, cancelable: true }));
    c.dispatchEvent(new KeyboardEvent("keyup", { code: "PrintScreen", key: "PrintScreen", bubbles: true, cancelable: true })); });   // sous Windows seul keyup arrive
  assert.deepEqual(await msg(), ["Apps:true:false", "Apps:false:false", "Snapshot:false:true"]);
});

enTete("Clavier virtuel, Toolbox, statistiques, aide");
await test("clavier-virtuel : texte, combinaisons avec modificateurs collants, touches nommees, sans voler le focus ; image calee au-dessus", async (p) => {
  await prete(p); await grandEcran(p);
  await p.evaluate(() => window.__rdActive().focus());
  const bas = () => p.evaluate(() => Math.round(document.getElementById("canvas").getBoundingClientRect().bottom));
  const avant = await bas();
  await p.click('#rdbar [data-rd="clavierv"]');
  await p.waitForFunction(() => !document.getElementById("rdvkb").hidden);
  const haut = await p.evaluate(() => Math.round(document.getElementById("rdvkb").getBoundingClientRect().height));
  await p.waitForFunction((a) => Math.round(document.getElementById("canvas").getBoundingClientRect().bottom) < a - 100, avant, { timeout: 3000 });
  assert.ok(Math.abs((avant - (await bas())) - haut) <= 2, `l'image cede exactement la hauteur du clavier (${haut} px)`);
  const key = (v) => p.click(`#rdvkb [data-valeur="${v}"]`);
  const dernier = (n) => p.evaluate((nom) => window.__touches.filter(([x]) => x === nom).map(([, v]) => v).pop(), n);
  await key("a"); assert.equal(await dernier("input_string"), "a", "un caractere seul part comme du texte");
  await key("shift"); await key("a"); assert.equal(await dernier("input_string"), "A", "Maj arme la majuscule…");
  await key("a"); assert.equal(await dernier("input_string"), "a", "…pour UNE touche : le modificateur se relache");
  await key("ctrl"); assert.equal(await p.getAttribute('#rdvkb [data-valeur="ctrl"]', "aria-pressed"), "true"); await key("c");
  const cc = JSON.parse(await dernier("input_key"));
  assert.deepEqual([cc.name, cc.ctrl, cc.alt, cc.shift, cc.command, cc.press], ["c", "true", "false", "false", "false", "true"], "Ctrl+C : touche en minuscule + drapeau");
  assert.equal(await p.getAttribute('#rdvkb [data-valeur="ctrl"]', "aria-pressed"), "false", "Ctrl relache apres la touche");
  await key("Escape"); assert.equal(JSON.parse(await dernier("input_key")).name, "Escape");
  await key("alt"); await key("command"); await key("Tab"); const at = JSON.parse(await dernier("input_key"));
  assert.deepEqual([at.name, at.alt, at.command], ["Tab", "true", "true"], "plusieurs modificateurs armes ensemble");
  assert.equal(await p.evaluate(() => document.activeElement === window.__rdActive()), true, "le clavier virtuel ne prend pas le focus");
  assert.equal(await p.getAttribute("#rdvkb", "data-disposition"), "azerty", "locale francaise : AZERTY");
  await p.click('#rdbar [data-rd="clavierv"]');
  await p.waitForFunction(() => document.getElementById("rdvkb").hidden); await p.waitForFunction((a) => Math.round(document.getElementById("canvas").getBoundingClientRect().bottom) === a, avant, { timeout: 3000 });
});
await test("clavier-virtuel-qwerty : locale anglaise : QWERTY", async (p) => {
  await sessionSimulee(p); await montee(p); await p.evaluate(() => window.RDConsole.vkb.basculer(true));
  assert.equal(await p.getAttribute("#rdvkb", "data-disposition"), "qwerty");
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#rdvkb .rdkb-rang")[2].querySelectorAll("button")].slice(1, 6).map((b) => b.textContent)), ["q", "w", "e", "r", "t"]);
}, { contexte: { locale: "en-US" } });

await test("toolbox-presse-papier : « Copier » depose le texte dans le presse-papier du poste, « Taper » l'ecrit touche par touche", async (p) => {
  await prete(p); await ouvrirPop(p, "toolbox");
  await p.click('#rdpop-toolbox [data-action="copier"]');
  assert.equal(await p.evaluate(() => window.__envoyes.filter((m) => m.clipboard).length), 0, "rien a envoyer : rien ne part");
  await p.fill("#rdtb-texte", "bonjour é");
  await p.click('#rdpop-toolbox [data-action="copier"]');
  assert.equal(await p.evaluate(() => new TextDecoder().decode(window.__envoyes.find((m) => m.clipboard).clipboard.content)), "bonjour é");
  await p.click('#rdpop-toolbox [data-action="taper"]');
  assert.deepEqual(await toucheDe(p, "input_string"), ["bonjour é"]);
});

await test("toolbox-raccourcis : ceux du systeme du poste, les vôtres (memorises, valides, sans doublon, retirables)", async (p) => {
  await prete(p, { platform: "Windows" }); await ouvrirPop(p, "toolbox");
  assert.equal(await p.locator('#rdpop-toolbox [data-rac="cad"]').count(), 1, "Windows : Ctrl+Alt+Suppr propose");
  await p.click('#rdpop-toolbox [data-rac="alttab"]');
  const m = JSON.parse((await toucheDe(p, "input_key")).pop());
  assert.deepEqual([m.name, m.alt, m.ctrl, m.press, m.down], ["Tab", "true", "false", "true", "false"], "Alt+Tab : une pression avec le drapeau Alt");
  await p.click('#rdpop-toolbox [data-rac="cad"]'); assert.deepEqual(await toucheDe(p, "ctrl_alt_del"), [""], "Ctrl+Alt+Suppr passe par son message dedie");
  const ajouter = async (t) => { await p.fill("#rdpop-toolbox .rdchamp", t); await p.click('#rdpop-toolbox [data-action="rac-ajouter"]'); };
  await ajouter("ctrl+"); assert.match(await p.textContent("#rdpop-toolbox .rdrac-erreur"), /illisible/);
  await ajouter("ctrl+alt+t"); await p.waitForSelector('#rdpop-toolbox [data-perso="0"]');
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("rd-raccourcis"))), ["ctrl+alt+t"]);
  await ajouter("CTRL+ALT+T"); assert.match(await p.textContent("#rdpop-toolbox .rdrac-erreur"), /existe déjà/);
  await p.click('#rdpop-toolbox [data-perso="0"]');
  const t = JSON.parse((await toucheDe(p, "input_key")).pop()); assert.deepEqual([t.name, t.ctrl, t.alt], ["t", "true", "true"]);
  await p.click('#rdpop-toolbox [aria-label^="Retirer"]');
  assert.equal(await p.locator("#rdpop-toolbox [data-perso]").count(), 0); assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("rd-raccourcis"))), []);
});
await test("toolbox-raccourcis-macos : sur un Mac distant, Spotlight et Cmd+Tab, pas Ctrl+Alt+Suppr", async (p) => {
  await prete(p, { platform: "Mac OS" }); await ouvrirPop(p, "toolbox");
  assert.equal(await p.locator('#rdpop-toolbox [data-rac="cad"]').count(), 0); await p.click('#rdpop-toolbox [data-rac="spotlight"]');
  const m = JSON.parse((await toucheDe(p, "input_key")).pop()); assert.deepEqual([m.name, m.command, m.ctrl], ["Space", "true", "false"], "Cmd+Espace : le drapeau Cmd, pas Ctrl");
});
await test("toolbox-raccourcis-corrompus : un stockage illisible ou hostile est ecarte, jamais recopie", async (p) => {
  await prete(p); await ouvrirPop(p, "toolbox");
  assert.equal(await p.locator("#rdpop-toolbox [data-perso]").count(), 1, "seul le raccourci valide survit : " + await p.evaluate(() => localStorage.getItem("rd-raccourcis")));
}, { init: { "rd-raccourcis": JSON.stringify(["<img src=x onerror=alert(1)>", 42, "ctrl+k", "a+b", { x: 1 }, "x".repeat(60)]) } });

await test("toolbox-capture : la capture d'ecran et l'enregistrement produisent de vrais fichiers PNG et WebM", async (p) => {
  await prete(p); await grandEcran(p);
  // Chemin logiciel : #player est un canvas WebGL (pas de contexte 2D a peindre) ; la capture reste un PNG valide, mais peut etre vide.
  await p.evaluate(() => { const c = window.__rdActive(), x = c.getContext("2d"); if (x) { x.fillStyle = "#c0392b"; x.fillRect(0, 0, c.width, c.height); } });
  await ouvrirPop(p, "toolbox");
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 8000 }), p.click('#rdpop-toolbox [data-action="capture"]')]);
  assert.match(dl.suggestedFilename(), /^rustdesk-123456789-\d{8}-\d{6}\.png$/);
  const png = fs.readFileSync(await dl.path()); assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "signature PNG"); assert.ok(png.length > 200);
  // Chemin logiciel : #player est un canvas WebGL sans tampon conserve ; son flux d'enregistrement est vide. Limite connue
  // (documentee) du repli logiciel ; le chemin WebCodecs, lui, enregistre. On ne l'exige donc que la ou il s'applique.
  if (await p.evaluate(() => !window.__rdActive().getContext("2d"))) return;
  await p.click('#rdpop-toolbox [data-action="enregistrer"]');
  await p.waitForFunction(() => /Arrêter/.test(document.querySelector('#rdpop-toolbox [data-action="enregistrer"]').textContent));
  await p.evaluate(() => { const c = window.__rdActive(), x = c.getContext("2d"); if (!x) return; let n = 0; const iv = setInterval(() => { x.fillStyle = n++ % 2 ? "#2980b9" : "#27ae60"; x.fillRect(0, 0, c.width, c.height); if (n > 12) clearInterval(iv); }, 120); });
  await p.waitForTimeout(1500);
  const [dl2] = await Promise.all([p.waitForEvent("download", { timeout: 10000 }), p.click('#rdpop-toolbox [data-action="enregistrer"]')]);
  assert.match(dl2.suggestedFilename(), /\.webm$/);
  const webm = fs.readFileSync(await dl2.path()); assert.deepEqual([...webm.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3], "signature EBML (WebM)"); assert.ok(webm.length > 500);
  assert.match(await p.textContent('#rdpop-toolbox [data-action="enregistrer"]'), /Enregistrer la vidéo/, "le bouton revient a son etat");
});

await test("stats : quatre courbes alimentees par les mesures, avec bornes et percentiles", async (p) => {
  await prete(p);
  await p.evaluate(() => { window.RD.stats.delay = [20, 25, 31, 28, 26, 40, 22]; window.RD.stats.decode = [4, 5, 6, 5]; window.RD.stats.bitrate = 4664; });
  await p.waitForTimeout(2200);                                   // quelques echantillons (une mesure toutes les 0,9 s)
  await ouvrirPop(p, "stats");
  await p.waitForFunction(() => document.querySelectorAll("#rdpop-stats .rdstat").length === 4);
  await p.waitForFunction(() => /ms/.test(document.querySelector('#rdpop-stats [data-metrique="rtt"] .rdstat-val').textContent), null, { timeout: 4000 });
  const e = await p.evaluate(() => ({ rtt: document.querySelector('#rdpop-stats [data-metrique="rtt"] .rdstat-val').textContent,
    pied: document.querySelector('#rdpop-stats [data-metrique="rtt"] .rdstat-pied').textContent, debit: document.querySelector('#rdpop-stats [data-metrique="debit"] .rdstat-val').textContent,
    dessin: (() => { const cv = document.querySelector('#rdpop-stats [data-metrique="rtt"] canvas'), d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; })() }));
  assert.match(e.rtt, /^\d+ ms$/); assert.match(e.pied, /min \d+ · moy \d+ · max \d+ {2}\| {2}p50 \d+ · p95 \d+ · p99 \d+/); assert.equal(e.debit, "4664 kbit/s"); assert.equal(e.dessin, true, "la courbe est dessinee");
});

await test("aide : test du relais (verdict), export du journal SANS secret, version et lien vers la source", async (p) => {
  await prete(p, { platform: "Windows", version: "1.4.9" });
  await p.evaluate(() => { window.__rdVerdict = [{ verdict: "ACCEPTEE" }, { verdict: "REFUSEE" }, { verdict: "REFUSEE" }]; window.rdRelayTest = () => Promise.resolve(window.__rdVerdict); console.log("[test] ligne de journal"); console.warn("hbbr refuse la cle : abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP+/= (resume abcdefgh\u2026KLMNOP) password=hunter2"); });
  await ouvrirPop(p, "aide");
  const verdict = async (v) => { await p.evaluate((x) => { window.__rdVerdict = x; }, v); await p.click('#rdpop-aide [data-action="relais"]');
    await p.waitForFunction(() => !document.querySelector('#rdpop-aide .rdaide-resultat').hidden && !document.querySelector('#rdpop-aide [data-action="relais"]').disabled);
    return p.evaluate(() => [document.querySelector("#rdpop-aide .rdaide-resultat").textContent, document.querySelector("#rdpop-aide .rdaide-resultat").dataset.niveau]); };
  assert.deepEqual(await verdict([{ verdict: "ACCEPTEE" }, { verdict: "REFUSEE" }, { verdict: "REFUSEE" }]), ["hbbr accepte la clé de ce navigateur.", "ok"]);
  assert.equal((await verdict([{ verdict: "ACCEPTEE" }, { verdict: "ACCEPTEE" }, { verdict: "ACCEPTEE" }]))[1], "alerte", "relais ouvert : alerte");
  assert.equal((await verdict([{ verdict: "REFUSEE" }, { verdict: "REFUSEE" }, { verdict: "REFUSEE" }]))[1], "erreur", "cle refusee : erreur");
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 8000 }), p.click('#rdpop-aide [data-action="journal"]')]);
  assert.match(dl.suggestedFilename(), /^rustdesk-web-journal-\d{14}\.txt$/);
  const txt = fs.readFileSync(await dl.path(), "utf8");
  assert.match(txt, /=== Journal \(\d+ lignes\) ===/); assert.match(txt, /Poste : Windows RustDesk 1\.4\.9, id 123456789/); assert.match(txt, /\[test\] ligne de journal/); assert.match(txt, /Client web : console 1\.0\.0/);
  for (const secret of ["secret-pair-1", "CLEPUBLIQUESECRETE", "motdepasse-hash", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP+/=", "abcdefgh\u2026KLMNOP", "hunter2"]) assert.ok(!txt.includes(secret), `le journal ne contient jamais « ${secret} »`);
  assert.match(txt, /\[cle masquee\]/); assert.match(txt, /password=\[masque\]/, "un mot de passe ecrit en console est masque");
  const e = await p.evaluate(() => ({ href: document.querySelector("#rdpop-aide .rdapropos a").href, version: document.querySelector("#rdpop-aide .rdapropos dd").textContent }));
  assert.equal(e.href, "https://github.com/elzuzu/rustdesk-web-selfhosted"); assert.match(e.version, /^console 1\.0\.0/);
}, { init: { peers: JSON.stringify({ "123456789": { password: "secret-pair-1", info: { x: 1 } } }), key: "CLEPUBLIQUESECRETE", "rd-prefs": JSON.stringify({ v: 1, quality: "best" }) } });

enTete("Langues");
await test("i18n-anglais : la console suit la langue du navigateur", async (p) => {
  await sessionSimulee(p); await montee(p); await ouvrirTiroir(p); await p.click(".rdhandle");
  const e = await p.evaluate(() => ({ titre: document.querySelector("#rddrawer .rdtete b").textContent,
    sections: [...document.querySelectorAll("#rddrawer summary")].map((x) => x.textContent), lang: document.documentElement.lang,
    boutons: [...document.querySelectorAll("#rdbar .rdtool")].map((b) => b.querySelector(".rdlbl").textContent),
    qualite: [...document.querySelector('#rddrawer [data-rd="qualite"]').options].map((o) => o.textContent), fps: document.querySelector('#rddrawer [data-rd="cadence"]').options[0].textContent }));
  assert.equal(e.titre, "Session settings"); assert.deepEqual(e.sections, ["Video", "Audio", "Keyboard", "Mouse", "Display"]); assert.equal(e.lang, "en");
  assert.deepEqual(e.boutons.sort(), ["Help", "Keyboard", "Machine", "Machines", "Full screen", "Stats", "Toolbox"].sort());
  assert.deepEqual(e.qualite, ["Balanced", "Quality", "Smoothness"]); assert.match(e.fps, /fps max/);
}, { contexte: { locale: "en-US" } });

await test("i18n-choix-memorise : la console suit la langue choisie sur l'ecran de connexion, pas celle du navigateur", async (p) => {
  await sessionSimulee(p); await montee(p); await ouvrirTiroir(p);
  const e = await p.evaluate(() => ({ lang: document.documentElement.lang, titre: document.querySelector("#rddrawer .rdtete b").textContent, quitter: document.querySelector("#rdbar button.quit").textContent,
    options: [...document.querySelector('#rddrawer [data-rd="qualite"]').options].map((o) => o.textContent),
    reglageLangue: !!document.querySelector('#rddrawer .rdsegmented [data-valeur="en"]'), stock: JSON.parse(localStorage.getItem("rd-console") || "{}").langue }));
  assert.equal(e.lang, "fr"); assert.equal(e.titre, "Réglages de session", "la console parle la langue de la page");
  assert.equal(e.quitter, "Quitter", "et la page aussi : une seule langue a l'ecran");
  assert.deepEqual(e.options, ["Équilibré", "Qualité", "Fluidité"]);
  assert.equal(e.reglageLangue, false, "plus de second reglage de langue dans le tiroir : il se choisit sur l'ecran de connexion");
  assert.equal(e.stock, undefined, "la console ne memorise aucune langue a elle");
}, { contexte: { locale: "en-US" }, init: { "rd-prefs": JSON.stringify({ v: 1, lang: "fr" }) } });

await test("console-pilots-page-controls : ecrans, actions et plein ecran de la page ne s'affichent plus ; le bouton de la console passe par celui de la page", async (p) => {
  await prete(p);
  const cache = await p.evaluate(() => ["ecrans-page", "actions-page", "plein-page"].map((n) => getComputedStyle(document.querySelector('#rdbar [data-rd="' + n + '"]')).display));
  assert.deepEqual(cache, ["none", "none", "none"], "une seule presentation par fonction");
  await p.evaluate(() => { window.__clicsPage = 0; document.querySelector('[data-rd="plein-page"]').addEventListener("click", () => { window.__clicsPage++; }); });
  await p.click('#rdbar [data-rd="plein"]');
  await p.waitForFunction(() => !!document.fullscreenElement && document.querySelector('[data-rd="plein-page"]').getAttribute("aria-pressed") === "true", null, { timeout: 5000 });
  assert.equal(await p.evaluate(() => window.__clicsPage), 1, "le plein ecran est demande par la page (capture du clavier, message, recalage : une seule fois)");
  assert.equal(await p.getAttribute('#rdbar [data-rd="plein"]', "aria-pressed"), "true", "le bouton de la console suit");
  await p.click('#rdbar [data-rd="plein"]');
  await p.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 });
});

await test("console-shortcut-translation-row : l'interrupteur pilote la traduction de la page ; grise, avec la raison, entre deux postes de meme famille", async (p, ctx) => {
  await clavierPC(ctx);
  await sessionSimulee(p); await montee(p);
  await p.evaluate(() => window.onGlobalEvent(JSON.stringify({ name: "peer_info" })));        // PC devant un Mac : il y a quelque chose a traduire
  await ouvrirTiroir(p);
  const sw = '#rddrawer .rdsw[data-pour="swap"]';
  assert.equal(await p.isChecked(sw), true); assert.equal(await p.isDisabled(sw), false);
  await p.click(sw);
  assert.equal(await p.evaluate(() => localStorage.getItem("rd-swap-ctrl")), "0", "c'est le reglage de la page qui change");
  assert.equal(await p.evaluate(() => document.querySelector('[data-rd="swap"]').getAttribute("aria-pressed")), "false");
  await p.click(sw);
  // Devant un poste Windows, la page n'a rien a traduire : la ligne reste, grisee, avec la raison.
  // Tiroir OUVERT au moment ou la plateforme du pair arrive : la ligne suit sans qu'on le referme.
  await p.evaluate(() => { window.curConn._peerInfo.platform = "Windows"; window.onGlobalEvent(JSON.stringify({ name: "peer_info" })); });
  await p.waitForFunction((s) => document.querySelector(s).disabled === true, sw, { timeout: 3000 });
  assert.match(await p.evaluate((s) => document.querySelector(s).closest("[data-indisponible]").title, sw), /même famille/);
});

await test("poste-clipboard-sync : « Presse-papier automatique » active la synchronisation de la page, et l'interrupteur suit", async (p) => {
  await prete(p); await ouvrirPop(p, "poste");
  const sw = '#rdpop-poste .rdsw[data-pour="clipboard-sync"]';
  assert.equal(await p.isChecked(sw), false, "jamais actif d'office : le presse-papier local n'est lu que sur accord");
  await p.click(sw);
  await p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem("rd-prefs")).clip === "auto"; } catch (_) { return false; } }, null, { timeout: 5000 });
  await p.waitForFunction((s) => { const x = document.querySelector(s); return !!x && x.checked === true; }, sw, { timeout: 3000 });
});

// ============================================================ liste des postes (flotte)
enTete("Liste des postes — page d'accueil, changement de poste, repli");
const MAINTENANT = Math.floor(Date.now() / 1000);
const LISTE4 = () => [
  { id: "222482174", nom: "Mac mini d'Alex", note: "Bureau — poste principal", etiquettes: ["maison", "mac"], favori: true, derniere_connexion: MAINTENANT - 3 * 3600, en_ligne: true },
  { id: "523470026", nom: "MacBook Pro", note: "", etiquettes: ["mac"], favori: true, derniere_connexion: MAINTENANT - 2 * 86400, en_ligne: false },
  { id: "314159265", nom: "PC portable travail", note: "Windows 11, VPN requis", etiquettes: ["travail"], favori: false, derniere_connexion: MAINTENANT - 600, en_ligne: true },
  { id: "271828182", nom: "", note: "", etiquettes: [], favori: false, derniere_connexion: null, en_ligne: null },
];
// Une fausse API qui respecte le CONTRAT du service : X-RD sur toute ecriture, memes codes, memes champs.
function fausseApi(ctx, depart = [], { statut = 0, ordures = false } = {}) {
  const e = { postes: depart.map((p) => ({ cree: MAINTENANT, favori: false, etiquettes: [], note: "", nom: "", derniere_connexion: null, en_ligne: null, ...p })), req: [] };
  return ctx.route("**/api/**", async (route) => {
    const r = route.request(), u = new URL(r.url()), m = r.method(), corps = r.postData() ? JSON.parse(r.postData()) : null;
    e.req.push({ m, chemin: u.pathname, corps, xrd: r.headers()["x-rd"], ct: r.headers()["content-type"] });
    const j = (o, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(o) });
    if (statut) return route.fulfill({ status: statut, contentType: "text/plain", body: "non" });
    if (ordures) return route.fulfill({ status: 200, contentType: "text/html", body: "<html>pas du json</html>" });
    if (m !== "GET" && r.headers()["x-rd"] !== "1") return j({ erreur: "en_tete_manquant" }, 403);
    if (u.pathname === "/api/health") return j({ ok: true, version: "t", postes: e.postes.length });
    if (u.pathname === "/api/devices" && m === "GET") return j({ postes: e.postes, en_ligne_disponible: e.postes.some((p) => p.en_ligne !== null) });
    if (u.pathname === "/api/devices" && m === "POST") {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{4,31}$/.test(corps.id || "")) return j({ erreur: "id_invalide" }, 400);
      let p = e.postes.find((x) => x.id === corps.id), neuf = !p;
      if (!p) { p = { cree: MAINTENANT, favori: false, etiquettes: [], note: "", nom: "", derniere_connexion: null, en_ligne: null, id: corps.id }; e.postes.push(p); }
      for (const k of ["nom", "note", "etiquettes", "favori"]) if (k in corps) p[k] = corps[k];
      return j(p, neuf ? 201 : 200);
    }
    const mm = u.pathname.match(/^\/api\/devices\/([^/]+)(\/touch)?$/);
    if (mm) {
      const p = e.postes.find((x) => x.id === decodeURIComponent(mm[1]));
      if (!p) return j({ erreur: "inconnu" }, 404);
      if (mm[2] && m === "POST") { p.derniere_connexion = MAINTENANT; return j(p); }
      if (m === "PUT") { for (const k of ["nom", "note", "etiquettes", "favori"]) if (k in corps) p[k] = corps[k]; return j(p); }
      if (m === "DELETE") { e.postes = e.postes.filter((x) => x !== p); return j({ ok: true }); }
    }
    return j({ erreur: "introuvable" }, 404);
  }).then(() => e);
}
const panneau = (p) => p.waitForSelector("#rdflotte:not([hidden]) .rdfl-carte", { timeout: 15000 });
const cartes = (p) => p.evaluate(() => [...document.querySelectorAll("#rdflotte .rdfl-carte")].map((c) => ({ id: c.dataset.id, etat: c.dataset.etat, nom: c.querySelector(".rdfl-nom").textContent,
  fav: c.querySelector(".rdfl-etoile").getAttribute("aria-pressed"), sous: c.querySelector(".rdfl-sous").textContent, tags: [...c.querySelectorAll(".rdfl-tag")].map((x) => x.textContent), note: (c.querySelector(".rdfl-note") || {}).textContent || "" })));

await test("flotte-liste : « Mes postes » — tri (epingles, en ligne, inconnus), etat, temps relatif, etiquettes, note, comptes", async (p, ctx) => {
  await fausseApi(ctx, LISTE4()); await p.goto(URL_PAGE); await panneau(p);
  const c = await cartes(p);
  assert.deepEqual(c.map((x) => x.id), ["222482174", "523470026", "314159265", "271828182"], "epingles d'abord (en ligne avant hors ligne), puis le reste");
  assert.deepEqual(c.map((x) => x.etat), ["en_ligne", "hors_ligne", "en_ligne", "inconnu"]);
  assert.deepEqual(c[0], { id: "222482174", etat: "en_ligne", nom: "Mac mini d'Alex", fav: "true", sous: "222 482 174il y a 3 h", tags: ["maison", "mac"], note: "Bureau — poste principal" });
  assert.equal(c[1].sous, "523 470 026il y a 2 j"); assert.equal(c[3].nom, "271 828 182", "sans nom : l'ID formate est le titre"); assert.equal(c[3].sous, "jamais connecté", "…et n'est pas repete dessous");
  assert.equal(await p.textContent("#rdflotte .rdfl-compte"), "4 postes · 2 en ligne");
  assert.equal(await p.evaluate(() => document.querySelector("#rdflotte+#connect").getBoundingClientRect().top > document.getElementById("rdflotte").getBoundingClientRect().bottom - 1), true, "le formulaire manuel reste dessous");
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#rdflotte+#connect"), "::before").content), '"Connexion manuelle"');
  assert.equal(await p.evaluate(() => document.querySelector('#rdflotte [data-etat="en_ligne"] .rdfl-pastille').getAttribute("aria-label")), "En ligne", "la pastille a un nom, la couleur ne porte pas seule l'information");
});

await test("flotte-etat-inconnu : sans etat en ligne (hbbs injoignable) le compte ne pretend pas « 0 en ligne »", async (p, ctx) => {
  await fausseApi(ctx, LISTE4().map((x) => ({ ...x, en_ligne: null }))); await p.goto(URL_PAGE); await panneau(p);
  assert.equal(await p.textContent("#rdflotte .rdfl-compte"), "4 postes");
});

await test("flotte-absente : service absent, en panne, non authentifie ou illisible — la page est exactement celle d'avant", async (p, ctx) => {
  for (const [nom, opts] of [["502", { statut: 502 }], ["401", { statut: 401 }], ["404", { statut: 404 }], ["html au lieu de JSON", { ordures: true }]]) {
    await ctx.unroute("**/api/**"); await fausseApi(ctx, LISTE4(), opts);
    await p.goto(URL_PAGE); await p.waitForSelector("#rd-recents .rdchip-id", { timeout: 15000 }); await p.waitForTimeout(800);
    const e = await p.evaluate(() => ({ panneau: !!document.getElementById("rdflotte"), dispo: window.RDConsole.flotteUi.etat().dispo,
      formulaire: getComputedStyle(document.getElementById("connect")).display !== "none", puces: document.querySelectorAll("#rd-recents .rdchip-id").length,
      titre: getComputedStyle(document.getElementById("connect"), "::before").content, entete: !!document.getElementById("rd-entete").offsetParent }));
    assert.deepEqual([e.panneau, e.dispo, e.formulaire, e.puces, e.titre, e.entete], [false, false, true, 3, "none", true], nom);
  }
  await ctx.unroute("**/api/**"); await ctx.route("**/api/**", (r) => r.abort()); await p.goto(URL_PAGE); await p.waitForTimeout(1200);
  assert.equal(await p.evaluate(() => !!document.getElementById("rdflotte")), false, "reseau coupe : pas de panneau, pas d'erreur visible");
}, { init: { peers: JSON.stringify({ "111111111": { tm: 100 }, "222222222": { tm: 300 }, "333333333": { tm: 200 } }) } });

await test("flotte-recherche : sans accents ni casse, tous les mots, aucun resultat ; masquee sous quatre postes", async (p, ctx) => {
  const api = await fausseApi(ctx, [...LISTE4(), { id: "999888777", nom: "Éléonore", etiquettes: ["salon"], note: "au deuxième" }]); await p.goto(URL_PAGE); await panneau(p);
  const ids = async (q) => { await p.fill("#rdflotte .rdfl-recherche", q); return (await cartes(p)).map((x) => x.id); };
  assert.deepEqual(await ids("ELEO"), ["999888777"], "casse et accents"); assert.deepEqual(await ids("mac maison"), ["222482174"], "tous les mots");
  assert.deepEqual(await ids("314 159"), ["314159265"], "l'ID, avec ses espaces d'affichage"); assert.deepEqual(await ids("vpn"), ["314159265"], "dans la note");
  assert.equal((await ids("zzz")).length, 0); assert.equal(await p.textContent("#rdflotte .rdfl-vide"), "Aucun poste ne correspond.");
  assert.equal((await ids("")).length, 5, "efface : tout revient");
  api.postes.splice(0, 2); await p.evaluate(() => window.RDConsole.flotteUi.charger());
  await p.waitForFunction(() => document.querySelectorAll("#rdflotte .rdfl-carte").length === 3);
  assert.equal(await p.evaluate(() => document.querySelector("#rdflotte .rdfl-recherche").hidden), true, "trois postes : pas de recherche");
});

await test("flotte-connecter : « Se connecter » remplit l'ID et appuie sur Connect, comme vous le feriez", async (p, ctx) => {
  await fausseApi(ctx, LISTE4()); await p.goto(URL_PAGE); await panneau(p);
  await p.evaluate(() => { window.__go = []; window.connect = function () { window.__go.push(document.getElementById("id").value); }; });
  await p.waitForTimeout(450);
  await p.click('#rdflotte [data-id="314159265"] [data-action="connecter"]');
  assert.deepEqual(await p.evaluate(() => window.__go), ["314159265"], "l'ID brut (sans espaces), une seule connexion");
  assert.match(await p.getAttribute('#rdflotte [data-id="314159265"] [data-action="connecter"]', "aria-label"), /Se connecter à PC portable travail/);
});

await test("flotte-ajouter : validation avant tout envoi, X-RD sur l'ecriture, la liste se rafraichit", async (p, ctx) => {
  const api = await fausseApi(ctx, LISTE4()); await p.goto(URL_PAGE); await panneau(p);
  await p.click('#rdflotte [data-action="ajouter"]'); await p.waitForSelector(".rdfl-dlg[open]");
  assert.equal(await p.evaluate(() => document.querySelector(".rdfl-dlg").matches(":modal")), true, "dialogue modal natif : focus pris, fond inerte");
  assert.equal(await p.evaluate(() => document.activeElement.name), "id", "le focus arrive sur le premier champ");
  const avant = api.req.filter((r) => r.m === "POST").length;
  await p.fill('.rdfl-dlg [name="id"]', "12 34"); await p.click('.rdfl-dlg [type="submit"]');
  assert.match(await p.textContent(".rdfl-err"), /ID invalide/); assert.equal(api.req.filter((r) => r.m === "POST").length, avant, "rien n'est envoye");
  await p.fill('.rdfl-dlg [name="id"]', "987 654 321"); await p.fill('.rdfl-dlg [name="tags"]', "a,b,c,d,e,f,g,h,i"); await p.click('.rdfl-dlg [type="submit"]');
  assert.match(await p.textContent(".rdfl-err"), /Étiquettes : 8 au plus/);
  await p.fill('.rdfl-dlg [name="nom"]', "Salon"); await p.fill('.rdfl-dlg [name="tags"]', "maison, tv ,Maison"); await p.fill('.rdfl-dlg [name="note"]', "sous la télé"); await p.click('.rdfl-dlg [type="submit"]');
  await p.waitForFunction(() => !document.querySelector(".rdfl-dlg"));
  const r = api.req.filter((x) => x.m === "POST").pop();
  assert.deepEqual(r.corps, { id: "987654321", nom: "Salon", note: "sous la télé", etiquettes: ["maison", "tv"] }, "ID normalise, etiquettes dedoublonnees");
  assert.equal(r.xrd, "1"); assert.equal(r.ct, "application/json");
  await p.waitForFunction(() => document.querySelectorAll("#rdflotte .rdfl-carte").length === 5);
  assert.ok((await cartes(p)).some((c) => c.id === "987654321" && c.nom === "Salon"));
});

await test("flotte-modifier-retirer : l'ID est fige, la suppression exige deux clics, Echap ferme sans rien envoyer", async (p, ctx) => {
  const api = await fausseApi(ctx, LISTE4()); await p.goto(URL_PAGE); await panneau(p);
  await p.click('#rdflotte [data-id="523470026"] [data-action="modifier"]'); await p.waitForSelector(".rdfl-dlg[open]");
  assert.equal(await p.evaluate(() => document.querySelector('.rdfl-dlg [name="id"]').readOnly), true); assert.equal(await p.inputValue('.rdfl-dlg [name="nom"]'), "MacBook Pro");
  await p.keyboard.press("Escape"); await p.waitForFunction(() => !document.querySelector(".rdfl-dlg"));
  assert.equal(api.req.filter((r) => r.m !== "GET").length, 0, "Echap : aucune ecriture");
  await p.click('#rdflotte [data-id="523470026"] [data-action="modifier"]'); await p.waitForSelector(".rdfl-dlg[open]");
  await p.fill('.rdfl-dlg [name="nom"]', "MBP 16"); await p.click('.rdfl-dlg [type="submit"]'); await p.waitForFunction(() => !document.querySelector(".rdfl-dlg"));
  assert.deepEqual(api.req.filter((r) => r.m === "PUT").pop().corps, { nom: "MBP 16", note: "", etiquettes: ["mac"] });
  await p.click('#rdflotte [data-id="523470026"] [data-action="modifier"]'); await p.waitForSelector(".rdfl-dlg[open]");
  await p.click('.rdfl-dlg [data-action="retirer"]');
  assert.equal(api.req.filter((r) => r.m === "DELETE").length, 0, "un seul clic ne retire RIEN"); assert.match(await p.textContent('.rdfl-dlg [data-action="retirer"]'), /Confirmer/);
  assert.match(await p.textContent(".rdfl-err"), /Le poste lui-même n'est pas touché/);
  await p.click('.rdfl-dlg [data-action="retirer"]'); await p.waitForFunction(() => !document.querySelector(".rdfl-dlg"));
  assert.equal(api.req.filter((r) => r.m === "DELETE").length, 1); await p.waitForFunction(() => document.querySelectorAll("#rdflotte .rdfl-carte").length === 3);
});

await test("flotte-favori : epingler envoie favori et reordonne ; l'etat est annonce", async (p, ctx) => {
  const api = await fausseApi(ctx, LISTE4()); await p.goto(URL_PAGE); await panneau(p);
  await p.click('#rdflotte [data-id="314159265"] .rdfl-etoile');
  assert.deepEqual(api.req.filter((r) => r.m === "PUT").pop().corps, { favori: true }); assert.equal(api.req.filter((r) => r.m === "PUT").pop().chemin, "/api/devices/314159265");
  await p.waitForFunction(() => document.querySelector('#rdflotte [data-id="314159265"] .rdfl-etoile').getAttribute("aria-pressed") === "true");
  assert.match(await p.getAttribute('#rdflotte [data-id="314159265"] .rdfl-etoile', "aria-label"), /^Désépingler PC portable travail/);
  assert.deepEqual((await cartes(p)).map((c) => c.id).slice(0, 3), ["314159265", "222482174", "523470026"], "les epingles en ligne passent devant l'epingle hors ligne ; entre deux en ligne, la plus recente d'abord");
});

await test("flotte-export-import : un fichier sans etat en ligne ; l'import n'envoie que du valide", async (p, ctx) => {
  const api = await fausseApi(ctx, LISTE4()); await p.goto(URL_PAGE); await panneau(p);
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 8000 }), p.click('#rdflotte [data-action="exporter"]')]);
  assert.match(dl.suggestedFilename(), /^rustdesk-postes-\d{8}\.json$/);
  const f = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  assert.equal(f.version, 1); assert.equal(f.postes.length, 4); assert.deepEqual(Object.keys(f.postes[0]).sort(), ["etiquettes", "favori", "id", "nom", "note"], "ni etat en ligne, ni horodatage");
  const avant = api.req.filter((r) => r.m === "POST").length;
  const tmp = path.join(os.tmpdir(), "rdimport-" + process.pid + ".json");
  fs.writeFileSync(tmp, JSON.stringify({ postes: [{ id: "111 222 333", nom: "Importé", etiquettes: ["x"] }, { id: "../mal" }, { id: "222482174", nom: "doublon connu" }, { id: "444555666", favori: true, pirate: 1 }] }));
  await p.setInputFiles('#rdflotte [data-role="import"]', tmp); fs.rmSync(tmp, { force: true });
  await p.waitForFunction(() => document.querySelectorAll("#rdflotte .rdfl-carte").length === 6);
  const envoyes = api.req.filter((r) => r.m === "POST").slice(avant).map((r) => r.corps);
  assert.deepEqual(envoyes, [{ id: "111222333", nom: "Importé", etiquettes: ["x"] }, { id: "222482174", nom: "doublon connu" }, { id: "444555666", favori: true }], "seulement du valide, sans champ inconnu");
  fs.writeFileSync(tmp, "ceci n'est pas du json"); const n = api.req.length; await p.setInputFiles('#rdflotte [data-role="import"]', tmp); fs.rmSync(tmp, { force: true });
  await p.waitForTimeout(500); assert.equal(api.req.length, n, "fichier illisible : aucune requete");
});

await test("flotte-masquee-en-session : le panneau disparait avec le formulaire de connexion", async (p, ctx) => {
  await fausseApi(ctx, LISTE4()); await p.goto(URL_PAGE); await panneau(p);
  await p.evaluate(() => { document.getElementById("connect").style.display = "none"; });
  await p.waitForFunction(() => document.getElementById("rdflotte").hidden); assert.equal(await p.isVisible("#rdflotte"), false);
  await p.evaluate(() => { document.getElementById("connect").style.display = "block"; });
  await p.waitForFunction(() => !document.getElementById("rdflotte").hidden);
});

await test("flotte-session : une connexion reussie ajoute le poste (nomme d'apres l'hote) ou met sa derniere connexion a jour", async (p, ctx) => {
  const api = await fausseApi(ctx, [{ id: "555666777", nom: "Déjà connu" }]);
  await sessionSimulee(p); await montee(p); await p.waitForFunction(() => window.RDConsole.flotteUi.etat().dispo);
  await p.evaluate(() => window.onGlobalEvent(JSON.stringify({ name: "peer_info", hostname: "Mac-de-test", displays: "[]", current_display: "0" })));
  await p.waitForFunction(() => window.RDConsole.flotteUi.etat().postes.some((x) => x.id === "123456789"), null, { timeout: 5000 });
  assert.deepEqual(api.req.filter((r) => r.m === "POST" && r.chemin === "/api/devices").pop().corps, { id: "123456789", nom: "Mac-de-test" }, "inconnu : ajoute, nomme d'apres le nom d'hote");
  await p.evaluate(() => window.onGlobalEvent(JSON.stringify({ name: "peer_info", hostname: "Mac-de-test", displays: "[]", current_display: "0" })));
  await p.waitForTimeout(400);
  assert.equal(api.req.filter((r) => r.chemin === "/api/devices/123456789/touch").length, 1, "connu : seulement la derniere connexion");
  await p.evaluate(() => window.onGlobalEvent(JSON.stringify({ name: "connection_ready", secure: "true", direct: "false" }))); await p.waitForTimeout(300);
  assert.equal(api.req.filter((r) => r.chemin === "/api/devices/123456789/touch").length, 1, "un autre evenement de la meme session n'y touche pas");
});

await test("flotte-changer-de-poste : en session, la liste (poste courant grise) ; un clic quitte puis ouvre l'autre", async (p, ctx) => {
  await fausseApi(ctx, [{ id: "123456789", nom: "Ce poste", en_ligne: true }, { id: "314159265", nom: "L'autre", en_ligne: true }, { id: "271828182", nom: "Éteint", en_ligne: false }]);
  await sessionSimulee(p); await montee(p); await p.waitForFunction(() => window.RDConsole.flotteUi.etat().postes.length === 3);
  await p.evaluate(() => { window.__go = []; window.connect = function () { window.__go.push(document.getElementById("id").value); };
    window.cancel = function () { document.getElementById("connect").style.display = "block"; document.getElementById("canvas").style.display = "none"; }; });
  await ouvrirBarre(p); await ouvrirPop(p, "postes");
  const e = await p.evaluate(() => [...document.querySelectorAll("#rdpop-postes .rdposte")].map((b) => ({ id: b.dataset.id, off: b.disabled, texte: b.textContent })));
  assert.deepEqual(e.map((x) => x.id), ["123456789", "314159265", "271828182"], "en ligne d'abord, hors ligne en dernier");
  assert.equal(e[0].off, true); assert.match(e[0].texte, /connecté/); assert.equal(e[1].off, false);
  await p.waitForTimeout(450);
  await p.click('#rdpop-postes [data-id="314159265"]');
  await p.waitForFunction(() => window.__go.length === 1, null, { timeout: 6000 });
  assert.deepEqual(await p.evaluate(() => window.__go), ["314159265"], "la session est quittee, puis l'autre poste est ouvert");
});
await test("flotte-changer-sans-service : sans le service, la liste vient des dernieres connexions du navigateur", async (p, ctx) => {
  await fausseApi(ctx, LISTE4(), { statut: 502 });
  await sessionSimulee(p); await montee(p); await ouvrirBarre(p); await ouvrirPop(p, "postes");
  const ids = await p.evaluate(() => [...document.querySelectorAll("#rdpop-postes .rdposte")].map((b) => b.dataset.id));
  assert.deepEqual(ids.sort(), ["123456789", "222222222", "333333333"].sort(), "123456789 (courant) puis les recents locaux");
  assert.match(await p.textContent("#rdpop-postes h4"), /Dernières connexions/);
}, { init: { "rd-recent": JSON.stringify({ v: 1, ids: [{ id: "123456789", t: Date.now() - 1000 }, { id: "222222222", t: Date.now() - 5000 }, { id: "333333333", t: Date.now() - 9000 }] }) } });

await test("flotte-anglais : la page d'accueil suit la langue du navigateur", async (p, ctx) => {
  await fausseApi(ctx, LISTE4()); await p.goto(URL_PAGE); await panneau(p);
  assert.equal(await p.textContent("#rdfl-titre"), "My machines"); assert.equal(await p.textContent("#rdflotte .rdfl-compte"), "4 machines · 2 online");
  const c = await cartes(p); assert.equal(c[0].sous, "222 482 174" + "3 h ago"); assert.equal(c[3].sous, "never connected");
  assert.equal(await p.textContent('#rdflotte [data-action="connecter"]'), "Connect"); assert.match(await p.textContent('#rdflotte [data-action="ajouter"]'), /Add a machine/);
}, { contexte: { locale: "en-US" } });

await test("flotte-mobile : une colonne, aucun debordement horizontal, cibles de 44 px", async (p, ctx) => {
  await fausseApi(ctx, LISTE4()); await p.goto(URL_PAGE); await panneau(p);
  const e = await p.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { sw: document.documentElement.scrollWidth, iw: innerWidth, colonnes: new Set([...document.querySelectorAll("#rdflotte .rdfl-carte")].map((c) => Math.round(c.getBoundingClientRect().left))).size,
             cibles: ["#rdflotte [data-action=connecter]", "#rdflotte .rdfl-etoile", "#rdflotte [data-action=modifier]", "#rdflotte [data-action=ajouter]", "#rdflotte .rdfl-recherche"].map((s) => Math.round(r(s).height)) }; });
  assert.ok(e.sw <= e.iw, `debordement : ${e.sw} > ${e.iw}`); assert.equal(e.colonnes, 1, "une seule colonne"); for (const h of e.cibles) assert.ok(h >= 44, "cible de " + h + " px");
}, { contexte: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });

await test("flotte-contraste : texte >= 4,5:1 sur la page d'accueil et dans le dialogue", async (p, ctx) => {
  await fausseApi(ctx, LISTE4()); await p.goto(URL_PAGE); await panneau(p);
  const mesures = () => p.evaluate(`(() => { const M = ${MESURE}, q = (s) => document.querySelector(s);
    const texte = (nom, fg, bg) => { const f = M.fond(bg), c = getComputedStyle(fg).color; return { nom, r: M.rapport(M.rgb(c, f), M.rgb(f, "#000")) }; };
    const carte = q('#rdflotte [data-id="222482174"]');
    const l = [ texte("titre", q("#rdfl-titre"), q("#rdflotte")), texte("compte", q(".rdfl-compte"), q("#rdflotte")), texte("nom", carte.querySelector(".rdfl-nom"), carte), texte("ID", carte.querySelector(".rdfl-id"), carte),
      texte("duree", carte.querySelector(".rdfl-rel"), carte), texte("etiquette", carte.querySelector(".rdfl-tag"), carte), texte("note", carte.querySelector(".rdfl-note"), carte),
      texte("bouton principal", carte.querySelector(".rdfl-primaire"), carte.querySelector(".rdfl-primaire")), texte("bouton secondaire", q(".rdfl-outils .rdfl-btn:not(.rdfl-primaire)"), q(".rdfl-outils .rdfl-btn:not(.rdfl-primaire)")),
      texte("etoile", carte.querySelector(".rdfl-etoile"), carte), texte("recherche", q(".rdfl-recherche"), q(".rdfl-recherche")) ];
    const d = q(".rdfl-dlg"); if (d) { l.push(texte("dialogue : titre", q(".rdfl-dlg h2"), d), texte("dialogue : etiquette de champ", q(".rdfl-champ > span"), d), texte("dialogue : saisie", q(".rdfl-champ input"), q(".rdfl-champ input")), texte("dialogue : bouton principal", q(".rdfl-dlg .rdfl-primaire"), q(".rdfl-dlg .rdfl-primaire")), texte("dialogue : retirer", q(".rdfl-dlg .rdfl-danger"), q(".rdfl-dlg .rdfl-danger"))); }
    return l; })()`);
  for (const phase of ["page", "dialogue"]) {
    if (phase === "dialogue") { await p.click('#rdflotte [data-action="modifier"]'); await p.waitForSelector(".rdfl-dlg[open]"); await p.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} })); }
    const m = await mesures(), mauvais = m.filter((x) => !(x.r >= 4.5));
    assert.deepEqual(mauvais.map((x) => `${x.nom} : ${x.r.toFixed(2)}:1`), [], phase + " — pire : " + m.slice().sort((a, b) => a.r - b.r).slice(0, 3).map((x) => `${x.nom} ${x.r.toFixed(2)}:1`).join(", "));
  }
});

// ============================================================ presse-papier de fichiers
enTete("Presse-papier de fichiers — vrai collage, vrais File, vrai telechargement");
// Le pair annonce le presse-papier de fichiers dans peer_info (platform_additions) : c'est lui qui decide.
const sessionFichiers = async (p) => {
  await sessionSimulee(p);
  await p.evaluate(() => { window.curConn._peerInfo.platform_additions = JSON.stringify({ has_file_clipboard: true });
    window.onGlobalEvent(JSON.stringify({ name: "peer_info" })); window.__envoyes.length = 0; window.__touches.length = 0; window.__rdActive().focus(); });
};
const cliprdr = (p) => p.evaluate(() => window.__envoyes.filter((m) => m.cliprdr).map((m) => { const c = m.cliprdr, o = {};
  for (const k of Object.keys(c)) { const v = c[k]; o[k] = {}; for (const kk of Object.keys(v)) o[k][kk] = v[kk] instanceof Uint8Array ? [...v[kk]] : v[kk]; } return o; }));

await test("files-paste-local-to-remote : un fichier copie ici et colle dans la session est annonce, la frappe rejouee, puis servi par plages", async (p) => {
  await sessionFichiers(p);
  await p.evaluate(() => { const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([10, 11, 12, 13, 14, 15])], "notes.txt", { type: "text/plain", lastModified: 1700000000000 }));
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); });
  await p.waitForFunction(() => window.__envoyes.some((m) => m.cliprdr && m.cliprdr.format_list), null, { timeout: 5000 });
  assert.deepEqual((await cliprdr(p))[0].format_list.formats.map((f) => f.format), ["FileGroupDescriptorW", "FileContents"]);
  // La frappe de collage part au poste distant (le pair est un Mac, le clavier du banc traduit : Cmd+V).
  await p.waitForFunction(() => window.__touches.some(([n, v]) => n === "input_key" && JSON.parse(v).name === "v" && JSON.parse(v).down === "true"), null, { timeout: 5000 });
  assert.equal(await p.evaluate(() => !!document.getElementById("rdfiles") && getComputedStyle(document.getElementById("rdfiles")).display !== "none"), false, "le panneau Fichiers ne s'ouvre pas");
  // Le poste colle : liste, puis une plage du VRAI File.
  await p.evaluate(() => { window.__envoyes.length = 0; window.__rdFppRecevoir({ cliprdr: { format_data_request: { requested_format_id: 49334 } } }); });
  const liste = (await cliprdr(p))[0].format_data_response;
  assert.equal(liste.msg_flags, 1); assert.equal(liste.format_data.length, 4 + 592);
  assert.equal(String.fromCharCode(...liste.format_data.slice(4 + 72, 4 + 72 + 18).filter((_, i) => i % 2 === 0)), "notes.txt", "nom en UTF-16 au decalage 72");
  await p.evaluate(() => { window.__envoyes.length = 0;
    window.__rdFppRecevoir({ cliprdr: { file_contents_request: { stream_id: 0, list_index: 0, dw_flags: 2, n_position_low: 1, n_position_high: 0, cb_requested: 3 } } }); });
  await p.waitForFunction(() => window.__envoyes.some((m) => m.cliprdr && m.cliprdr.file_contents_response), null, { timeout: 5000 });
  assert.deepEqual((await cliprdr(p))[0].file_contents_response, { msg_flags: 1, stream_id: 0, requested_data: [11, 12, 13] });
});

await test("files-copy-remote-to-local : des fichiers copies sur le poste -> un bouton, visible barre repliee ; un clic les telecharge", async (p) => {
  await sessionFichiers(p);
  // La liste que le pair enverrait, fabriquee par la meme bibliotheque (le format est verifie au banc du gabarit).
  await p.evaluate(() => { window.__rdFppRecevoir({ cliprdr: { format_list: { formats: [{ id: 49334, format: "FileGroupDescriptorW" }, { id: 49267, format: "FileContents" }] } } });
    window.__rdFppRecevoir({ cliprdr: { format_data_response: { msg_flags: 1, format_data: window.RDLib.fpp.liste([{ nom: "photos\\plage.jpg", taille: 4, mtime: 1700000000000 }]) } } }); });
  const b = p.locator('#rdbar .rdppbtn[data-kind="fichiers"]');
  await b.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await b.textContent(), "Fichier copié ⇩");
  assert.equal(await p.evaluate(() => document.getElementById("rdbar").classList.contains("replie")), true, "barre repliee : le bouton se voit quand meme");
  assert.equal((await cliprdr(p)).some((c) => c.file_contents_request), false, "rien n'est telecharge sans clic");
  // Le clic : le vrai telechargement du navigateur, avec le contenu servi par le « pair ».
  await p.evaluate(() => { const env = window.curConn._ws.sendMessage; window.curConn._ws.sendMessage = function (m) { env.call(this, m);
    const r = m.cliprdr && m.cliprdr.file_contents_request;
    if (r) setTimeout(() => window.__rdFppRecevoir({ cliprdr: { file_contents_response: { msg_flags: 1, stream_id: r.stream_id, requested_data: new Uint8Array([1, 2, 3, 4]).subarray(r.n_position_low, r.n_position_low + r.cb_requested) } } }), 0); }; });
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 8000 }), b.click()]);
  assert.equal(dl.suggestedFilename(), "plage.jpg", "sous son seul nom, jamais sous le chemin venu du pair");
  const chemin = await dl.path();
  assert.deepEqual([...fs.readFileSync(chemin)], [1, 2, 3, 4], "les octets recus, dans l'ordre");
});

// ---------------------------------------------------------------------- bilan
await navigateur.close();
serveur.close();
const ko = resultats.filter(([, ok]) => !ok);
console.log(`\n${resultats.length - ko.length}/${resultats.length} tests navigateur reussis`);
process.exit(ko.length ? 1 : 0);
