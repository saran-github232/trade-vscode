/**
 * SwingStructureEngine — fractal pivots + HH/HL/LH/LL classification.
 *
 * A swing high (low) is the highest high (lowest low) in a +/-3 window.
 * Labels compare each swing to the previous same-kind swing.
 */

import type { Candle } from "../types/market.js";
import type { SwingLabel, SwingPoint } from "../types/technical.js";
import { clampScore, type EngineResult } from "./utils.js";

const PIVOT = 3;

export interface SwingResult extends EngineResult {
  highs: SwingPoint[];
  lows: SwingPoint[];
}

function findSwings(candles: Candle[]): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  for (let i = PIVOT; i < candles.length - PIVOT; i++) {
    const c = candles[i] as Candle;
    let isHigh = true;
    let isLow = true;
    for (let j = i - PIVOT; j <= i + PIVOT; j++) {
      if (j === i) continue;
      const o = candles[j] as Candle;
      if (o.high > c.high) isHigh = false;
      if (o.low < c.low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, time: c.openTime, price: c.high, kind: "high", label: null });
    if (isLow) lows.push({ index: i, time: c.openTime, price: c.low, kind: "low", label: null });
  }
  const labelSeq = (pts: SwingPoint[], up: SwingLabel, down: SwingLabel): void => {
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1] as SwingPoint;
      const cur = pts[i] as SwingPoint;
      cur.label = cur.price > prev.price ? up : cur.price < prev.price ? down : prev.label;
    }
  };
  labelSeq(highs, "HH", "LH");
  labelSeq(lows, "HL", "LL");
  return { highs, lows };
}

export class SwingStructureEngine {
  analyze(candles: Candle[]): SwingResult {
    if (candles.length < PIVOT * 2 + 5) {
      return { score: 0, evidence: [{ kind: "structure_neutral", detail: "Structure needs >= 11 candles — neutral." }], highs: [], lows: [] };
    }
    const { highs, lows } = findSwings(candles);
    const evidence: { kind: string; detail: string }[] = [];
    let bull = 0;
    let bear = 0;
    const lastHigh = highs[highs.length - 1];
    const lastLow = lows[lows.length - 1];
    if (lastHigh?.label === "HH") {
      bull++;
      evidence.push({ kind: "higher_high", detail: `Higher high at ${lastHigh.price.toFixed(4)} (bar ${lastHigh.index}).` });
    } else if (lastHigh?.label === "LH") {
      bear++;
      evidence.push({ kind: "lower_high", detail: `Lower high at ${lastHigh.price.toFixed(4)} (bar ${lastHigh.index}).` });
    }
    if (lastLow?.label === "HL") {
      bull++;
      evidence.push({ kind: "higher_low", detail: `Higher low at ${lastLow.price.toFixed(4)} (bar ${lastLow.index}).` });
    } else if (lastLow?.label === "LL") {
      bear++;
      evidence.push({ kind: "lower_low", detail: `Lower low at ${lastLow.price.toFixed(4)} (bar ${lastLow.index}).` });
    }
    if (evidence.length === 0) {
      evidence.push({ kind: "structure_neutral", detail: "No labeled swings yet — neutral structure." });
    }
    const total = bull + bear;
    const score = total === 0 ? 0 : clampScore((bull - bear) / total);
    return { score, evidence, highs, lows };
  }
}
