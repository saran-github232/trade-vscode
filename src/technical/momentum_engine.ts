/**
 * MomentumEngine — RSI position, MACD histogram, stochastic cross, ROC.
 *
 * Deliberately NEVER uses a lone "RSI < 30 = UP" style rule: RSI is one of
 * four votes, and oversold/overbought zones only count when CONFIRMED by
 * another vote (MACD/stochastic/ROC agreeing in sign).
 */

import type { Candle, IndicatorSet } from "../types/market.js";
import { clampScore, lastClose, neutral, sign, type EngineResult } from "./utils.js";

export class MomentumEngine {
  analyze(candles: Candle[], ind: IndicatorSet): EngineResult {
    const price = lastClose(candles);
    if (price === null || candles.length < 20) {
      return neutral("momentum_neutral", "Momentum needs >= 20 candles");
    }
    const votes: number[] = [];
    const evidence: { kind: string; detail: string }[] = [];

    // 1. RSI: rescaled distance from neutral, zones need confirmation later.
    let rsiV = 0;
    let rsiZoned = false;
    if (ind.rsi14 !== null) {
      rsiV = clampScore((ind.rsi14 - 50) / 50);
      rsiZoned = ind.rsi14 < 30 || ind.rsi14 > 70;
      votes.push(clampScore(rsiV * 0.7));
      evidence.push({
        kind: ind.rsi14 > 55 ? "positive_momentum" : ind.rsi14 < 45 ? "negative_momentum" : "momentum_flat",
        detail: `RSI14 ${ind.rsi14.toFixed(1)} (${ind.rsi14 < 30 ? "oversold zone" : ind.rsi14 > 70 ? "overbought zone" : "neutral zone"}).`,
      });
    }
    // 2. MACD histogram: above/below signal + growing/shrinking.
    if (ind.macd !== null && price !== 0) {
      const h = clampScore(ind.macd.histogram / (Math.abs(price) * 0.002));
      votes.push(h);
      evidence.push({
        kind: h > 0 ? "macd_bullish" : h < 0 ? "macd_bearish" : "macd_flat",
        detail: `MACD histogram ${ind.macd.histogram.toFixed(4)} (line ${ind.macd.line.toFixed(4)} vs signal ${ind.macd.signal.toFixed(4)}).`,
      });
    }
    // 3. Stochastic %K vs %D cross.
    if (ind.stoch !== null) {
      const s = clampScore((ind.stoch.k - ind.stoch.d) / 25);
      votes.push(s);
      evidence.push({
        kind: s > 0 ? "stoch_bullish_cross" : s < 0 ? "stoch_bearish_cross" : "stoch_flat",
        detail: `Stochastic %K ${ind.stoch.k.toFixed(1)} vs %D ${ind.stoch.d.toFixed(1)}.`,
      });
    }
    // 4. ROC12 direction.
    if (ind.roc12 !== null) {
      const r = clampScore(ind.roc12 / 3);
      votes.push(r);
      evidence.push({
        kind: r > 0 ? "roc_positive" : r < 0 ? "roc_negative" : "roc_flat",
        detail: `ROC12 ${ind.roc12.toFixed(2)}%.`,
      });
    }

    if (votes.length === 0) return neutral("momentum_neutral", "No momentum inputs available");
    let score = clampScore(votes.reduce((a, b) => a + b, 0) / votes.length);
    // Anti single-rule guard: a lone RSI zone without confirmation is muted.
    const confirmers = votes.filter((v, i) => i > 0 && sign(v) === sign(rsiV) && v !== 0).length;
    if (rsiZoned && confirmers === 0) {
      score = clampScore(score * 0.4);
      evidence.push({ kind: "rsi_unconfirmed", detail: "RSI in extreme zone but unconfirmed by MACD/stochastic/ROC — conviction muted." });
    }

    // Acceleration / exhaustion markers (informational, feed TechnicalEvent).
    const accel = ind.roc12 !== null && ind.macd !== null && sign(ind.roc12) === sign(ind.macd.histogram) && ind.roc12 !== 0;
    evidence.push({
      kind: accel ? "momentum_acceleration" : "momentum_exhaustion_watch",
      detail: accel ? "ROC and MACD histogram agree — momentum accelerating." : "ROC/MACD disagree — watch for momentum exhaustion.",
    });
    return { score, evidence };
  }
}
