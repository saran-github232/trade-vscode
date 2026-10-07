/**
 * MarketRegimeEngine — classifies the current market regime.
 *
 * Pure and rule-based: uses volatility and directional slope to bucket the
 * market into trending_up / trending_down / ranging / volatile / unknown.
 */

import type { Candle, MarketRegime } from "../types/market.js";
import { ema, stddev } from "../indicators/indicator_math.js";

/** Fraction of window returns that are positive (directional bias). */
function upRatio(closes: number[]): number {
  if (closes.length < 2) return 0.5;
  let up = 0;
  let total = 0;
  for (let i = 1; i < closes.length; i++) {
    total++;
    if ((closes[i] as number) > (closes[i - 1] as number)) up++;
  }
  return total === 0 ? 0.5 : up / total;
}

export class MarketRegimeEngine {
  /**
   * Classify regime from recent candles.
   * @param candles - oldest first
   * @param currentVolatility - realized volatility from the feature engine
   */
  classify(candles: Candle[], currentVolatility: number): MarketRegime {
    const closes = candles.map((c) => c.close);
    if (closes.length < 30) return "unknown";

    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const prev = closes[i - 1] as number;
      const cur = closes[i] as number;
      returns.push(prev === 0 ? 0 : (cur - prev) / prev);
    }
    const vol = currentVolatility > 0 ? currentVolatility : stddev(returns);

    // Volatility percentile relative to the window.
    const sorted = [...returns].map(Math.abs).sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    const isHighVol = vol > 0 && p90 > 0 && vol >= p90;

    const fast = ema(closes, 9);
    const slow = ema(closes, 21);
    if (fast === null || slow === null) return "unknown";

    const slope = slow === 0 ? 0 : (fast - slow) / slow;
    const bias = upRatio(closes);

    if (isHighVol && bias > 0.4 && bias < 0.6) return "volatile";
    if (slope > 0.001 && bias >= 0.55) return "trending_up";
    if (slope < -0.001 && bias <= 0.45) return "trending_down";
    return "ranging";
  }
}
