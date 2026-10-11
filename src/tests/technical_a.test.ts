/**
 * Phase 3 tests, part 2a — trend / momentum / volatility / swing engines.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { TrendEngine } from "../technical/trend_engine.js";
import { MomentumEngine } from "../technical/momentum_engine.js";
import { VolatilityEngine } from "../technical/volatility_engine.js";
import { SwingStructureEngine } from "../technical/swing_structure_engine.js";
import { T0, TF, downtrend, engine, flat, mkCandles, range, uptrend } from "./technical.test.js";
import type { Candle } from "../types/market.js";

test("TrendEngine: BULLISH on uptrend, BEARISH on downtrend", () => {
  const e = new TrendEngine();
  const up = e.analyze(uptrend(), engine().compute(uptrend()));
  assert.equal(up.state, "BULLISH");
  assert.ok(up.score > 0.3);
  assert.ok(up.evidence.some((x) => x.kind === "positive_ema_alignment"));

  const down = e.analyze(downtrend(), engine().compute(downtrend()));
  assert.equal(down.state, "BEARISH");
  assert.ok(down.score < -0.3);

  const r = e.analyze(range(), engine().compute(range()));
  assert.ok(r.state === "SIDEWAYS" || r.state === "TRANSITION");
});

test("MomentumEngine: signs follow trend; lone RSI never rules", () => {
  const e = new MomentumEngine();
  const up = e.analyze(uptrend(), engine().compute(uptrend()));
  assert.ok(up.score > 0);
  const down = e.analyze(downtrend(), engine().compute(downtrend()));
  assert.ok(down.score < 0);
  const crash = mkCandles(Array.from({ length: 22 }, (_, i) => 100 - i));
  const m = e.analyze(crash, engine().compute(crash));
  assert.ok(m.score < 0.5);
});

test("VolatilityEngine: jumpy > flat", () => {
  const e = new VolatilityEngine();
  const f = e.analyze(flat(), engine().compute(flat()));
  assert.ok(f.score < 0.3);
  const jumpy = mkCandles(Array.from({ length: 60 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5)));
  const v = e.analyze(jumpy, engine().compute(jumpy));
  assert.ok(v.score > f.score);
});

test("SwingStructureEngine: stairs label HH/HL up, LL/LH down", () => {
  const e = new SwingStructureEngine();
  const mkStairs = (dir: 1 | -1): Candle[] => {
    const out: Candle[] = [];
    let p = 100;
    for (let s = 0; s < 8; s++) {
      for (let k = 0; k < 4; k++) {
        const c = p + dir * 0.6;
        out.push({ openTime: T0 + out.length * TF, closeTime: T0 + (out.length + 1) * TF, open: p, high: Math.max(p, c) + 0.05, low: Math.min(p, c) - 0.05, close: c, volume: 10 });
        p = c;
      }
      for (let k = 0; k < 3; k++) {
        const c = p - dir * 0.5;
        out.push({ openTime: T0 + out.length * TF, closeTime: T0 + (out.length + 1) * TF, open: p, high: Math.max(p, c) + 0.05, low: Math.min(p, c) - 0.05, close: c, volume: 10 });
        p = c;
      }
    }
    return out;
  };
  const up = e.analyze(mkStairs(1));
  assert.ok(up.evidence.some((x) => x.kind === "higher_high" || x.kind === "higher_low"));
  assert.ok(up.score >= 0);
  const down = e.analyze(mkStairs(-1));
  assert.ok(down.evidence.some((x) => x.kind === "lower_low" || x.kind === "lower_high"));
  assert.ok(down.score <= 0);
});
