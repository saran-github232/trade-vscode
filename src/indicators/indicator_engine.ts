/**
 * IndicatorEngine — the class facade over indicator math.
 *
 * Given candles, produce the full IndicatorSet. Missing history yields
 * nulls (fail-closed), never fabricated values.
 */

import type { Candle, IndicatorSet } from "../types/market.js";
import { adx, atr, bollinger, ema, macd, momentum, roc, rsi, sma, stochastic, volatility, vwap } from "./indicator_math.js";

export class IndicatorEngine {
  /** Compute indicators from a candle series (oldest first). */
  compute(candles: Candle[]): IndicatorSet {
    const closes = candles.map((c) => c.close);
    return {
      sma20: sma(closes, 20),
      sma50: sma(closes, 50),
      ema12: ema(closes, 12),
      ema26: ema(closes, 26),
      rsi14: rsi(closes, 14),
      macd: macd(closes),
      bollinger: bollinger(closes, 20),
      atr14: atr(candles, 14),
      adx14: adx(candles, 14),
      stoch: stochastic(candles, 14, 3),
      roc12: roc(closes, 12),
      mom10: momentum(closes, 10),
      volatility20: volatility(closes, 20),
      vwap: vwap(candles),
    };
  }
}
