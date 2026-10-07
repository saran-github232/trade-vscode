/**
 * TimeframeManager — canonical timeframe definitions, availability, and
 * exact-multiple aggregation for multi-timeframe analysis.
 *
 * Rule: only timeframes the underlying source actually provides are ever
 * "available". Unavailable timeframes are reported as unavailable and are
 * never fabricated. Aggregation from a finer timeframe is allowed only when
 * the target duration is an exact integer multiple of the source duration
 * (pure OHLC folding — no invented prices).
 */

import type { Candle, Timeframe } from "../types/market.js";

/** Canonical duration of every supported timeframe, in milliseconds. */
const DURATIONS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/** Ordered smallest -> largest, used for context chains. */
export const TIMEFRAMES_ASC: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];

/** A timeframe as declared available (or not) by a given source. */
export interface TimeframeAvailability {
  sourceId: string;
  available: Timeframe[];
}

export class TimeframeManager {
  /** All timeframes known to the system. */
  supported(): Timeframe[] {
    return [...TIMEFRAMES_ASC];
  }

  isValid(tf: string): tf is Timeframe {
    return Object.prototype.hasOwnProperty.call(DURATIONS, tf);
  }

  /** Duration in ms (throws for unknown timeframes — fail fast, never guess). */
  durationMs(tf: Timeframe): number {
    const d = DURATIONS[tf];
    if (d === undefined) throw new Error(`Unknown timeframe: ${tf}`);
    return d;
  }

  /** Floor a timestamp down to the timeframe's boundary (UTC-aligned). */
  alignDown(timestamp: number, tf: Timeframe): number {
    const d = this.durationMs(tf);
    return Math.floor(timestamp / d) * d;
  }

  // ---------------------------------------------------------------------
  // Source availability — nothing is assumed to exist unless declared.
  // ---------------------------------------------------------------------

  /** Timeframes strictly larger than `tf`, smallest first (context chain). */
  largerThan(tf: Timeframe): Timeframe[] {
    const i = TIMEFRAMES_ASC.indexOf(tf);
    return TIMEFRAMES_ASC.slice(i + 1);
  }

  /**
   * Select context timeframes from `candidates` keeping ONLY those the
   * source actually provides. Missing ones are returned in `unavailable`.
   */
  selectContext(
    primary: Timeframe,
    candidates: Timeframe[],
    provided: Timeframe[],
  ): { selected: Timeframe[]; unavailable: Timeframe[] } {
    const providedSet = new Set(provided);
    const selected: Timeframe[] = [];
    const unavailable: Timeframe[] = [];
    for (const tf of candidates) {
      if (tf === primary) continue;
      if (providedSet.has(tf)) selected.push(tf);
      else unavailable.push(tf);
    }
    // Keep context ordered smallest -> largest duration.
    selected.sort((a, b) => this.durationMs(a) - this.durationMs(b));
    return { selected, unavailable };
  }

  // ---------------------------------------------------------------------
  // Exact-multiple OHLC aggregation (deterministic, no invented prices).
  // ---------------------------------------------------------------------

  /**
   * Fold a finer-timeframe series into a coarser one.
   * Returns `null` (never fabricates) when:
   *  - the coarser duration is not an exact integer multiple of the finer, or
   *  - there are no candles to fold.
   */
  aggregate(candles: Candle[], from: Timeframe, to: Timeframe): Candle[] | null {
    if (candles.length === 0) return null;
    const fromMs = this.durationMs(from);
    const toMs = this.durationMs(to);
    if (toMs <= fromMs) return null;
    if (toMs % fromMs !== 0) return null;

    const factor = toMs / fromMs;
    const out: Candle[] = [];
    let bucket: Candle[] = [];

    const flush = (): void => {
      if (bucket.length === 0) return;
      const first = bucket[0]!;
      const last = bucket[bucket.length - 1]!;
      let high = -Infinity;
      let low = Infinity;
      let volume = 0;
      for (const c of bucket) {
        if (c.high > high) high = c.high;
        if (c.low < low) low = c.low;
        volume += c.volume;
      }
      out.push({
        openTime: first.openTime,
        closeTime: last.closeTime,
        open: first.open,
        high,
        low,
        close: last.close,
        volume,
      });
      bucket = [];
    };

    let bucketStart = this.alignDown(candles[0]!.openTime, to);
    for (const c of candles) {
      const start = this.alignDown(c.openTime, to);
      if (start !== bucketStart) {
        flush();
        bucketStart = start;
      }
      bucket.push(c);
      // Guard: a bucket holds at most `factor` finer candles.
      if (bucket.length >= factor) {
        flush();
        bucketStart = this.alignDown(c.openTime + fromMs, to);
      }
    }
    flush();
    return out;
  }
}
