/**
 * Shared UI component: renders a SafeSignalView as a signal card.
 *
 * Pure DOM rendering with no framework dependency. Used by popup,
 * sidepanel, and options so every surface looks and reads the same.
 */

import type { SafeSignalView } from "../types/messaging.js";

const DIR_COLOR: Record<string, string> = {
  UP: "#1a7f37",
  DOWN: "#b42318",
  NO_TRADE: "#57606a",
};

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/**
 * Render the card into `container`, replacing existing content.
 * Confidence is always labeled "conviction"; calibrated probability is
 * shown only when present.
 */
export function renderSignalCard(container: HTMLElement, view: SafeSignalView): void {
  container.replaceChildren();

  const color = DIR_COLOR[view.direction] ?? "#57606a";

  const dir = document.createElement("div");
  dir.textContent = view.direction;
  dir.style.cssText = `font-size:24px;font-weight:800;color:${color};margin-bottom:6px`;

  const rows: [string, string][] = [
    ["Asset", view.asset],
    ["Timeframe", view.timeframe],
    ["Conviction (not probability)", fmtPct(view.confidence)],
    ...(view.calibratedProbability !== undefined
      ? ([["Calibrated probability", fmtPct(view.calibratedProbability)]] as [string, string][])
      : ([["Calibration", "not validated — conviction only"]] as [string, string][])),
    ["Score", view.score.toFixed(3)],
    ["Risk", view.riskStatus],
    ["Regime data", view.dataQuality],
    ["Model", view.modelVersion],
  ];

  const list = document.createElement("div");
  for (const [k, v] of rows) {
    const r = document.createElement("div");
    r.style.cssText = "display:flex;justify-content:space-between;gap:12px;padding:2px 0;color:#ccc";
    const kk = document.createElement("span");
    kk.textContent = k;
    kk.style.color = "#888";
    const vv = document.createElement("span");
    vv.textContent = v;
    r.appendChild(kk);
    r.appendChild(vv);
    list.appendChild(r);
  }

  const summary = document.createElement("p");
  summary.textContent = view.summary;
  summary.style.cssText = "margin-top:8px;color:#bbb;font-size:12px;line-height:1.4";

  const evidence = document.createElement("div");
  evidence.style.cssText = "margin-top:6px;font-size:11px;color:#777";
  evidence.textContent = `Evidence: ${view.evidence.map((e) => e.kind).join(", ") || "none"}`;

  container.append(dir, list, summary, evidence);
}
