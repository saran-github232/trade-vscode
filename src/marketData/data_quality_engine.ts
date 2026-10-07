/**
 * DataQualityEngine — validates a raw candle series and produces a 0-100
 * data-quality score with a full issue report.
 *
 * Detected defects (Phase 2 spec):
 *   duplicate candles, missing candles, out-of-order candles, invalid OHLC
 *   relationships, stale candles, timestamp gaps, unrealistic values,
 *   incomplete data.
 *
 * The engine is deterministic and fail-closed: `pass === false` whenever the
 * score falls below the configured threshold, which downstream gates use to
 * force NO_TRADE.
 */

import type { DataQuality, DataQualityIssue, DataQualityReport, Timeframe } from "../types/market.js";
import { CandleStore, type RawCandle } from "./candle_store.js";
import { TimeframeManager } from "./timeframe_manager.js";

export interface DataQualityOptions {
  /** Score at-or-above which analysis is allowed (0-100). Default 70. */
  threshold?: number;
  /** Minimum candles required for a complete feature window. Default 50. */
  minCandles?: number;
  /**
   * When supplied, staleness of the newest candle is evaluated against it.
   * Omitted for replay/backtest so historical data is never penalized.
   */
  now?: number;
  /** Age of the newest candle (ms) beyond which it is flagged stale. Default 5m. */
  staleAfterMs?: number;
  /** Age beyond which staleness hard-fails the score. Default 1h. */
  staleHardMs?: number;
  /** Max single-candle range or body as a fraction of price. Default 0.2 (20%). */
  maxMovePct?: number;
}

const DEFAULTS = {
  threshold: 70,
  minCandles: 50,
  staleAfterMs: 300_000,
  staleHardMs: 3_600_000,
  maxMovePct: 0.2,
} as const;

/** Derive the coarse grade from a score + pass flag. */
export function gradeFor(score: number, pass: boolean): DataQuality {
  if (!pass) return "insufficient";
  return score >= 85 ? "good" : "degraded";
}

export class DataQualityEngine {
  private readonly store: CandleStore;
  private readonly tfm: TimeframeManager;

  constructor(deps: { candleStore?: CandleStore; timeframeManager?: TimeframeManager } = {}) {
    this.tfm = deps.timeframeManager ?? new TimeframeManager();
    this.store = deps.candleStore ?? new CandleStore({ timeframeManager: this.tfm });
  }

  /**
   * Evaluate a raw series. Scores the RAW input (so source-side defects such
   * as duplicates and ordering are reflected) while using the normalized
   * series for spacing/staleness checks.
   */
  evaluate(raw: RawCandle[], timeframe: Timeframe, options: DataQualityOptions = {}): DataQualityReport {
    const threshold = options.threshold ?? DEFAULTS.threshold;
    const minCandles = options.minCandles ?? DEFAULTS.minCandles;
    const staleAfterMs = options.staleAfterMs ?? DEFAULTS.staleAfterMs;
    const staleHardMs = options.staleHardMs ?? DEFAULTS.staleHardMs;
    const maxMovePct = options.maxMovePct ?? DEFAULTS.maxMovePct;

    const tfMs = this.tfm.durationMs(timeframe);
    const norm = this.store.normalize(raw, timeframe);
    const candles = norm.candles;

    const issues: DataQualityIssue[] = [];
    const add = (code: DataQualityIssue["code"], message: string, count: number, penalty: number): void => {
      issues.push({ code, message, count, penalty });
    };

    // --- Source-side defects (measured on raw input) ---------------------
    if (norm.duplicatesRemoved > 0) {
      add(
        "duplicate_candles",
        `${norm.duplicatesRemoved} duplicate timestamp(s) collapsed.`,
        norm.duplicatesRemoved,
        Math.min(norm.duplicatesRemoved * 2, 20),
      );
    }
    if (norm.reOrdered > 0) {
      add(
        "out_of_order",
        `${norm.reOrdered} candle(s) were not in chronological order.`,
        norm.reOrdered,
        Math.min(norm.reOrdered * 2, 15),
      );
    }
    if (norm.invalidRemoved > 0) {
      add(
        "invalid_ohlc",
        `${norm.invalidRemoved} candle(s) failed OHLC validity and were dropped.`,
        norm.invalidRemoved,
        Math.min(norm.invalidRemoved * 3, 25),
      );
    }

    // --- Unrealistic values ---------------------------------------------
    let unrealistic = 0;
    for (const c of candles) {
      const rangePct = c.low > 0 ? (c.high - c.low) / c.low : Infinity;
      const bodyPct = c.open > 0 ? Math.abs(c.close - c.open) / c.open : Infinity;
      if (rangePct > maxMovePct || bodyPct > maxMovePct) unrealistic++;
    }
    if (unrealistic > 0) {
      add(
        "unrealistic_values",
        `${unrealistic} candle(s) exceeded the ${maxMovePct * 100}% move/range limit.`,
        unrealistic,
        Math.min(unrealistic * 3, 25),
      );
    }
    // --- Spacing: timestamp gaps + missing candles ------------------------
    if (candles.length >= 2) {
      let gaps = 0;
      for (let i = 1; i < candles.length; i++) {
        const delta = candles[i]!.openTime - candles[i - 1]!.openTime;
        if (delta !== tfMs) gaps++;
      }
      if (gaps > 0) {
        add(
          "timestamp_gaps",
          `${gaps} discontinuity(ies) in candle spacing (expected ${tfMs}ms).`,
          gaps,
          Math.min(gaps * 3, 20),
        );
      }

      const span = candles[candles.length - 1]!.openTime - candles[0]!.openTime;
      const expected = Math.round(span / tfMs) + 1;
      const missing = expected - candles.length;
      if (missing > 0) {
        const penalty = Math.min(Math.max(Math.round((missing / Math.max(expected, 1)) * 30), 1), 30);
        add("missing_candles", `${missing} of ${expected} candle(s) missing in the span.`, missing, penalty);
      }
    }

    // --- Staleness (only when an evaluation "now" is provided) ------------
    if (options.now !== undefined && candles.length > 0) {
      const age = options.now - candles[candles.length - 1]!.closeTime;
      if (age > staleAfterMs) {
        const hard = age > staleHardMs;
        add(
          "stale_candles",
          hard
            ? `Newest candle is ${Math.round(age / 1000)}s old (hard failure > ${staleHardMs / 1000}s).`
            : `Newest candle is ${Math.round(age / 1000)}s old (limit ${staleAfterMs / 1000}s).`,
          1,
          hard ? 60 : 25,
        );
      }
    }

    // --- Completeness -----------------------------------------------------
    if (candles.length < minCandles) {
      add(
        "incomplete_data",
        `Only ${candles.length} valid candle(s); at least ${minCandles} required.`,
        minCandles - candles.length,
        40,
      );
    }

    // --- Score ------------------------------------------------------------
    let score = 100;
    for (const issue of issues) score -= issue.penalty;
    if (score < 0) score = 0;
    if (score > 100) score = 100;

    const pass = score >= threshold;
    const grade = gradeFor(score, pass);

    return {
      score,
      grade,
      threshold,
      pass,
      issues,
      evaluatedCount: norm.inputCount,
      acceptedCount: norm.candles.length,
    };
  }
}

