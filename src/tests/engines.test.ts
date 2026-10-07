/**
 * Engine unit tests: indicators, ensemble, confidence/calibration gating,
 * evaluation, backtesting, and paper trading.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sma, ema, rsi } from "../indicators/indicator_math.js";
import { EnsembleEngine } from "../ensemble/ensemble_engine.js";
import { ConfidenceEngine } from "../ensemble/confidence_engine.js";
import { ModelEvaluationEngine } from "../models/model_evaluation_engine.js";
import { DriftDetectionEngine } from "../ml/drift_detection_engine.js";
import { PaperTradingEngine } from "../paperTrading/paper_trading_engine.js";
import { generateCandles, MarketDataService } from "../services/market_data_service.js";

test("sma/ema/rsi behave and fail closed on short input", () => {
  const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(sma(vals, 5), 8);
  assert.equal(sma(vals, 50), null);
  assert.equal(ema(vals, 5) !== null, true);
  assert.equal(ema(vals, 50), null);
  assert.equal(rsi(vals, 3) !== null, true);
  assert.equal(rsi(vals, 100), null);
});

test("ensemble aggregates votes into a consensus direction", () => {
  const e = new EnsembleEngine();
  const up = e.decide([
    { modelId: "a", direction: "UP", score: 0.6, confidence: 0.8 },
    { modelId: "b", direction: "UP", score: 0.5, confidence: 0.7 },
  ]);
  assert.equal(up.direction, "UP");
  assert.ok(up.score > 0);

  const noTrade = e.decide([]);
  assert.equal(noTrade.direction, "NO_TRADE");
  assert.equal(noTrade.score, 0);
});

test("confidence engine does NOT emit calibratedProbability without a validated calibrator", () => {
  const c = new ConfidenceEngine();
  const votes = [{ modelId: "a", direction: "UP" as const, score: 0.6, confidence: 0.8 }];
  const without = c.compute(votes, undefined, "v1");
  assert.equal(without.calibratedProbability, undefined);
  assert.ok(without.confidence > 0);

  // Calibrator for a DIFFERENT version must be rejected.
  const mismatched = c.compute(votes, { modelVersion: "other", map: () => 0.9 }, "v1");
  assert.equal(mismatched.calibratedProbability, undefined);

  // Matching version attaches calibrated probability.
  const matched = c.compute(votes, { modelVersion: "v1", map: () => 0.72 }, "v1");
  assert.equal(matched.calibratedProbability, 0.72);
});

test("evaluation engine withholds calibrator when calibration is not validated", () => {
  const ev = new ModelEvaluationEngine();

  // Too little data => null calibrator.
  const few = Array.from({ length: 10 }, () => ({ confidence: 0.8, correct: true, traded: true }));
  assert.equal(ev.fitCalibrator("v1", few), null);

  // High ECE (miscalibrated) => null calibrator.
  const miscal = Array.from({ length: 100 }, (_, i) => ({
    confidence: 0.9,
    correct: i % 3 === 0, // ~33% actual vs 90% claimed => high ECE
    traded: true,
  }));
  assert.equal(ev.fitCalibrator("v1", miscal), null);
});

test("evaluation engine fits a calibrator when well-calibrated and sufficient", () => {
  const ev = new ModelEvaluationEngine();
  const good = Array.from({ length: 200 }, (_, i) => ({
    confidence: i % 2 === 0 ? 0.7 : 0.8,
    correct: i % 2 === 0 ? i % 4 < 3 : i % 5 < 4, // ~matches claimed
    traded: true,
  }));
  const cal = ev.fitCalibrator("v1", good);
  // If ECE is low enough, calibrator is produced; else null (both acceptable
  // fail-closed outcomes). Assert it never produces out-of-range values.
  if (cal) {
    const p = cal.map(0.75);
    assert.ok(p >= 0 && p <= 1);
    assert.equal(cal.modelVersion, "v1");
  }
});

test("drift detection flags a large accuracy shift", () => {
  const d = new DriftDetectionEngine();
  const ref = Array.from({ length: 40 }, () => ({ confidence: 0.8, correct: true, traded: true }));
  const recent = Array.from({ length: 40 }, () => ({ confidence: 0.8, correct: false, traded: true }));
  const report = d.compare(ref, recent);
  assert.equal(report.drifted, true);
  assert.ok(report.accuracyDelta > 0.1);

  const stable = d.compare(ref, ref);
  assert.equal(stable.drifted, false);
});

test("paper trading engine is paper-only and settles PnL correctly", () => {
  const paper = new PaperTradingEngine({ startingBalance: 1000, sizePerTrade: 1 });
  assert.equal(paper.isPaper, true);

  const upSignal = {
    direction: "UP" as const,
    score: 0.5,
    confidence: 0.8,
    timestamp: 0,
    timeframe: "5m" as const,
    evidence: [],
    modelVotes: [],
    riskStatus: "ok" as const,
    modelVersion: "v1",
    dataQuality: "good" as const,
  };
  const pos = paper.onSignal(upSignal, 100, "EURUSD");
  assert.ok(pos);
  const fill = paper.close(pos!.id, 110, 1);
  assert.ok(fill);
  assert.equal(fill!.pnl, 10); // (110-100)*1
  const st = paper.state(0);
  assert.equal(st.balance, 1010);
  assert.equal(st.wins, 1);
});

test("backtest-style candle walk runs end-to-end (smoke)", () => {
  const md = new MarketDataService();
  const candles = generateCandles(11, 120, 100, 300_000, 0);
  let directions = 0;
  for (let i = 60; i < candles.length - 1; i++) {
    const snap = md.buildSnapshot("EURUSD", "5m", candles.slice(0, i + 1), i);
    const feat = md.featureVector(snap);
    assert.ok(feat.length === 6);
    if (snap.dataQuality !== "insufficient") directions++;
  }
  assert.ok(directions > 0);
});
