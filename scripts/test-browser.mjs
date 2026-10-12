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
const page = fs.readFileSync(GABARIT, "utf8")
  .split("__RD_DOMAIN__").join("localhost")
  .split("__RD_PUBLIC_KEY__").join(CLE)
  .split("__RD_DEFAULT_PEER_ID__").join("");
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".html": "text/html" };
const serveur = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (u === "/" || u === "/index.html") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(page); return; }
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
  const ctx = await navigateur.newContext({ viewport: { width: 1200, height: 800 }, ...contexte });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: URL_PAGE.replace(/\/$/, "") });
  if (Object.keys(init).length) {
    await ctx.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) if (localStorage.getItem("__init_" + k) === null) { localStorage.setItem(k, v); localStorage.setItem("__init_" + k, "1"); } }, init);
  }
  const p = await ctx.newPage();
  const avertissements = [];
  p.on("pageerror", (e) => avertissements.push("pageerror: " + e.message));
  try {
    await fn(p, ctx, avertissements);
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
    window.curConn = { _id: "123456789", _peerInfo: { version: v },
      _ws: { _websocket: { readyState: 1 }, sendMessage(m) { window.__envoyes.push(m); }, next: () => new Promise(() => {}) },
      getRemember: () => true, setRemember() {}, getOption: () => undefined };
    const sb = window.setByName; window.setByName = function (n, x) { window.__touches.push([n, x]); try { return sb.apply(this, arguments); } catch (e) { /* pas de vraie session */ } };
    document.getElementById("canvas").style.display = "block";
    document.getElementById("connect").style.display = "none";          // une vraie session masque le formulaire
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
  await p.click('.rdppbtn[data-kind="image"]');               // visible et cliquable meme barre repliee
  await p.waitForFunction(() => !document.querySelector('.rdppbtn[data-kind="image"]'), null, { timeout: 10000 });
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
  assert.ok(toasts.some((t) => /déposée/.test(t)), JSON.stringify(toasts));
});

await test("focus-restored-after-deposit : le bouton ne garde pas le clavier", async (p) => {
  await sessionSimulee(p);
  await p.evaluate(() => window.__rdPpFiltrer({ multi_clipboards: { clipboards: [{ format: 0, compress: false, content: new TextEncoder().encode("bonjour") }] } }));
  await p.click('.rdppbtn[data-kind="text"]');
  await p.waitForFunction(() => !document.querySelector('.rdppbtn[data-kind="text"]'), null, { timeout: 5000 });
  assert.equal(await p.evaluate(() => document.activeElement === window.__rdActive()), true, "le canvas actif reprend le focus");
  assert.equal(await p.evaluate(() => navigator.clipboard.readText()), "bonjour");
});

await test("attention-reveals-ppbtn-when-collapsed : visible et cliquable barre repliee", async (p) => {
  await sessionSimulee(p);
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
  await p.click('.rdppbtn[data-kind="image"]');
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
  assert.equal(await p.evaluate(() => document.activeElement.textContent), "Connect");
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
  assert.deepEqual(e.sections, ["Vidéo", "Clavier", "Souris", "Affichage"]);
  assert.equal(e.statut, true);
});

await test("console-moved-controls-still-work : qualite, cadence, codec, Ctrl↔Cmd gardent leurs gestionnaires et leurs reglages memorises", async (p) => {
  await sessionSimulee(p); await montee(p); await ouvrirTiroir(p);
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
  // Ctrl↔Cmd : un interrupteur pilote le bouton d'origine, cache dans le tiroir ; l'etat se relit a la source.
  const sw = '#rddrawer .rdsw[data-pour="swap"]';
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('#rddrawer [data-rd="swap"]')).display), "none", "le bouton d'origine est masque");
  assert.equal(await p.isChecked(sw), avant !== "0", "l'interrupteur reflete l'etat memorise");
  await p.click(sw);
  const apres = await p.evaluate(() => localStorage.getItem("rd-swap-ctrl"));
  assert.notEqual(apres, avant, "Ctrl↔Cmd bascule et se memorise");
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
  const actif = () => p.evaluate(() => [...document.querySelectorAll(".rdsegmented [role=radio]")].map((b) => b.getAttribute("aria-checked") + ":" + b.tabIndex).join(" "));
  assert.equal(await actif(), "true:0 false:-1 false:-1", "un seul segment dans l'ordre de tabulation (Auto)");
  await p.focus('.rdsegmented [aria-checked="true"]');
  await p.keyboard.press("ArrowRight");
  assert.equal(await actif(), "false:-1 true:0 false:-1", "fleche droite : « clair »");
  assert.equal(await p.evaluate(() => document.activeElement.getAttribute("data-valeur")), "clair", "le focus suit le choix");
  await p.keyboard.press("ArrowLeft"); await p.keyboard.press("ArrowLeft");
  assert.equal(await p.evaluate(() => document.activeElement.getAttribute("data-valeur")), "sombre", "boucle de « auto » vers « sombre »");
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
const formulaire = async (p) => { await p.goto(URL_PAGE); await p.waitForSelector("#id[data-rdlogin]", { timeout: 15000 }); };

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

