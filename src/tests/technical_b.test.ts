/**
 * Phase 3 tests, part 2b — S/R, breakout, pullback, candle engines.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "../types/market.js";
import { SupportResistanceEngine } from "../technical/support_resistance_engine.js";
import { BreakoutEngine } from "../technical/breakout_engine.js";
import { PullbackEngine } from "../technical/pullback_engine.js";
import { CandleStructureEngine } from "../technical/candle_structure_engine.js";
import { T0, TF, engine, mkCandles } from "./technical.test.js";

test("SupportResistanceEngine: reacts to a range bounce", () => {
  const e = new SupportResistanceEngine();
  const closes = [...Array.from({ length: 44 }, () => 100), 99.2, 100.4];
  const candles = mkCandles(closes);
  candles[candles.length - 2] = { ...(candles[candles.length - 2] as Candle), low: 99.0, close: 99.2, open: 100 };
  const last = candles[candles.length - 1] as Candle;
  candles[candles.length - 1] = { ...last, open: 99.2, close: 100.4, high: 100.5, low: 99.1 };
  const r = e.analyze(candles, engine().compute(candles));
  assert.ok(r.supportScore > 0 || r.events.some((x) => x.kind === "support_test" || x.kind === "support_rejection"));
});

test("BreakoutEngine: breakout up, bull-trap flagged", () => {
  const e = new BreakoutEngine();
  const base = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 101 : 99));
  const breaking = mkCandles([...base, 102.5, 103]);
  const b = e.analyze(breaking, engine().compute(breaking));
  assert.ok(b.score > 0);
  assert.ok(b.events.some((x) => x.kind === "breakout"));

  const trap = mkCandles([...base, 100.5]);
  const t = trap[trap.length - 1] as Candle;
  trap[trap.length - 1] = { ...t, high: 103, close: 100.2, open: 100.8 };
  const f = e.analyze(trap, engine().compute(trap));
  assert.ok(f.events.some((x) => x.kind === "failed_breakout"));
  assert.ok(f.score < 0);
});

test("PullbackEngine: deep counter run is reversal risk", () => {
  const e = new PullbackEngine();
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 0.3);
  closes[28] = 107.2;
  closes[29] = 108.2;
  const r = e.analyze(mkCandles(closes), engine().compute(mkCandles(closes)));
  assert.ok(r.evidence.length > 0);
  const deep = Array.from({ length: 32 }, (_, i) => (i < 26 ? 100 + i * 0.3 : 107.8 - (i - 25) * 0.6));
  const rd = e.analyze(mkCandles(deep), engine().compute(mkCandles(deep)));
  assert.ok(rd.events.some((x) => x.kind === "pullback_failed") || rd.score <= 0);
});

test("CandleStructureEngine: engulfing up, pin detected", () => {
  const e = new CandleStructureEngine();
  const bull: Candle[] = [
    { openTime: T0, closeTime: T0 + TF, open: 100, high: 100.2, low: 99.5, close: 99.7, volume: 10 },
    { openTime: T0 + TF, closeTime: T0 + 2 * TF, open: 99.8, high: 100, low: 99.4, close: 99.6, volume: 10 },
    { openTime: T0 + 2 * TF, closeTime: T0 + 3 * TF, open: 99.5, high: 100.8, low: 99.4, close: 100.7, volume: 10 },
  ];
  assert.ok(e.analyze(bull).score > 0);
  const pin: Candle[] = [
    { openTime: T0, closeTime: T0 + TF, open: 100, high: 100.2, low: 99.8, close: 100, volume: 10 },
    { openTime: T0 + TF, closeTime: T0 + 2 * TF, open: 100, high: 100.2, low: 99.8, close: 100, volume: 10 },
    { openTime: T0 + 2 * TF, closeTime: T0 + 3 * TF, open: 101, high: 101.1, low: 99.0, close: 100.9, volume: 10 },
  ];
  assert.ok(e.analyze(pin).evidence.some((x) => x.kind === "bullish_pin"));
});
