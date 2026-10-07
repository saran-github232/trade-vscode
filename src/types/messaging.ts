/**
 * Message contracts between extension contexts.
 *
 * SECURITY: every message that leaves the background worker must pass
 * `assertNoRawSecrets` first, so raw API keys never reach content/page.
 */

import type { MarketSnapshot, Timeframe, Direction } from "./market.js";
import type { Signal } from "./signal.js";

/** Direction shown in the UI (same vocabulary). */
export type UiDirection = Direction;

/** A minimal, safe-to-share projection of a signal for the UI. */
export interface SafeSignalView {
  direction: Direction;
  score: number;
  confidence: number;
  calibratedProbability?: number;
  timestamp: number;
  timeframe: string;
  asset: string;
  riskStatus: Signal["riskStatus"];
  modelVersion: string;
  dataQuality: Signal["dataQuality"];
  evidence: Signal["evidence"];
  summary: string;
}

/** Requests a content script / popup / sidepanel can send to background. */
export type ExtensionRequest =
  | { type: "ANALYZE"; candles: unknown; asset: string; timeframe: Timeframe }
  | { type: "GET_STATE" }
  | { type: "SAVE_API_KEY"; name: string; apiKey: string }
  | { type: "LIST_SECRETS" }
  | { type: "DELETE_SECRET"; handle: string };

/** Responses from the background worker (never contain secrets). */
export type ExtensionResponse =
  | { type: "ANALYZE_RESULT"; view: SafeSignalView; snapshot?: Pick<MarketSnapshot, "asset" | "currentPrice" | "marketRegime" | "volatility" | "dataQuality"> }
  | { type: "STATE"; hasKey: boolean; paper: true }
  | { type: "SECRET_SAVED"; name: string; masked: string }
  | { type: "SECRETS"; items: { name: string; masked: string }[] }
  | { type: "OK" }
  | { type: "ERROR"; message: string };
