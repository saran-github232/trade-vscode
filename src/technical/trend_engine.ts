/**
 * TrendEngine — EMA alignment + SMA structure + ADX strength + VWAP bias.
 *
 * Each input is ONE vote; the score is the mean of available votes.
 * ADX < 20 weakens conviction toward 0 (no trend to follow).
 */

import type { Candle, IndicatorSet } from "../types/market.js";
import type { TrendState } from "../types/technical.js";
import { atrDistance, clampScore, lastClose, neutral, sign, type EngineResult } from "./utils.js";

export interface TrendResult extends EngineResult {
  state: TrendState;
}

export class TrendEngine {
  analyze(candles: Candle[], ind: IndicatorSet): TrendResult {
    const price = lastClose(candles);
    if (price === null || candles.length < 30) {
      return { ...neutral("trend_neutral", "Trend needs >= 30 candles"), state: "SIDEWAYS" };
    }
    const votes: number[] = [];
    const evidence: { kind: string; detail: string }[] = [];

    // 1. EMA12/EMA26 alignment (fast vs slow).
    if (ind.ema12 !== null && ind.ema26 !== null) {
      const v = sign(ind.ema12 - ind.ema26);
      votes.push(v);
      evidence.push({
        kind: v > 0 ? "positive_ema_alignment" : v < 0 ? "negative_ema_alignment" : "ema_flat",
        detail: `EMA12 ${ind.ema12.toFixed(4)} vs EMA26 ${ind.ema26.toFixed(4)} (${v > 0 ? "bullish stack" : v < 0 ? "bearish stack" : "flat"}).`,
      });
    }
    // 2. Price vs SMA20/SMA50 structure.
    if (ind.sma20 !== null && ind.sma50 !== null) {
      const v = sign(price - ind.sma20) * 0.5 + sign(ind.sma20 - ind.sma50) * 0.5;
      votes.push(clampScore(v));
      evidence.push({
        kind: v > 0 ? "price_above_trend" : v < 0 ? "price_below_trend" : "price_at_trend",
        detail: `Close ${price.toFixed(4)} vs SMA20 ${ind.sma20.toFixed(4)} / SMA50 ${ind.sma50.toFixed(4)}.`,
      });
    }
    // 3. ADX directional pressure (+DI vs -DI), strength-gated.
    if (ind.adx14 !== null) {
      const { adx: adxV, plusDI, minusDI } = ind.adx14;
      const dir = sign(plusDI - minusDI);
      const strength = Math.min(1, adxV / 25);
      votes.push(clampScore(dir * (0.4 + 0.6 * strength)));
      evidence.push({
        kind: dir > 0 ? "positive_di_pressure" : dir < 0 ? "negative_di_pressure" : "di_balanced",
        detail: `ADX ${adxV.toFixed(1)} (+DI ${plusDI.toFixed(1)} / -DI ${minusDI.toFixed(1)}).`,
      });
    }
    // 4. VWAP bias where volume exists.
    if (ind.vwap !== null) {
      const d = atrDistance(price, ind.vwap, ind.atr14);
      const v = clampScore(d / 2);
      votes.push(v);
      evidence.push({
        kind: v > 0 ? "price_above_vwap" : v < 0 ? "price_below_vwap" : "price_at_vwap",
        detail: `Close ${price.toFixed(4)} vs VWAP ${ind.vwap.toFixed(4)}.`,
      });
    }

    if (votes.length === 0) return { ...neutral("trend_neutral", "No trend inputs available"), state: "SIDEWAYS" };
    let score = clampScore(votes.reduce((a, b) => a + b, 0) / votes.length);
    // Weak ADX mutes the score: no measurable trend => no conviction.
    if (ind.adx14 !== null && ind.adx14.adx < 20) score = clampScore(score * (ind.adx14.adx / 20));

    const abs = Math.abs(score);
    const agree = votes.filter((v) => sign(v) === sign(score) && v !== 0).length;
    const conflicted = agree < votes.length - 1;
    const state: TrendState =
      abs < 0.15 ? "SIDEWAYS" : conflicted && abs < 0.45 ? "TRANSITION" : score > 0 ? "BULLISH" : "BEARISH";
    evidence.push({ kind: "trend_state", detail: `Trend state ${state} (score ${score.toFixed(2)}, ${agree}/${votes.length} votes agree).` });
    return { score, evidence, state };
  }
}
