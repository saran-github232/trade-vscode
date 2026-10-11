/**
 * TechnicalAnalysisEngine — facade combining the eight Phase 3 engines.
 *
 * Combination rule (never a single-indicator rule):
 *  - 7 directional votes (trend, momentum, structure, support, -resistance,
 *    breakout, pullback, candle) weighted by conviction.
 *  - Direction needs BOTH: |combined| >= 0.15 AND >= 3 of 8 engines agreeing
 *    in sign. Otherwise NO_TRADE.
 *  - Volatility never votes (non-directional); it is reported alongside.
 */

import type { Candle, IndicatorSet } from "../types/market.js";
import type { Direction } from "../types/market.js";
import type { TechnicalEvidence, TechnicalScores, TrendState } from "../types/technical.js";
import { TrendEngine } from "./trend_engine.js";
import { MomentumEngine } from "./momentum_engine.js";
import { VolatilityEngine } from "./volatility_engine.js";
import { SwingStructureEngine } from "./swing_structure_engine.js";
import { SupportResistanceEngine } from "./support_resistance_engine.js";
import { BreakoutEngine } from "./breakout_engine.js";
import { PullbackEngine } from "./pullback_engine.js";
import { CandleStructureEngine } from "./candle_structure_engine.js";
import { clampScore, sign } from "./utils.js";

const MIN_AGREE = 3;
const MIN_COMBINED = 0.15;

export class TechnicalAnalysisEngine {
  private readonly trend = new TrendEngine();
  private readonly momentum = new MomentumEngine();
  private readonly volatility = new VolatilityEngine();
  private readonly swing = new SwingStructureEngine();
  private readonly sr = new SupportResistanceEngine();
  private readonly breakout = new BreakoutEngine();
  private readonly pullback = new PullbackEngine();
  private readonly candle = new CandleStructureEngine();

  analyze(candles: Candle[], ind: IndicatorSet): TechnicalEvidence {
    const trend = this.trend.analyze(candles, ind);
    const momentum = this.momentum.analyze(candles, ind);
    const vol = this.volatility.analyze(candles, ind);
    const swing = this.swing.analyze(candles);
    const sr = this.sr.analyze(candles, ind);
    const breakout = this.breakout.analyze(candles, ind);
    const pullback = this.pullback.analyze(candles, ind);
    const candle = this.candle.analyze(candles);

    const scores: TechnicalScores = {
      trendScore: clampScore(trend.score),
      momentumScore: clampScore(momentum.score),
      volatilityScore: Math.min(1, Math.max(0, vol.score)),
      structureScore: clampScore(swing.score),
      supportScore: clampScore(sr.supportScore),
      resistanceScore: clampScore(sr.resistanceScore),
      breakoutScore: clampScore(breakout.score),
      candleScore: clampScore(candle.score),
    };

    // Directional votes: resistance pressure counts negative.
    const votes: { name: string; v: number }[] = [
      { name: "trend", v: scores.trendScore },
      { name: "momentum", v: scores.momentumScore },
      { name: "structure", v: scores.structureScore },
      { name: "support", v: scores.supportScore },
      { name: "resistance", v: -scores.resistanceScore },
      { name: "breakout", v: scores.breakoutScore },
      { name: "pullback", v: pullback.score },
      { name: "candle", v: scores.candleScore },
    ];
    const weights = [1.4, 1.2, 1.0, 1.0, 1.0, 1.1, 0.8, 0.7];
    let num = 0;
    let den = 0;
    for (let i = 0; i < votes.length; i++) {
      const w = weights[i] as number;
      num += (votes[i] as { v: number }).v * w;
      den += w;
    }
    const combined = clampScore(num / den);

    const agreeUp = votes.filter((x) => x.v > 0.1).length;
    const agreeDown = votes.filter((x) => x.v < -0.1).length;
    const agree = Math.max(agreeUp, agreeDown);
    const agreeSign = agreeUp >= agreeDown ? 1 : -1;

    let direction: Direction = "NO_TRADE";
    if (Math.abs(combined) >= MIN_COMBINED && agree >= MIN_AGREE && sign(combined) === agreeSign) {
      direction = combined > 0 ? "UP" : "DOWN";
    }

    const evidence: TechnicalEvidence["evidence"] = [];
    const pushAll = (src: { evidence: { kind: string; detail: string }[] }, prefix: string): void => {
      for (const e of src.evidence.slice(0, 3)) evidence.push({ kind: `${prefix}:${e.kind}`, detail: e.detail });
    };
    pushAll(trend, "trend");
    pushAll(momentum, "momentum");
    pushAll(swing, "structure");
    pushAll(sr, "sr");
    pushAll(breakout, "breakout");
    pushAll(pullback, "pullback");
    pushAll(candle, "candle");
    evidence.push({ kind: "volatility", detail: `Volatility magnitude ${scores.volatilityScore.toFixed(2)} (non-directional).` });
    evidence.push({
      kind: "technical_verdict",
      detail: `Combined ${combined.toFixed(2)} from 8 engines; ${agree}/8 agree ${agreeSign > 0 ? "bullish" : "bearish"} → ${direction}.`,
    });

    const events: TechnicalEvidence["events"] = [...sr.events, ...breakout.events, ...pullback.events];
    // Surface momentum regime markers from its evidence notes.
    if (momentum.evidence.some((e) => e.kind === "momentum_acceleration")) {
      events.push({ kind: "momentum_acceleration", bias: sign(combined) as -1 | 0 | 1, detail: "ROC and MACD histogram agree — momentum accelerating." });
    } else {
      events.push({ kind: "momentum_exhaustion", bias: 0, detail: "ROC/MACD disagree — watch for momentum exhaustion." });
    }

    const complete = candles.length >= 50;
    if (!complete) {
      return {
        direction: "NO_TRADE",
        score: 0,
        trendState: trend.state as TrendState,
        scores,
        evidence: [{ kind: "technical_insufficient", detail: "Technical verdict needs >= 50 candles — NO_TRADE." }, ...evidence],
        events,
        complete: false,
      };
    }
    return { direction, score: direction === "NO_TRADE" ? 0 : combined, trendState: trend.state, scores, evidence, events, complete: true };
  }
}
