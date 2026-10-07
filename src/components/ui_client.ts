/**
 * UI client used by popup/sidepanel/options.
 *
 * Primary path: request analysis from the privileged background worker.
 * Fallback: run the local AnalysisService directly (used in tests or if
 * the worker is unavailable). Local-first and offline-safe.
 */

import type { SafeSignalView } from "../types/messaging.js";
import type { Candle, Timeframe } from "../types/market.js";
import { generateCandles } from "../services/market_data_service.js";
import { AnalysisService } from "../services/analysis_service.js";

/** Produce demo/paper candles deterministically (clearly labeled locally). */
export function demoCandles(): Candle[] {
  return generateCandles(12345, 120, 100, 300_000, Date.now() - 120 * 300_000);
}

function fromOutput(out: Awaited<ReturnType<AnalysisService["analyze"]>>): SafeSignalView {
  const s = out.signal;
  const view: SafeSignalView = {
    direction: s.direction,
    score: s.score,
    confidence: s.confidence,
    timestamp: s.timestamp,
    timeframe: s.timeframe,
    asset: out.snapshot.asset,
    riskStatus: s.riskStatus,
    modelVersion: s.modelVersion,
    dataQuality: s.dataQuality,
    evidence: s.evidence,
    summary: out.analysis.summary,
  };
  if (s.calibratedProbability !== undefined) view.calibratedProbability = s.calibratedProbability;
  return view;
}

/** Get a signal view for the UI. */
export async function getSignalView(asset = "EURUSD", timeframe: Timeframe = "5m"): Promise<SafeSignalView> {
  const candles = demoCandles();

  // Try the background worker first (privileged, has config + secrets).
  const hasChrome = typeof chrome !== "undefined" && chrome.runtime?.sendMessage;
  if (hasChrome) {
    try {
      const resp = (await chrome.runtime.sendMessage({
        type: "ANALYZE",
        candles,
        asset,
        timeframe,
      })) as { type: string; view?: SafeSignalView };
      if (resp && resp.type === "ANALYZE_RESULT" && resp.view) return resp.view;
    } catch {
      // fall through to local
    }
  }

  // Local fallback.
  const svc = new AnalysisService({ defaultAsset: asset, defaultTimeframe: timeframe });
  const out = await svc.analyze(candles, asset, timeframe);
  return fromOutput(out);
}
