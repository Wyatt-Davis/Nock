import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "public", "og.png");

const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Fredoka:wght@600&family=Shrikhand&display=swap";
const FONT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const PUZZLE = [
  "428396715",
  "761854392",
  "593217864",
  "132485976",
  "976132548",
  "854679231",
  "647928153",
  "219543687",
  "385761429",
];

/**
 * Seven large boards staggered through the frame: upper middle, beside the title,
 * and across the lower half. Rotated bounds stay at least 28px apart.
 */
function boardPlacements(size) {
  const half = size / 2;
  const centers = [
    { cx: 430, cy: -15, rotate: -6, opacity: 0.16 },
    { cx: 880, cy: -30, rotate: 7, opacity: 0.15 },
    { cx: 175, cy: 355, rotate: -5, opacity: 0.17 },
    { cx: 1035, cy: 360, rotate: 6, opacity: 0.16 },
    { cx: 250, cy: 720, rotate: 8, opacity: 0.15 },
    { cx: 630, cy: 690, rotate: -4, opacity: 0.17 },
    { cx: 1010, cy: 710, rotate: -7, opacity: 0.14 },
  ];
  const halfBox = (degrees) => {
    const rad = (Math.abs(degrees) * Math.PI) / 180;
    return half * (Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad)));
  };
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const a = centers[i];
      const b = centers[j];
      const gapX = Math.abs(a.cx - b.cx) - halfBox(a.rotate) - halfBox(b.rotate);
      const gapY = Math.abs(a.cy - b.cy) - halfBox(a.rotate) - halfBox(b.rotate);
      if (gapX < 28 && gapY < 28) {
        throw new Error(`boards ${i} and ${j} overlap (gap ${gapX.toFixed(0)}×${gapY.toFixed(0)})`);
      }
    }
  }
  return centers.map((item) => ({
    x: item.cx - half,
    y: item.cy - half,
    rotate: item.rotate,
    opacity: item.opacity,
  }));
}

async function latinFace(family) {
  const css = await fetch(FONT_CSS, { headers: { "user-agent": FONT_UA } }).then((response) => {
    if (!response.ok) throw new Error(`font css ${response.status}`);
    return response.text();
  });
  const re = /\/\*\s*([^*]+?)\s*\*\/\s*(@font-face\s*\{[^}]+\})/g;
  for (const match of css.matchAll(re)) {
    if (match[1].trim() !== "latin") continue;
    if (!match[2].includes(`font-family: '${family}'`) && !match[2].includes(`font-family: "${family}"`)) continue;
    const url = match[2].match(/url\(([^)]+)\)/)?.[1]?.replace(/["']/g, "");
    if (!url) continue;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`font ${response.status} ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${bytes.toString("base64")}) format('woff2');font-weight:${family === "Fredoka" ? 600 : 400};font-style:normal;}`;
  }
  throw new Error(`no latin face for ${family}`);
}

function miniBoard(cell) {
  const gap = cell * 0.12;
  const pad = gap;
  const box = cell * 3 + gap * 2;
  const size = box * 3 + gap * 2 + pad * 2;
  let boxes = "";
  let cells = "";
  for (let b = 0; b < 9; b++) {
    const br = Math.floor(b / 3);
    const bc = b % 3;
    const bx = pad + bc * (box + gap);
    const by = pad + br * (box + gap);
    boxes += `<rect x="${bx}" y="${by}" width="${box}" height="${box}" fill="#f6c453" fill-opacity="0.4"/>`;
    for (let i = 0; i < 9; i++) {
      const ir = Math.floor(i / 3);
      const ic = i % 3;
      const r = br * 3 + ir;
      const c = bc * 3 + ic;
      const x = bx + ic * (cell + gap);
      const y = by + ir * (cell + gap);
      cells += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell}" height="${cell}" fill="#1a0b24"/>`;
      cells += `<text x="${(x + cell / 2).toFixed(2)}" y="${(y + cell / 2 + cell * 0.06).toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-family="Fredoka" font-weight="600" font-size="${(cell * 0.72).toFixed(2)}" fill="#f6c453">${PUZZLE[r][c]}</text>`;
    }
  }
  return { size, markup: `<rect width="${size}" height="${size}" fill="#f6c453" fill-opacity="0.7"/>${boxes}${cells}` };
}

