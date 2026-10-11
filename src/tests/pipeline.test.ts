/**
 * End-to-end pipeline tests: candles -> snapshot -> signal -> analysis.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalysisService } from "../services/analysis_service.js";
import { generateCandles } from "../services/market_data_service.js";
import { MLInferenceEngine } from "../ml/ml_inference_engine.js";
import { SignalEngine } from "../services/signal_engine.js";
import { MarketDataService } from "../services/market_data_service.js";
import type { Timeframe } from "../types/market.js";

function candles(seed = 42) {
  return generateCandles(seed, 150, 100, 300_000, 1_700_000_000_000);
}

test("AnalysisService produces a valid Signal with UP/DOWN/NO_TRADE vocabulary", async () => {
  const svc = new AnalysisService({ defaultAsset: "EURUSD", defaultTimeframe: "5m" });
  const out = await svc.analyze(candles(), "EURUSD", "5m");

  assert.ok(["UP", "DOWN", "NO_TRADE"].includes(out.signal.direction));
  assert.ok(out.signal.score >= -1 && out.signal.score <= 1);
  assert.ok(out.signal.confidence >= 0 && out.signal.confidence <= 1);
  assert.equal(out.signal.timeframe, "5m");
  assert.ok(out.signal.modelVersion.length > 0);
  assert.ok(Array.isArray(out.signal.evidence));
  assert.ok(Array.isArray(out.signal.modelVotes));
});

test("confidence is NOT treated as a calibrated probability by default", async () => {
  const svc = new AnalysisService({ defaultAsset: "EURUSD", defaultTimeframe: "5m" });
  const out = await svc.analyze(candles(), "EURUSD", "5m");
  // No validated calibrator was supplied, so calibratedProbability must be absent.
  assert.equal(out.signal.calibratedProbability, undefined);
  assert.ok(out.signal.confidence > 0);
});

test("MarketSnapshot carries all required fields", async () => {
  const svc = new AnalysisService({ defaultAsset: "BTCUSD", defaultTimeframe: "5m" });
  const out = await svc.analyze(candles(99), "BTCUSD", "5m");
  const s = out.snapshot;
  assert.equal(s.asset, "BTCUSD");
  assert.ok(s.candles.length > 0);
  assert.equal(s.currentPrice, s.candles[s.candles.length - 1]?.close);
  assert.ok(s.technicalFeatures.complete);
  assert.ok(typeof s.volatility === "number");
  assert.ok(["good", "degraded", "insufficient"].includes(s.dataQuality));
  assert.ok(
    ["trending_up", "trending_down", "ranging", "volatile", "unknown"].includes(s.marketRegime),
  );
});

test("pipeline is deterministic for identical inputs", async () => {
  const a = new AnalysisService({ defaultAsset: "EURUSD", defaultTimeframe: "5m" });
  const b = new AnalysisService({ defaultAsset: "EURUSD", defaultTimeframe: "5m" });
  const input = candles(7);
  const ra = await a.analyze(input, "EURUSD", "5m");
  const rb = await b.analyze(input, "EURUSD", "5m");
  assert.equal(ra.signal.direction, rb.signal.direction);
  assert.equal(ra.signal.score, rb.signal.score);
  assert.equal(ra.signal.confidence, rb.signal.confidence);
});

test("risk engine forces NO_TRADE when confidence is below minimum", () => {
  const market = new MarketDataService();
  const svc = new SignalEngine({
    models: [new MLInferenceEngine()],
    risk: undefined, // use default (minConfidence 0.6)
  });
  const input = candles(3);
  const snapshot = market.buildSnapshot("EURUSD", "5m" as Timeframe, input, input[input.length - 1]!.closeTime);
  const features = market.featureVector(snapshot);

  // Force a near-neutral model so confidence is low.
  const neutral = new MLInferenceEngine({
    modelId: "neutral",
    version: "0.0.1",
    weights: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bias: 0,
  });
  const forced = new SignalEngine({ models: [neutral] });
  const sig = forced.analyze(snapshot, features);
  // Neutral model => low conviction => cannot exceed threshold as UP/DOWN.
  assert.equal(sig.direction, "NO_TRADE");

  // Sanity: default engine runs without throwing.
  const sig2 = svc.analyze(snapshot, features);
  assert.ok(["UP", "DOWN", "NO_TRADE"].includes(sig2.direction));
});

test("analysis summary never contains a forbidden claim", async () => {
  const svc = new AnalysisService({ defaultAsset: "EURUSD", defaultTimeframe: "5m" });
  for (const seed of [1, 2, 3, 4, 5]) {
    const out = await svc.analyze(candles(seed), "EURUSD", "5m");
    const lower = out.analysis.summary.toLowerCase();
    assert.ok(!lower.includes("100% accuracy"));
    assert.ok(!lower.includes("guaranteed"));
  }
});
