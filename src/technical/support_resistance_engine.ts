/**
 * SupportResistanceEngine — recent-range levels + reaction scoring.
 *
 * Levels come from the highest high / lowest low of the lookback window
 * (excluding the last 3 forming bars). Reactions are measured in ATR units:
 * a test that holds with a directional close scores toward its side.
 * Output polarity: supportScore +1 = bullish hold; resistanceScore +1 =
 * bearish hold (the facade subtracts it for the directional vote).
 */

import type { Candle, IndicatorSet } from "../types/market.js";
import type { PriceLevel, TechnicalEvent } from "../types/technical.js";
import { clampScore, neutral, type EngineResult } from "./utils.js";

export interface SRResult extends EngineResult {
  supportScore: number;
  resistanceScore: number;
  levels: { support: PriceLevel[]; resistance: PriceLevel[] };
  events: TechnicalEvent[];
}

const LOOKBACK = 40;
const SKIP = 3;

export class SupportResistanceEngine {
  analyze(candles: Candle[], ind: IndicatorSet): SRResult {
    if (candles.length < LOOKBACK + SKIP) {
      const n = neutral("sr_neutral", "S/R needs >= 43 candles");
      return { ...n, supportScore: 0, resistanceScore: 0, levels: { support: [], resistance: [] }, events: [] };
    }
    const window = candles.slice(candles.length - LOOKBACK - SKIP, candles.length - SKIP);
    let rh = -Infinity;
    let rl = Infinity;
    let touchesHi = 0;
    let touchesLo = 0;
    for (const c of window) {
      if (c.high > rh) rh = c.high;
      if (c.low < rl) rl = c.low;
    }
    const band = Math.max(1e-9, (ind.atr14 ?? (rh - rl) / 14));
    for (const c of window) {
      if (Math.abs(c.high - rh) <= band * 0.5) touchesHi++;
      if (Math.abs(c.low - rl) <= band * 0.5) touchesLo++;
    }
    const last = candles[candles.length - 1] as Candle;
    const prev = candles[candles.length - 2] as Candle;
    const evidence: SRResult["evidence"] = [];
    const events: TechnicalEvent[] = [];

    // Distance of the last low to support, and last high to resistance (ATR units).
    const distSup = (last.low - rl) / band;
    const distRes = (rh - last.high) / band;

    let supportScore = 0;
    let resistanceScore = 0;

    // Support side: tested (wick reached) -> held (close back above + bullish) or broken.
    if (distSup < 0.5) {
      const bullishClose = last.close > last.open;
      const held = last.close > rl && bullishClose;
      const broken = last.close < rl - band * 0.25;
      if (held) {
        supportScore = clampScore(0.6 + 0.4 * Math.min(1, (prev.close - prev.low) / band + 0.5));
        events.push({ kind: "support_rejection", bias: 1, detail: `Support rejection at ${rl.toFixed(4)} (wick ${(distSup).toFixed(2)} ATR, bullish close).` });
        evidence.push({ kind: "support_rejection", detail: `Support rejection at ${rl.toFixed(4)} with bullish close ${last.close.toFixed(4)}.` });
      } else if (broken) {
        supportScore = clampScore(-0.7);
        events.push({ kind: "support_test", bias: -1, detail: `Support ${rl.toFixed(4)} broken by close ${last.close.toFixed(4)}.` });
        evidence.push({ kind: "support_break", detail: `Close ${last.close.toFixed(4)} broke support ${rl.toFixed(4)}.` });
      } else {
        supportScore = clampScore(0.25);
        events.push({ kind: "support_test", bias: 0, detail: `Support test at ${rl.toFixed(4)} (indecisive close).` });
        evidence.push({ kind: "support_test", detail: `Support test at ${rl.toFixed(4)}; close ${last.close.toFixed(4)} indecisive.` });
      }
    } else {
      evidence.push({ kind: "support_clear", detail: `Price ${(distSup).toFixed(2)} ATR above support ${rl.toFixed(4)} (${touchesLo} touches).` });
    }

    // Resistance side: mirror image (holding = bearish pressure => +resistanceScore).
    if (distRes < 0.5) {
      const bearishClose = last.close < last.open;
      const held = last.close < rh && bearishClose;
      const broken = last.close > rh + band * 0.25;
      if (held) {
        resistanceScore = clampScore(0.6 + 0.4 * Math.min(1, (prev.high - prev.close) / band + 0.5));
        events.push({ kind: "resistance_rejection", bias: -1, detail: `Resistance rejection at ${rh.toFixed(4)} (wick ${(distRes).toFixed(2)} ATR, bearish close).` });
        evidence.push({ kind: "resistance_rejection", detail: `Resistance rejection at ${rh.toFixed(4)} with bearish close ${last.close.toFixed(4)}.` });
      } else if (broken) {
        resistanceScore = clampScore(-0.7);
        events.push({ kind: "resistance_test", bias: 1, detail: `Resistance ${rh.toFixed(4)} broken by close ${last.close.toFixed(4)}.` });
        evidence.push({ kind: "resistance_break", detail: `Close ${last.close.toFixed(4)} broke resistance ${rh.toFixed(4)}.` });
      } else {
        resistanceScore = clampScore(0.25);
        events.push({ kind: "resistance_test", bias: 0, detail: `Resistance test at ${rh.toFixed(4)} (indecisive close).` });
        evidence.push({ kind: "resistance_test", detail: `Resistance test at ${rh.toFixed(4)}; close ${last.close.toFixed(4)} indecisive.` });
      }
    } else {
      evidence.push({ kind: "resistance_clear", detail: `Price ${(distRes).toFixed(2)} ATR below resistance ${rh.toFixed(4)} (${touchesHi} touches).` });
    }

    return {
      score: clampScore((supportScore - resistanceScore) / 2),
      supportScore,
      resistanceScore,
      evidence,
      events,
      levels: {
        support: [{ price: rl, touches: touchesLo, status: supportScore > 0.3 ? "held" : supportScore < -0.3 ? "broken" : "tested" }],
        resistance: [{ price: rh, touches: touchesHi, status: resistanceScore > 0.3 ? "held" : resistanceScore < -0.3 ? "broken" : "tested" }],
      },
    };
  }
}
