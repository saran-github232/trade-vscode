/**
 * MarketDataService — facade over the shared MarketSnapshotBuilder.
 *
 * Phase 2: this class no longer computes anything itself. It delegates to a
 * single MarketSnapshotBuilder instance so that live analysis, backtesting,
 * and replay all run through the identical feature-generation pipeline
 * (quality gate -> normalize -> indicators -> features -> regime).
 *
 * Local-first: consumes candles from an injected source (the extension's
 * content script, a user import, or the deterministic generator used for
 * paper trading and tests). No network calls are made here.
 */

import type { Candle, CandleSource, MarketSnapshot, Timeframe } from "../types/market.js";
import { MarketSnapshotBuilder } from "../marketData/market_snapshot_builder.js";
import { ReplayMode } from "../marketData/replay_mode.js";

export class MarketDataService {
  /** The single shared builder — live, backtest, and replay all use this. */
  readonly builder = new MarketSnapshotBuilder();

  /** Build a snapshot from a candle series (oldest first). */
  buildSnapshot(
    asset: string,
    timeframe: Timeframe,
    candles: Candle[],
    timestamp: number,
    source?: CandleSource,
  ): MarketSnapshot {
    return this.builder.build({
      asset,
      timeframe,
      candles,
      timestamp,
      ...(source !== undefined ? { source } : {}),
    });
  }

  /** Flatten a snapshot into the ordered ML feature vector. */
  featureVector(snapshot: MarketSnapshot): number[] {
    return this.builder.featureVector(snapshot);
  }

  /** Replay historical candles through this exact builder (shared pipeline). */
  replay(): ReplayMode {
    return new ReplayMode(this.builder);
  }
}

/**
 * Deterministic local candle generator for paper trading / demos / tests.
 * A seeded PRNG produces a bounded random walk — no external data needed.
 */
export function generateCandles(
  seed: number,
  count: number,
  startPrice = 100,
  timeframeMs = 300_000,
  startTime = 0,
): Candle[] {
  let state = seed >>> 0 || 1;
  const next = (): number => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };

  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const drift = (next() - 0.5) * startPrice * 0.01;
    const open = price;
    const close = Math.max(0.0001, open + drift);
    const wick = Math.abs(drift) * (0.5 + next());
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick;
    const openTime = startTime + i * timeframeMs;
    candles.push({
      openTime,
      closeTime: openTime + timeframeMs,
      open,
      high,
      low,
      close,
      volume: Math.round(100 + next() * 900),
    });
    price = close;
  }
  return candles;
}
