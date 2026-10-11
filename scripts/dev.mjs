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
 *
 * Watch mode intentionally keeps the terminal alive and idle between
 * changes; every save triggers an incremental rebuild followed by a
 * "reload your extension" hint, so the process never looks stuck.
 */

import { context } from "esbuild";
import { watch } from "node:fs";
import { mkdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(root, "..");
const outDir = join(projectRoot, "dist", "extension");
const once = process.argv.includes("--once");

// esbuild's ctx.watch() fires its own startup rebuild(s), which makes
// build-counting unreliable for "was this a real change?". Instead a native
// fs watcher on src/ marks real edits; the first build that SUCCEEDS after
// an edit prints the "reload your extension" hint (exactly one line per
// save). Build errors are always reported, from either context.
let pendingChange = false;
function buildReporterPlugin() {
  return {
    name: "build-reporter",
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) {
          pendingChange = false;
          console.error(
            `[dev] Build FAILED (${result.errors.length} error(s)) — fix the code and save again; watching continues.`,
          );
        } else if (pendingChange) {
          pendingChange = false;
          console.log(
            "[dev] Rebuild done -> press the reload (R) button on the extension card in chrome://extensions.",
          );
        }
      });
    },
  };
}

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
    plugins: [
      { name: "copy-assets", setup: (b) => b.onEnd(copyAssets) },
      buildReporterPlugin(),
    ],
  });

  // Content script as IIFE (cannot be a module in MV3 content scripts).
  const iifeCtx = await context({
    ...common,
    format: "iife",
    entryPoints: [join(projectRoot, "src/content/content_script.ts")],
    outfile: join(outDir, "content/content_script.js"),
    plugins: [buildReporterPlugin()],
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
  // Native fs watcher marks real edits (esbuild's own startup rebuilds are
  // not edits, so they never print a spurious "[dev] Rebuild done").
  watch(join(projectRoot, "src"), { recursive: true }, () => {
    pendingChange = true;
  });
  console.log(
    [
      "",
      `Dev build ready -> ${outDir}`,
      "",
      "This is a WATCHER, not a one-shot build: the terminal staying idle is normal.",
      "  1. Chrome -> chrome://extensions -> Developer mode -> Load unpacked ->",
      `     select: ${outDir}  (do this once).`,
      "  2. Edit any file under src/ -> it rebuilds automatically in milliseconds",
      "     (watch this terminal for the [dev] Rebuild done hint).",
      "  3. After each rebuild press the reload (R) button on the extension card.",
      "",
      "Stop the watcher with Ctrl+C. Want a single build that exits instead?",
      "  npm run dev -- --once",
      "",
      "Watching for changes...",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
