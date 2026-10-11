/**
 * Phase 3 — deterministic technical-analysis types.
 *
 * Every technical prediction is explainable: engines emit normalized scores
 * plus human-readable evidence. No LLM is ever used to calculate indicators;
 * all math here is pure and deterministic (see src/indicators + src/technical).
 */

import type { Direction } from "./market.js";

/** Trend classification. TRANSITION = conflicting signals, no clean regime. */
export type TrendState = "BULLISH" | "BEARISH" | "SIDEWAYS" | "TRANSITION";

/** Swing-point direction within an HH/HL/LH/LL structure. */
export type SwingLabel = "HH" | "HL" | "LH" | "LL";

/** A detected swing high/low (fractal pivot). */
export interface SwingPoint {
  /** Index into the candle series. */
  index: number;
  /** Candle openTime at the pivot. */
  time: number;
  /** Pivot price (high for a swing high, low for a swing low). */
  price: number;
  /** "high" | "low". */
  kind: "high" | "low";
  /** Structural label relative to the previous same-kind swing. */
  label: SwingLabel | null;
}

/** A support or resistance level derived from clustered swing points. */
export interface PriceLevel {
  /** Level price (cluster centroid). */
  price: number;
  /** How many swings formed this cluster. */
  touches: number;
  /** Strongest reaction seen at this level ("held" | "tested" | "broken"). */
  status: "held" | "tested" | "broken";
}

/**
 * Eight normalized technical scores.
 *
 * Polarity: every directional score is in [-1, 1] with positive = bullish,
 * EXCEPT volatilityScore which is non-directional in [0, 1].
 * - supportScore: +1 = support tested and holding (bullish reaction).
 * - resistanceScore: +1 = resistance tested and holding (BEARISH pressure).
 *   The facade subtracts it when forming the directional combination.
 */
export interface TechnicalScores {
  trendScore: number;
  momentumScore: number;
  /** Non-directional 0-1: 0 = compressed, 1 = extreme expansion. */
  volatilityScore: number;
  structureScore: number;
  supportScore: number;
  resistanceScore: number;
  breakoutScore: number;
  candleScore: number;
}

/** A breakout / pullback / rejection event detected by the engines. */
export interface TechnicalEvent {
  kind:
    | "breakout"
    | "failed_breakout"
    | "pullback"
    | "pullback_failed"
    | "support_test"
    | "support_rejection"
    | "resistance_test"
    | "resistance_rejection"
    | "momentum_acceleration"
    | "momentum_exhaustion";
  /** Bullish (+1), bearish (-1), or neutral (0) implication. */
  bias: -1 | 0 | 1;
  detail: string;
}

/**
 * The explainable technical verdict. `direction` is derived from COMBINED
 * independent evidence (weighted vote + minimum-agreement rule) — never from
 * a single simplistic rule such as "RSI < 30 = UP".
 */
export interface TechnicalEvidence {
  direction: Direction;
  /** Combined directional conviction in [-1, 1]. */
  score: number;
  trendState: TrendState;
  scores: TechnicalScores;
  /** Every contributing observation; length >= 1 always (fail-closed note if insufficient data). */
  evidence: { kind: string; detail: string }[];
  events: TechnicalEvent[];
  /** True when enough history existed for a real verdict; false => direction is NO_TRADE. */
  complete: boolean;
}
