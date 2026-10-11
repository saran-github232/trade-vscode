/**
 * FeatureEngineeringEngine — derives normalized technical features.
 *
 * Produces the `TechnicalFeatures` object embedded in a MarketSnapshot and
 * the numeric feature vector consumed by MLInferenceEngine. Pure function.
 */

import type { Candle, IndicatorSet, TechnicalFeatures } from "../types/market.js";
import type { TechnicalScores } from "../types/technical.js";
import { stddev } from "../indicators/indicator_math.js";

/** Rescale RSI (0-100) to [-1, 1] with 50 -> 0. */
function rsiNorm(rsi: number | null): number {
  if (rsi === null) return 0;
  return (rsi - 50) / 50;
}

/** Zero Phase 3 scores (used when the technical verdict is unavailable). */
export const ZERO_TECHNICAL_SCORES: TechnicalScores = {
  trendScore: 0,
  momentumScore: 0,
  volatilityScore: 0,
  structureScore: 0,
  supportScore: 0,
  resistanceScore: 0,
  breakoutScore: 0,
  candleScore: 0,
};

export class FeatureEngineeringEngine {
  compute(candles: Candle[], indicators: IndicatorSet, scores: TechnicalScores = ZERO_TECHNICAL_SCORES): TechnicalFeatures {
    const closes = candles.map((c) => c.close);
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];

    // Realized volatility = std of log-ish returns over the window.
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const p = closes[i - 1] as number;
      const c = closes[i] as number;
      returns.push(p === 0 ? 0 : (c - p) / p);
    }
    const volatility = stddev(returns);

    const return1 = prev !== undefined && last !== undefined && prev !== 0 ? (last - prev) / prev : 0;

    const macdNorm =
      indicators.macd && last !== undefined && last !== 0
        ? indicators.macd.line / last
        : 0;

    // Range position over the last 20 candles [0, 1].
    const window = closes.slice(-20);
    const hi = Math.max(...window);
    const lo = Math.min(...window);
    const range = hi - lo;
    const rangePosition = range === 0 || last === undefined ? 0.5 : (last - lo) / range;

    const sma20Deviation =
      indicators.sma20 && indicators.sma20 !== 0 && last !== undefined
        ? (last - indicators.sma20) / indicators.sma20
        : 0;

    const complete =
      closes.length >= 50 &&
      indicators.sma20 !== null &&
      indicators.ema12 !== null &&
      indicators.rsi14 !== null;

    return {
      return1,
      macdNorm,
      rsiNorm: rsiNorm(indicators.rsi14),
      volatility,
      rangePosition,
      sma20Deviation,
      trendScore: scores.trendScore,
      momentumScore: scores.momentumScore,
      volatilityScore: scores.volatilityScore,
      structureScore: scores.structureScore,
      supportScore: scores.supportScore,
      resistanceScore: scores.resistanceScore,
      breakoutScore: scores.breakoutScore,
      candleScore: scores.candleScore,
      complete,
    };
  }

  /** Flatten features into the ordered numeric vector used by models. */
  toVector(f: TechnicalFeatures): number[] {
    return [
      f.return1,
      f.macdNorm,
      f.rsiNorm,
      f.volatility,
      f.rangePosition,
      f.sma20Deviation,
      f.trendScore,
      f.momentumScore,
      f.volatilityScore,
      f.structureScore,
      f.supportScore,
      f.resistanceScore,
      f.breakoutScore,
      f.candleScore,
    ];
  }
}
