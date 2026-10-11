/**
 * Production build for the TradeVision AI extension.
 *
 * Bundles each entry point with esbuild, injects build-time env vars as
 * `globalThis.__ENV__`, and copies static assets (HTML + manifest) into
 * dist/extension. Content script is emitted as IIFE (MV3 constraint);
 * all other entry points are ESM.
 */

import { build } from "esbuild";
import { mkdir, copyFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(root, "..");
const outDir = join(projectRoot, "dist", "extension");

// Build-time environment injection (only TV_* + NODE_ENV are exposed).
const env = {
  NODE_ENV: process.env.NODE_ENV ?? "production",
  TV_DEBUG: process.env.TV_DEBUG ?? "",
  TV_DEFAULT_ASSET: process.env.TV_DEFAULT_ASSET ?? "",
  TV_DEFAULT_TIMEFRAME: process.env.TV_DEFAULT_TIMEFRAME ?? "",
  TV_MIN_CONFIDENCE: process.env.TV_MIN_CONFIDENCE ?? "",
  TV_MAX_RISK_PER_TRADE: process.env.TV_MAX_RISK_PER_TRADE ?? "",
  TV_ALLOWED_ASSETS: process.env.TV_ALLOWED_ASSETS ?? "",
};

const common = {
  bundle: true,
  sourcemap: true,
  minify: process.env.TV_MINIFY !== "false",
  target: ["chrome114", "firefox115"],
  logLevel: "info",
  define: { "globalThis.__ENV__": JSON.stringify(env) },
};

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // ESM entry points.
  await build({
    ...common,
    format: "esm",
    entryPoints: {
      "background/service_worker": join(projectRoot, "src/background/service_worker.ts"),
      "popup/popup": join(projectRoot, "src/popup/popup.ts"),
      "sidepanel/sidepanel": join(projectRoot, "src/sidepanel/sidepanel.ts"),
      "options/options": join(projectRoot, "src/options/options.ts"),
    },
    outdir: outDir,
    entryNames: "[dir]/[name]",
  });

  // Content script as IIFE (cannot be a module in MV3 content scripts).
  await build({
    ...common,
    format: "iife",
    entryPoints: [join(projectRoot, "src/content/content_script.ts")],
    outfile: join(outDir, "content/content_script.js"),
  });

  // Copy static assets.
  const assets = [
    ["manifest.json", "manifest.json"],
    ["src/popup/popup.html", "popup/popup.html"],
    ["src/sidepanel/sidepanel.html", "sidepanel/sidepanel.html"],
    ["src/options/options.html", "options/options.html"],
  ];
  for (const [src, dest] of assets) {
    const target = join(outDir, dest);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(projectRoot, src), target);
  }

  console.log(`\nBuild complete -> ${outDir}`);
  console.log(
    `Load unpacked in Chrome: chrome://extensions -> Developer mode -> Load unpacked -> ${outDir}`,
  );
  console.log(
    "IMPORTANT: select THAT folder (dist/extension) — NOT the project root; the selected folder must contain manifest.json.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
