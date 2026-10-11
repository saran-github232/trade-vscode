/**
 * BreakoutEngine — range-break detection with failure confirmation.
 *
 * Breakout = close beyond the N-bar range edge by >= 0.25 ATR.
 * Failed breakout = broke intraday but closed back inside (bull/bear trap).
 * Confirmation needs a follow-through bar; without it the score is halved.
 */

import type { Candle, IndicatorSet } from "../types/market.js";
import type { TechnicalEvent } from "../types/technical.js";
import { clampScore, neutral, type EngineResult } from "./utils.js";

export interface BreakoutResult extends EngineResult {
  events: TechnicalEvent[];
}

const RANGE = 20;

export class BreakoutEngine {
  analyze(candles: Candle[], ind: IndicatorSet): BreakoutResult {
    if (candles.length < RANGE + 3) {
      const n = neutral("breakout_neutral", "Breakout needs >= 23 candles");
      return { ...n, events: [] };
    }
    const basis = candles.slice(candles.length - RANGE - 2, candles.length - 2);
    let rh = -Infinity;
    let rl = Infinity;
    for (const c of basis) {
      if (c.high > rh) rh = c.high;
      if (c.low < rl) rl = c.low;
    }
    const band = Math.max(1e-9, ind.atr14 ?? (rh - rl) / 14);
    const last = candles[candles.length - 1] as Candle;
    const prev = candles[candles.length - 2] as Candle;
    const evidence: BreakoutResult["evidence"] = [];
    const events: TechnicalEvent[] = [];
    let score = 0;

    const upBreak = last.close > rh + band * 0.25;
    const downBreak = last.close < rl - band * 0.25;
    const upWickFail = last.high > rh + band * 0.25 && last.close <= rh;
    const downWickFail = last.low < rl - band * 0.25 && last.close >= rl;

    if (upBreak) {
      const follow = prev.close > rh ? 1 : 0.5;
      score = clampScore(0.8 * follow + 0.2 * Math.min(1, (last.close - rh) / band));
      events.push({ kind: "breakout", bias: 1, detail: `Bullish breakout: close ${last.close.toFixed(4)} above range high ${rh.toFixed(4)} (+${((last.close - rh) / band).toFixed(2)} ATR).` });
      evidence.push({ kind: "breakout_bullish", detail: `Close broke ${RANGE}-bar high ${rh.toFixed(4)} by +${((last.close - rh) / band).toFixed(2)} ATR${follow < 1 ? " (no follow-through yet — halved)" : " with follow-through"}.` });
    } else if (downBreak) {
      const follow = prev.close < rl ? 1 : 0.5;
      score = clampScore(-(0.8 * follow + 0.2 * Math.min(1, (rl - last.close) / band)));
      events.push({ kind: "breakout", bias: -1, detail: `Bearish breakout: close ${last.close.toFixed(4)} below range low ${rl.toFixed(4)} (-${((rl - last.close) / band).toFixed(2)} ATR).` });
      evidence.push({ kind: "breakout_bearish", detail: `Close broke ${RANGE}-bar low ${rl.toFixed(4)} by -${((rl - last.close) / band).toFixed(2)} ATR${follow < 1 ? " (no follow-through yet — halved)" : " with follow-through"}.` });
    } else if (upWickFail) {
      score = clampScore(-0.55);
      events.push({ kind: "failed_breakout", bias: -1, detail: `Failed bullish breakout: wicked above ${rh.toFixed(4)} but closed back at ${last.close.toFixed(4)} (bull trap).` });
      evidence.push({ kind: "failed_breakout_bull_trap", detail: `Bull trap: high wicked +${((last.high - rh) / band).toFixed(2)} ATR above range but closed inside.` });
    } else if (downWickFail) {
      score = clampScore(0.55);
      events.push({ kind: "failed_breakout", bias: 1, detail: `Failed bearish breakout: wicked below ${rl.toFixed(4)} but closed back at ${last.close.toFixed(4)} (bear trap).` });
      evidence.push({ kind: "failed_breakout_bear_trap", detail: `Bear trap: low wicked -${((rl - last.low) / band).toFixed(2)} ATR below range but closed inside.` });
    } else {
      evidence.push({ kind: "range_contained", detail: `Price contained in ${RANGE}-bar range ${rl.toFixed(4)}–${rh.toFixed(4)}; no breakout.` });
    }
    return { score, evidence, events };
  }
}