function svg(shrikhand, fredoka) {
  const board = miniBoard(28);
  const boards = boardPlacements(board.size)
    .map(
      (item) =>
        `<g opacity="${item.opacity}" transform="translate(${item.x} ${item.y}) rotate(${item.rotate} ${board.size / 2} ${board.size / 2})">${board.markup}</g>`,
    )
    .join("");
  console.log(`[nock] board ${Math.round(board.size)}px`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<style>
${shrikhand}
${fredoka}
</style>
<defs>
  <radialGradient id="titleGlow" cx="600" cy="328" r="420" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#1a0b24" stop-opacity="0.9"/>
    <stop offset="22%" stop-color="#1a0b24" stop-opacity="0.62"/>
    <stop offset="48%" stop-color="#1a0b24" stop-opacity="0.28"/>
    <stop offset="72%" stop-color="#1a0b24" stop-opacity="0.08"/>
    <stop offset="100%" stop-color="#1a0b24" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="1200" height="630" fill="#1a0b24"/>
${boards}
<circle cx="600" cy="328" r="420" fill="url(#titleGlow)"/>
<text x="600" y="332" text-anchor="middle" dominant-baseline="central" font-family="Shrikhand" font-size="148" fill="#f6c453" style="filter:drop-shadow(0 0 18px #1a0b24)">Nock</text>
</svg>`;
}

function chromePath() {
  return process.env.CHROME ?? "/usr/bin/google-chrome";
}

function cdpSend(ws, method, params = {}, sessionId) {
  const id = cdpSend.next++;
  const message = { id, method, params };
  if (sessionId) message.sessionId = sessionId;
  ws.send(JSON.stringify(message));
  return new Promise((resolve, reject) => {
    cdpSend.pending.set(id, { resolve, reject });
  });
}
cdpSend.next = 1;
cdpSend.pending = new Map();

async function renderPng(html) {
  const port = 9333;
  const chrome = spawn(
    chromePath(),
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${port}`,
      "--user-data-dir=/tmp/nock-og-chrome",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  try {
    let version;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!version?.webSocketDebuggerUrl) throw new Error("chrome did not open a debugging port");
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    ws.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      const waiter = cdpSend.pending.get(payload.id);
      if (!waiter) return;
      cdpSend.pending.delete(payload.id);
      if (payload.error) waiter.reject(new Error(payload.error.message));
      else waiter.resolve(payload.result);
    });
    const { targetId } = await cdpSend(ws, "Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdpSend(ws, "Target.attachToTarget", { targetId, flatten: true });
    await cdpSend(ws, "Page.enable", {}, sessionId);
    await cdpSend(
      ws,
      "Emulation.setDeviceMetricsOverride",
      { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await cdpSend(ws, "Page.setDocumentContent", { frameId: (await cdpSend(ws, "Page.getFrameTree", {}, sessionId)).frameTree.frame.id, html }, sessionId);
    await cdpSend(ws, "Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true }, sessionId);
    const shot = await cdpSend(
      ws,
      "Page.captureScreenshot",
      { format: "png", clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 }, captureBeyondViewport: true },
      sessionId,
    );
    ws.close();
    return Buffer.from(shot.data, "base64");
  } finally {
    chrome.kill();
  }
}

async function main() {
  const [shrikhand, fredoka] = await Promise.all([latinFace("Shrikhand"), latinFace("Fredoka")]);
  const markup = svg(shrikhand, fredoka);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#1a0b24}</style></head><body>${markup}</body></html>`;
  const png = await renderPng(html);
  await writeFile(target, png);
  console.log(`[nock] wrote ${target} (${png.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
