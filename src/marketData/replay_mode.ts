/**
 * ReplayMode — feeds historical candles through the EXACT same
 * MarketSnapshotBuilder used by live analysis.
 *
 * This is the anti-drift mechanism: because replay and live share one
 * builder instance and one feature-generation pipeline, a backtest cannot
 * silently diverge from production. Identical windows yield identical
 * feature vectors and identical snapshotIds (given identical timestamps).
 *
 * No `now` clock is passed, so historical data is never penalized for age.
 */

import type { Candle, CandleSource, MarketSnapshot, Timeframe } from "../types/market.js";
import { MarketSnapshotBuilder } from "./market_snapshot_builder.js";

export interface ReplayOptions {
  asset: string;
  timeframe: Timeframe;
  /** First index to build from (inclusive). Default: first candle. */
  start?: number;
  /** Last index to build (inclusive). Default: final candle. */
  end?: number;
  /** Source tag stamped on replay snapshots. Default "replay". */
  source?: CandleSource;
  /**
   * Snapshot timestamp per step. Default: the window's last closeTime.
   * BacktestingEngine passes its own offset — features are unaffected.
   */
  timestampAt?: (window: Candle[], index: number) => number;
}

export interface ReplayStep {
  /** Index of the newest candle in the window. */
  index: number;
  /** candles[0..index] — exactly the window live analysis would see. */
  window: Candle[];
  snapshot: MarketSnapshot;
  /** Ordered ML feature vector produced by the shared pipeline. */
  features: number[];
}

export class ReplayMode {
  constructor(private readonly builder: MarketSnapshotBuilder) {}

  /** Replay a single window — used to prove live === replay parity. */
  buildAt(candles: Candle[], index: number, opts: ReplayOptions): ReplayStep {
    const window = candles.slice(0, index + 1);
    const last = window[window.length - 1];
    const timestamp = opts.timestampAt ? opts.timestampAt(window, index) : (last?.closeTime ?? 0);

    const snapshot = this.builder.build({
      asset: opts.asset,
      timeframe: opts.timeframe,
      candles: window,
      timestamp,
      source: opts.source ?? "replay",
    });

    return { index, window, snapshot, features: this.builder.featureVector(snapshot) };
  }

  /** Replay a contiguous range of historical windows (oldest first). */
  run(candles: Candle[], opts: ReplayOptions): ReplayStep[] {
    const start = opts.start ?? 0;
    const end = opts.end ?? candles.length - 1;
    const steps: ReplayStep[] = [];
    for (let i = start; i <= end; i++) {
      steps.push(this.buildAt(candles, i, opts));
    }
    return steps;
  }
}
