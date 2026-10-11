/**
 * PullbackEngine — with-trend retracement vs against-trend reversal.
 *
 * A pullback = counter-trend move of 2-4 bars against a 20-bar trend bias
 * that holds the EMA12 zone and resumes in the trend direction on the last
 * bar. Deeper/longer moves are flagged as potential reversals instead.
 */

import type { Candle, IndicatorSet } from "../types/market.js";
import type { TechnicalEvent } from "../types/technical.js";
import { clampScore, neutral, sign, type EngineResult } from "./utils.js";

export interface PullbackResult extends EngineResult {
  events: TechnicalEvent[];
}

export class PullbackEngine {
  analyze(candles: Candle[], ind: IndicatorSet): PullbackResult {
    if (candles.length < 25 || ind.ema12 === null || ind.ema26 === null) {
      const n = neutral("pullback_neutral", "Pullback needs >= 25 candles + EMA12/26");
      return { ...n, events: [] };
    }
    const trendDir = sign(ind.ema12 - ind.ema26);
    const evidence: PullbackResult["evidence"] = [];
    const events: TechnicalEvent[] = [];
    if (trendDir === 0) {
      return { score: 0, evidence: [{ kind: "pullback_none", detail: "EMAs flat — no trend to pull back to." }], events };
    }
    // Count consecutive counter-trend closes before the last bar.
    let counter = 0;
    for (let i = candles.length - 2; i >= Math.max(1, candles.length - 7); i--) {
      const c = candles[i] as Candle;
      const p = candles[i - 1] as Candle;
      const down = c.close < p.close;
      if ((trendDir > 0 && down) || (trendDir < 0 && !down)) counter++;
      else break;
    }
    const last = candles[candles.length - 1] as Candle;
    const resumed = trendDir > 0 ? last.close > last.open : last.close < last.open;
    const band = Math.max(1e-9, ind.atr14 ?? Math.abs(last.close - ind.ema12));
    const nearEma = Math.abs(last.low - ind.ema12) <= band || (trendDir > 0 ? last.low <= ind.ema12 && last.close > ind.ema12 : last.high >= ind.ema12 && last.close < ind.ema12);

    if (counter >= 1 && counter <= 4 && nearEma && resumed) {
      const score = clampScore(trendDir * (0.5 + 0.1 * counter));
      events.push({ kind: "pullback", bias: trendDir > 0 ? 1 : -1, detail: `${counter}-bar pullback to EMA12 held and resumed ${trendDir > 0 ? "up" : "down"}.` });
      evidence.push({ kind: trendDir > 0 ? "pullback_bullish" : "pullback_bearish", detail: `${counter}-bar counter-trend dip held EMA12 ${ind.ema12.toFixed(4)}; last bar resumed trend.` });
      return { score, evidence, events };
    }
    if (counter >= 5) {
      const score = clampScore(-trendDir * 0.5);
      events.push({ kind: "pullback_failed", bias: trendDir > 0 ? -1 : 1, detail: `${counter}-bar counter-trend run too deep — possible reversal, not a pullback.` });
      evidence.push({ kind: "pullback_failed", detail: `Counter-trend move extended ${counter} bars — treating as reversal risk, not entry.` });
      return { score, evidence, events };
    }
    return { score: 0, evidence: [{ kind: "pullback_none", detail: `No pullback pattern (counter bars: ${counter}, at EMA: ${nearEma ? "yes" : "no"}).` }], events };
  }
}
