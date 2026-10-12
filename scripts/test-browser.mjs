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
  assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.id), "player");
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
  assert.deepEqual(v.slice(1), ["best", "60", "vp9"], JSON.stringify(v));
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

// ---------------------------------------------------------------------- bilan
await navigateur.close();
serveur.close();
const ko = resultats.filter(([, ok]) => !ok);
console.log(`\n${resultats.length - ko.length}/${resultats.length} tests navigateur reussis`);
process.exit(ko.length ? 1 : 0);
