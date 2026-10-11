/**
 * Phase 3 tests, part 3 — facade verdicts, edge cases, snapshot wiring.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { TechnicalAnalysisEngine } from "../technical/technical_analysis_engine.js";
import { MarketSnapshotBuilder } from "../marketData/market_snapshot_builder.js";
import { T0, downtrend, engine, flat, mkCandles, uptrend } from "./technical.test.js";

test("facade is explainable: UP on uptrend with agreeing engines", () => {
  const t = new TechnicalAnalysisEngine();
  const candles = uptrend(80);
  const out = t.analyze(candles, engine().compute(candles));
  assert.equal(out.direction, "UP");
  assert.equal(out.trendState, "BULLISH");
  assert.ok(out.score > 0);
  assert.ok(out.complete);
  assert.ok(out.evidence.length >= 5);
  for (const k of ["trendScore", "momentumScore", "volatilityScore", "structureScore", "supportScore", "resistanceScore", "breakoutScore", "candleScore"] as const) {
    assert.ok(Number.isFinite(out.scores[k]), k);
  }
  assert.ok(out.evidence.some((x) => x.kind === "trend:positive_ema_alignment"));
});

test("facade says DOWN on downtrend, muted on chop", () => {
  const t = new TechnicalAnalysisEngine();
  const down = t.analyze(downtrend(80), engine().compute(downtrend(80)));
  assert.equal(down.direction, "DOWN");
  const chop = mkCandles(Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i) * 0.3));
  const c = t.analyze(chop, engine().compute(chop));
  assert.ok(Math.abs(c.score) < 0.5);
});

test("facade is deterministic for identical inputs", () => {
  const t = new TechnicalAnalysisEngine();
  const candles = uptrend(70);
  const a = t.analyze(candles, engine().compute(candles));
  const b = t.analyze(candles, engine().compute(candles));
  assert.deepEqual(a, b);
});

test("edge: empty/short/flat/zero-price fail closed", () => {
  const t = new TechnicalAnalysisEngine();
  assert.equal(t.analyze([], engine().compute([])).direction, "NO_TRADE");
  const short = mkCandles([1, 2, 3]);
  const s = t.analyze(short, engine().compute(short));
  assert.equal(s.direction, "NO_TRADE");
  assert.equal(s.complete, false);
  const f = t.analyze(flat(80), engine().compute(flat(80)));
  assert.ok(Math.abs(f.score) < 0.3);
  const zero = t.analyze(mkCandles(Array(80).fill(0)), engine().compute(mkCandles(Array(80).fill(0))));
  assert.equal(zero.direction, "NO_TRADE");
});

test("snapshot carries the Phase 3 verdict + features_v2", () => {
  const b = new MarketSnapshotBuilder();
  const candles = uptrend(80).map((c) => ({ ...c, timestamp: c.openTime }));
  const snap = b.build({ asset: "EURUSD", timeframe: "5m", candles, timestamp: T0 });
  assert.equal(snap.featureVersion, "features_v2");
  assert.equal(snap.technical.direction, "UP");
  assert.ok(snap.technical.evidence.length >= 5);
  assert.ok(Number.isFinite(snap.technicalFeatures.trendScore));
  assert.equal(b.featureVector(snap).length, 14);
});
