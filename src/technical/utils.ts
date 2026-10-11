/**
 * Shared helpers for the Phase 3 technical engines.
 *
 * All engines are pure and deterministic: same candles in -> same output.
 * Insufficient history yields a neutral (0) score + a "needs more data"
 * evidence note — never a fabricated signal.
 */

import type { Candle, IndicatorSet } from "../types/market.js";

/** Clamp any score into [-1, 1]. */
export function clampScore(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Sign helper: +1 / -1 / 0 with an epsilon dead-zone. */
export function sign(v: number | null, eps = 1e-9): number {
  if (v === null || !Number.isFinite(v)) return 0;
  if (v > eps) return 1;
  if (v < -eps) return -1;
  return 0;
}

/** Result shape every Phase 3 engine returns. */
export interface EngineResult {
  /** Normalized score in [-1, 1] (volatility engine: magnitude in [0, 1]). */
  score: number;
  evidence: { kind: string; detail: string }[];
}

/** Neutral result used when history is insufficient (fail closed). */
export function neutral(kind: string, what: string): EngineResult {
  return { score: 0, evidence: [{ kind, detail: `${what}; insufficient history — neutral.` }] };
}

/** Last close, or null on empty input. */
export function lastClose(candles: Candle[]): number | null {
  const c = candles[candles.length - 1];
  return c ? c.close : null;
}

/** ATR-normalized distance: (price - ref) / atr. Null-safe -> 0. */
export function atrDistance(price: number | null, ref: number | null, atrVal: number | null): number {
  if (price === null || ref === null || atrVal === null || atrVal <= 0) return 0;
  return (price - ref) / atrVal;
}

export type { Candle, IndicatorSet };

