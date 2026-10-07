/**
 * Content script — passive observation only.
 *
 * SCOPE (strict): this script reads price/candle data that the page (or a
 * user-provided data bridge) already exposes and forwards it to the
 * background worker for analysis. It does NOT:
 *   - click, type, or submit anything
 *   - alter the page DOM to influence the platform
 *   - bypass any security, CAPTCHA, or anti-bot control
 *   - read credentials, tokens, or session material
 * The UI overlay (if shown) is confined to the extension's own container.
 */

import type { Candle, Timeframe } from "../types/market.js";
import type { ExtensionRequest, ExtensionResponse, SafeSignalView } from "../types/messaging.js";

/** Global a data provider can set to hand candles to the extension. */
declare global {
  interface Window {
    __TRADEVISION_DATA__?: { asset: string; timeframe: Timeframe; candles: Candle[] };
  }
}

const MOUNT_ID = "tradevision-overlay";

/** Ask the background worker to analyze the current data. */
async function requestAnalysis(): Promise<SafeSignalView | null> {
  const data = window.__TRADEVISION_DATA__;
  if (!data || !Array.isArray(data.candles) || data.candles.length === 0) return null;

  const req: ExtensionRequest = {
    type: "ANALYZE",
    candles: data.candles,
    asset: data.asset,
    timeframe: data.timeframe,
  };
  try {
    const resp = (await chrome.runtime.sendMessage(req)) as ExtensionResponse;
    if (resp && resp.type === "ANALYZE_RESULT") return resp.view;
  } catch {
    return null;
  }
  return null;
}

/** Render a small overlay showing the signal. Extension-owned container only. */
function renderOverlay(view: SafeSignalView): void {
  let el = document.getElementById(MOUNT_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = MOUNT_ID;
    el.style.cssText =
      "position:fixed;bottom:12px;right:12px;z-index:2147483647;padding:10px 14px;border-radius:8px;font:13px system-ui;color:#fff;background:#111;box-shadow:0 2px 10px rgba(0,0,0,.4);max-width:260px";
    document.body.appendChild(el);
  }
  const color = view.direction === "UP" ? "#1a7f37" : view.direction === "DOWN" ? "#b42318" : "#57606a";
  el.innerHTML = "";
  const title = document.createElement("div");
  title.textContent = `TradeVision: ${view.direction}`;
  title.style.cssText = `font-weight:700;color:${color}`;
  const body = document.createElement("div");
  body.textContent = view.summary;
  body.style.cssText = "margin-top:4px;color:#ddd";
  el.appendChild(title);
  el.appendChild(body);
}

/** Main loop: poll the data bridge and update the overlay. */
async function tick(): Promise<void> {
  const view = await requestAnalysis();
  if (view) renderOverlay(view);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  // Passive polling only; no mutation of platform controls.
  setInterval(() => void tick(), 5000);
  void tick();
}

export { requestAnalysis, renderOverlay };