await test("login-accessible-names-and-enter : champs nommes, Entree valide la connexion, « Aller » sur le clavier mobile", async (p) => {
  await formulaire(p);
  await p.waitForSelector('#id[inputmode="numeric"]', { timeout: 5000 });     // pose par le gabarit a son premier tick (400 ms)
  const e = await p.evaluate(() => ({ noms: ["host", "key", "id"].map((i) => document.getElementById(i).getAttribute("aria-label")),
    hint: document.getElementById("id").getAttribute("enterkeyhint"), num: document.getElementById("id").getAttribute("inputmode") }));
  assert.deepEqual(e.noms, ["Hôte du serveur", "Clé publique du serveur", "ID du poste distant"]);
  assert.equal(e.hint, "go"); assert.equal(e.num, "numeric", "clavier numerique conserve");
  await p.evaluate(() => { window.__go = 0; window.connect = function () { window.__go++; }; });
  await p.waitForTimeout(450);                                   // laisse protegerConnect (300 ms) re-envelopper : il appelle encore notre sonde
  await p.fill("#id", "123456789");
  await p.press("#id", "Enter");
  assert.equal(await p.evaluate(() => window.__go), 1, "Entree dans Id lance la connexion");
  await p.press("#key", "Enter");
  assert.equal(await p.evaluate(() => window.__go), 2, "et depuis n'importe quel champ");
  await p.press("#id", "Shift+Enter"); await p.press("#id", "Control+Enter");
  assert.equal(await p.evaluate(() => window.__go), 2, "Maj/Ctrl+Entree ne declenchent rien : le raccourci reste a l'utilisateur");
  await p.click("#connect td > button");
  assert.equal(await p.evaluate(() => window.__go), 3, "le bouton marche toujours comme avant");
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
    return [ texte("titre de la carte", q("#connect"), q("#connect"), 4.5, "::before"),
             texte("etiquette de champ", q("#connect td > span"), q("#connect"), 4.5),
             texte("ID saisi", q("#id"), q("#id"), 4.5), texte("hote", q("#host"), q("#host"), 4.5), texte("cle", q("#key"), q("#key"), 4.5),
             texte("bouton Connect", q("#connect td > button"), q("#connect td > button"), 4.5),
             bord("bord du champ Id", q("#id"), q("#connect")), bord("bord du champ hote", q("#host"), q("#connect")) ]; })()`);
  const mauvais = m.filter((x) => !(x.r >= x.seuil));
  assert.deepEqual(mauvais.map((x) => `${x.nom} : ${x.r.toFixed(2)}:1 < ${x.seuil}`), [], "pire : " + m.slice().sort((a, b) => a.r / a.seuil - b.r / b.seuil).slice(0, 3).map((x) => `${x.nom} ${x.r.toFixed(2)}:1`).join(", "));
  await p.focus("#key"); await p.keyboard.press("Tab");
  const ombre = await p.evaluate(() => getComputedStyle(document.getElementById("id")).boxShadow);
  assert.notEqual(ombre, "none", "anneau de focus sur Id");
  const autres = await p.evaluate(() => { const o = {}; for (const id of ["password", "status"]) { const e = document.getElementById(id); e.style.display = "block";
      o[id] = { titre: getComputedStyle(e, "::before").content, rayon: getComputedStyle(e).borderTopLeftRadius, largeur: Math.round(e.getBoundingClientRect().width) }; } return o; });
  assert.equal(autres.password.titre, '"Mot de passe du poste"'); assert.equal(autres.status.titre, '"Connexion en cours"');
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

// ---------------------------------------------------------------------- bilan
await navigateur.close();
serveur.close();
const ko = resultats.filter(([, ok]) => !ok);
console.log(`\n${resultats.length - ko.length}/${resultats.length} tests navigateur reussis`);
process.exit(ko.length ? 1 : 0);
