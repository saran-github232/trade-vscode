/**
 * Development build for the TradeVision AI extension.
 *
 * Same entry points and asset copies as scripts/build.mjs, but tuned for
 * local iteration: unminified output, inline sourcemaps, NODE_ENV=development.
 * Runs an initial build, then rebuilds on every source change (esbuild watch)
 * so the unpacked extension in dist/extension always reflects the latest code
 * (reload it from chrome://extensions after a rebuild).
 *
 * Usage:
 *   node scripts/dev.mjs          # initial build + watch until Ctrl+C
 *   node scripts/dev.mjs --once   # single build, then exit (CI / scripted)
 */

import { context } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(root, "..");
const outDir = join(projectRoot, "dist", "extension");
const once = process.argv.includes("--once");

// Development environment injection (only TV_* + NODE_ENV are exposed).
const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  TV_DEBUG: process.env.TV_DEBUG ?? "true",
  TV_DEFAULT_ASSET: process.env.TV_DEFAULT_ASSET ?? "",
  TV_DEFAULT_TIMEFRAME: process.env.TV_DEFAULT_TIMEFRAME ?? "",
  TV_MIN_CONFIDENCE: process.env.TV_MIN_CONFIDENCE ?? "",
  TV_MAX_RISK_PER_TRADE: process.env.TV_MAX_RISK_PER_TRADE ?? "",
  TV_ALLOWED_ASSETS: process.env.TV_ALLOWED_ASSETS ?? "",
};

const common = {
  bundle: true,
  sourcemap: true,
  minify: false,
  target: ["chrome114", "firefox115"],
  logLevel: "info",
  define: { "globalThis.__ENV__": JSON.stringify(env) },
};

async function copyAssets() {
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
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // ESM entry points.
  const esmCtx = await context({
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
    plugins: [{ name: "copy-assets", setup: (b) => b.onEnd(copyAssets) }],
  });

  // Content script as IIFE (cannot be a module in MV3 content scripts).
  const iifeCtx = await context({
    ...common,
    format: "iife",
    entryPoints: [join(projectRoot, "src/content/content_script.ts")],
    outfile: join(outDir, "content/content_script.js"),
  });

  await esmCtx.rebuild();
  await iifeCtx.rebuild();

  if (once) {
    await esmCtx.dispose();
    await iifeCtx.dispose();
    console.log(`\nDev build complete -> ${outDir}`);
    return;
  }

  await esmCtx.watch();
  await iifeCtx.watch();
  console.log(`\nWatching for changes -> ${outDir} (Ctrl+C to stop)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
