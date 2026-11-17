import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist-standalone");
const target = path.join(root, "public", "nock.html");

const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Outfit:wght@500;600&family=Shrikhand&display=swap";
const FONT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function inlineFonts() {
  const css = await fetch(FONT_CSS, { headers: { "user-agent": FONT_UA } }).then((response) => {
    if (!response.ok) throw new Error(`font css ${response.status}`);
    return response.text();
  });
  const faces = [];
  const re = /\/\*\s*([^*]+?)\s*\*\/\s*(@font-face\s*\{[^}]+\})/g;
  for (const match of css.matchAll(re)) {
    if (match[1].trim() === "latin") faces.push(match[2]);
  }
  if (faces.length === 0) throw new Error("no latin font faces");
  const cache = new Map();
  let joined = faces.join("\n");
  const urls = [...new Set([...joined.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1].replace(/["']/g, "")))];
  await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`font ${response.status} ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      cache.set(url, `data:font/woff2;base64,${bytes.toString("base64")}`);
    }),
  );
  for (const [url, data] of cache) joined = joined.replaceAll(url, data);
  return joined;
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: "warn",
    resolve: { alias: { "@": path.join(root, "src") } },
    plugins: [tailwindcss(), react()],
    build: {
      outDir,
      emptyOutDir: true,
      cssCodeSplit: false,
      sourcemap: false,
      assetsInlineLimit: 100_000_000,
      rollupOptions: {
        input: path.join(root, "src/standalone.tsx"),
        treeshake: { moduleSideEffects: (id) => id.includes(".css") },
        output: {
          format: "iife",
          name: "NockOffline",
          inlineDynamicImports: true,
          entryFileNames: "app.js",
          assetFileNames: "app[extname]",
        },
      },
    },
  });

  const files = await readdir(outDir);
  const jsName = files.find((name) => name.endsWith(".js"));
  const cssName = files.find((name) => name.endsWith(".css"));
  if (!jsName || !cssName) throw new Error(`standalone bundle missing js/css: ${files.join(", ")}`);
  const js = (await readFile(path.join(outDir, jsName), "utf8")).replace(/<\/script/gi, "<\\/script");
  const css = (await readFile(path.join(outDir, cssName), "utf8")).replace(/<\/style/gi, "<\\/style");
  if (/\bimport\s*\(/.test(js) || /^\s*import\s/m.test(js)) {
    throw new Error("standalone bundle still has imports");
  }

  let fonts = "";
  try {
    fonts = await inlineFonts();
  } catch (error) {
    console.warn("[nock] offline fonts skipped:", error instanceof Error ? error.message : error);
  }

  const favicon = await readFile(path.join(root, "public", "favicon.svg"), "utf8");
  const icon = `data:image/svg+xml,${encodeURIComponent(favicon)}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="nock-offline" content="1">
<meta name="theme-color" content="#1a0b24">
<title>Nock</title>
<link rel="icon" href="${icon}">
${fonts ? `<style>${fonts}</style>\n` : ""}<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, html);
  await rm(target, { force: true });
  const { rename } = await import("node:fs/promises");
  await rename(tmp, target);
  await rm(outDir, { recursive: true, force: true });
  console.log(`[nock] wrote ${target} (${Math.round(html.length / 1024)}kb)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
