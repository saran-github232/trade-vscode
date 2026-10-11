/**
 * CandleStructureEngine — body/wing anatomy of the last 3 bars.
 *
 * Scores engulfing, pin-bar rejections, 3-bar streaks and indecision
 * (doji). Informational patterns produce 0 score but still emit evidence
 * so the facade sees them.
 */

import type { Candle } from "../types/market.js";
import { clampScore, neutral, type EngineResult } from "./utils.js";

function body(c: Candle): number {
  return Math.abs(c.close - c.open);
}

export class CandleStructureEngine {
  analyze(candles: Candle[]): EngineResult {
    if (candles.length < 3) return neutral("candle_neutral", "Candles need >= 3 bars");
    const evidence: EngineResult["evidence"] = [];
    let score = 0;
    const a = candles[candles.length - 3] as Candle;
    const b = candles[candles.length - 2] as Candle;
    const last = candles[candles.length - 1] as Candle;
    const bull = (c: Candle): boolean => c.close > c.open;

    // Engulfing (needs a real body, not a doji).
    const r = last.high - last.low;
    const bodyOk = r > 0 && body(last) / r > 0.3;
    if (bodyOk && !bull(b) && bull(last) && last.close >= b.open && last.open <= b.close) {
      score += 0.5;
      evidence.push({ kind: "bullish_engulfing", detail: "Bullish engulfing: body consumed prior down bar." });
    } else if (bodyOk && bull(b) && !bull(last) && last.close <= b.open && last.open >= b.close) {
      score -= 0.5;
      evidence.push({ kind: "bearish_engulfing", detail: "Bearish engulfing: body consumed prior up bar." });
    }

    // Pin bars (long wick rejection).
    if (r > 0) {
      const lowerWick = Math.min(last.open, last.close) - last.low;
      const upperWick = last.high - Math.max(last.open, last.close);
      if (lowerWick / r > 0.6) {
        score += 0.35;
        evidence.push({ kind: "bullish_pin", detail: `Bullish pin: lower wick ${((lowerWick / r) * 100).toFixed(0)}% of range rejects lows.` });
      }
      if (upperWick / r > 0.6) {
        score -= 0.35;
        evidence.push({ kind: "bearish_pin", detail: `Bearish pin: upper wick ${((upperWick / r) * 100).toFixed(0)}% of range rejects highs.` });
      }
      if (body(last) / r < 0.1) {
        evidence.push({ kind: "indecision", detail: "Doji-like indecision: body < 10% of range." });
      }
    }

    // 3-bar streaks (continuation pressure, capped).
    if (bull(a) && bull(b) && bull(last)) {
      score += 0.25;
      evidence.push({ kind: "up_streak", detail: "Three consecutive bullish closes." });
    } else if (!bull(a) && !bull(b) && !bull(last)) {
      score -= 0.25;
      evidence.push({ kind: "down_streak", detail: "Three consecutive bearish closes." });
    }

    if (evidence.length === 0) {
      evidence.push({ kind: "candle_neutral", detail: "No decisive candle pattern on the last bars." });
    }
    return { score: clampScore(score), evidence };
  }
}
