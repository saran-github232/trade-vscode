/**
 * VolatilityEngine — ATR level, Bollinger bandwidth, realized-vol percentile.
 *
 * Output is NON-directional magnitude in [0, 1]: 0 = compressed, 1 = extreme
 * expansion. Direction never comes from this engine.
 */

import type { Candle, IndicatorSet } from "../types/market.js";
import { neutral, type EngineResult } from "./utils.js";

export class VolatilityEngine {
  analyze(candles: Candle[], ind: IndicatorSet): EngineResult {
    if (candles.length < 25) return neutral("volatility_neutral", "Volatility needs >= 25 candles");
    const evidence: { kind: string; detail: string }[] = [];
    const parts: number[] = [];

    // 1. ATR as % of price.
    if (ind.atr14 !== null) {
      const price = candles[candles.length - 1]?.close ?? 0;
      const pct = price > 0 ? ind.atr14 / price : 0;
      const v = Math.min(1, pct / 0.02);
      parts.push(v);
      evidence.push({ kind: v > 0.6 ? "atr_expanded" : v < 0.25 ? "atr_compressed" : "atr_normal", detail: `ATR14 ${ind.atr14.toFixed(4)} (${(pct * 100).toFixed(2)}% of price).` });
    }
    // 2. Bollinger bandwidth as % of mid.
    if (ind.bollinger !== null && ind.bollinger.mid !== 0) {
      const bw = (ind.bollinger.upper - ind.bollinger.lower) / Math.abs(ind.bollinger.mid);
      const v = Math.min(1, bw / 0.08);
      parts.push(v);
      evidence.push({ kind: v > 0.6 ? "bands_expanded" : v < 0.25 ? "bands_squeezed" : "bands_normal", detail: `Bollinger bandwidth ${(bw * 100).toFixed(2)}% of mid.` });
    }
    // 3. Realized vol vs ATR-implied scale (expansion marker).
    const realized = ind.volatility20;
    if (realized > 0 && ind.atr14 !== null) {
      const price = candles[candles.length - 1]?.close ?? 0;
      const implied = price > 0 ? ind.atr14 / price / Math.sqrt(14) : 0;
      const ratio = implied > 0 ? realized / implied : 1;
      const v = Math.min(1, Math.max(0, (ratio - 0.5) / 1.5));
      parts.push(v);
      evidence.push({ kind: ratio > 1.5 ? "vol_expansion" : ratio < 0.7 ? "vol_compression" : "vol_normal", detail: `Realized vol ${realized.toFixed(5)} vs ATR-implied ${implied.toFixed(5)} (ratio ${ratio.toFixed(2)}).` });
    }

    if (parts.length === 0) return neutral("volatility_neutral", "No volatility inputs available");
    const score = Math.min(1, Math.max(0, parts.reduce((a, b) => a + b, 0) / parts.length));
    return { score, evidence };
  }
}
