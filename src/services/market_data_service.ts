/**
 * MarketDataService — assembles MarketSnapshot objects.
 *
 * Local-first: consumes candles from an injected source (the extension's
 * content script, a user import, or the built-in deterministic generator
 * used for paper trading and tests). No network calls are made here.
 */

import type { Candle, MarketSnapshot, Timeframe } from "../types/market.js";
import { IndicatorEngine } from "../indicators/indicator_engine.js";
import { FeatureEngineeringEngine } from "../ml/feature_engineering_engine.js";
import { MarketRegimeEngine } from "./market_regime_engine.js";

/** Data quality grading based on freshness and completeness. */
function gradeDataQuality(candles: Candle[], expected: number): MarketSnapshot["dataQuality"] {
  if (candles.length < expected) return "insufficient";
  if (candles.length < expected + 5) return "degraded";
  return "good";
}

export class MarketDataService {
  private readonly indicators = new IndicatorEngine();
  private readonly features = new FeatureEngineeringEngine();
  private readonly regime = new MarketRegimeEngine();

  /** Build a snapshot from a candle series (oldest first). */
  buildSnapshot(asset: string, timeframe: Timeframe, candles: Candle[], timestamp: number): MarketSnapshot {
    const indicatorSet = this.indicators.compute(candles);
    const technicalFeatures = this.features.compute(candles, indicatorSet);
    const volatility = technicalFeatures.volatility;
    const marketRegime = this.regime.classify(candles, volatility);
    const last = candles[candles.length - 1];

    return {
      asset,
      timestamp,
      timeframe,
      candles,
      currentPrice: last ? last.close : 0,
      indicators: indicatorSet,
      technicalFeatures,
      marketRegime,
      volatility,
      dataQuality: gradeDataQuality(candles, 50),
    };
  }

  /** Flatten a snapshot into the ordered ML feature vector. */
  featureVector(snapshot: MarketSnapshot): number[] {
    return this.features.toVector(snapshot.technicalFeatures);
  }
}

/**
 * Deterministic local candle generator for paper trading / demos / tests.
 * A seeded PRNG produces a bounded random walk — no external data needed.
 */
export function generateCandles(seed: number, count: number, startPrice = 100, timeframeMs = 300_000, startTime = 0): Candle[] {
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
