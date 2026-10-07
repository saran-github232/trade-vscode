/**
 * Tests for the core constraint engine.
 *
 * Uses Node's built-in test runner (node:test).
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  evaluateCandidate,
  isEligibleForProduction,
  enforceChampionChallengerGate,
  decideNoTrade,
} from "../core/constraint_engine.js";
import { ValidationRecord, ValidationAxis, ScalarMetrics, Outcome } from "../types/domain.js";
import { buildRetrainChecks } from "../phases/phase10_retrain/retrain_pipeline.js";

function makeRecord(
  modelId: string,
  overrides: Partial<ValidationRecord> = {},
): ValidationRecord {
  return {
    modelId,
    dataset: "oos_ch3_5m_v4",
    period: "2024-01-01..2024-06-30",
    origin: "real_out_of_sample",
    metrics: {
      validationAccuracy: 0.62,
      precision: 0.58,
      recall: 0.41,
      winRate: 0.54,
      expectedValue: 0.032,
      profitFactor: 1.18,
      maxDrawdown: 0.074,
      calibrationError: 0.042,
      sharpeLike: 1.36,
      numberOfTrades: 412,
      numberOfNoTrade: 3281,
      perTradePnL: [],
    },
    baselines: [],
    checks: [
      { axis: ValidationAxis.OUT_OF_SAMPLE, passed: true, evidence: "OOS run" },
      { axis: ValidationAxis.WALK_FORWARD, passed: true, evidence: "walk-forward run" },
      { axis: ValidationAxis.POSITIVE_EXPECTED_VALUE, passed: true, evidence: "EV>0" },
      { axis: ValidationAxis.MAX_DRAWDOWN, passed: true, evidence: "maxDD<0.10" },
      { axis: ValidationAxis.CALIBRATION, passed: true, evidence: "calibrationOK" },
      { axis: ValidationAxis.NO_LEAKAGE, passed: true, evidence: "no leakage" },
      { axis: ValidationAxis.NO_OVERFITTING, passed: true, evidence: "no overfit" },
    ],
    verdict: "PASS",
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<ScalarMetrics> = {}): ScalarMetrics {
  return {
    validationAccuracy: 0.62,
    precision: 0.58,
    recall: 0.41,
    winRate: 0.54,
    expectedValue: 0.032,
    profitFactor: 1.18,
    maxDrawdown: 0.074,
    calibrationError: 0.042,
    sharpeLike: 1.36,
    numberOfTrades: 412,
    numberOfNoTrade: 3281,
    perTradePnL: [],
    ...overrides,
  };
}

describe("evaluateCandidate", () => {
  it("returns PASS when all required axes pass", () => {
    const record = makeRecord("m1");
    const out = evaluateCandidate(record);
    assert.strictEqual(out.verdict, "PASS");
  });

  it("returns FAIL when a required axis is missing", () => {
    const record = makeRecord("m1", {
      checks: [
        { axis: ValidationAxis.OUT_OF_SAMPLE, passed: true, evidence: "OOS run" },
        { axis: ValidationAxis.WALK_FORWARD, passed: true, evidence: "walk-forward run" },
        { axis: ValidationAxis.POSITIVE_EXPECTED_VALUE, passed: true, evidence: "EV>0" },
        { axis: ValidationAxis.MAX_DRAWDOWN, passed: true, evidence: "maxDD<0.10" },
        { axis: ValidationAxis.CALIBRATION, passed: true, evidence: "calibrationOK" },
        { axis: ValidationAxis.NO_LEAKAGE, passed: true, evidence: "no leakage" },
      ],
    });
    const out = evaluateCandidate(record);
    assert.strictEqual(out.verdict, "FAIL");
  });

  it("returns FAIL when origin is not real_out_of_sample", () => {

describe("enforceChampionChallengerGate", () => {
  it("promotes a challenger that robustly beats the champion on accuracy and expected value", () => {
    const champion = makeRecord("champ");
    const challenger = makeRecord("challenger", {
      metrics: makeMetrics({ validationAccuracy: 0.70, expectedValue: 0.05 }),
    });
    const out = enforceChampionChallengerGate("challenger", champion, challenger);
    assert.strictEqual(out.promoted, true);
    assert.strictEqual(out.championStays, false);
  });

  it("rejects a challenger that does not beat champion on unseen accuracy", () => {
    const champion = makeRecord("champ");
    const challenger = makeRecord("challenger", {
      metrics: makeMetrics({ validationAccuracy: 0.63, expectedValue: 0.03 }),
    });
    const out = enforceChampionChallengerGate("challenger", champion, challenger);
    assert.strictEqual(out.promoted, false);
    assert.strictEqual(out.championStays, true);
  });

  it("rejects a challenger that fails eligibility (e.g. synthetic origin)", () => {
    const champion = makeRecord("champ");
    const challenger = makeRecord("challenger", {
      origin: "synthetic_or_backtested_nominal",
    });
    const out = enforceChampionChallengerGate("challenger", champion, challenger);
    assert.strictEqual(out.promoted, false);
    assert.strictEqual(out.championStays, true);
  });
});

describe("decideNoTrade", () => {
  it("returns a NO_TRADE labeled signal", () => {
    const signal = decideNoTrade(100, "TST", "5m", "low quality", "p0");
    assert.strictEqual(signal.outcome, Outcome.NO_TRADE);
    assert.strictEqual(signal.rawSignal, "FLAT");
    assert.ok(signal.reason.includes("NO_TRADE"));
  });
});

describe("buildRetrainChecks", () => {
  it("produces labeled checks tied to period and dataset", () => {
    const checks = buildRetrainChecks("2024-01-01..2024-06-30", "retrain_v1_oos", {
      validationAccuracy: 0.62,
      precision: 0.58,
      recall: 0.41,
      winRate: 0.54,
      expectedValue: 0.032,
      profitFactor: 1.18,
      maxDrawdown: 0.074,
      calibrationError: 0.042,
      sharpeLike: 1.36,
      numberOfTrades: 412,
      numberOfNoTrade: 3281,
      perTradePnL: [],
    });
    assert.ok(checks.length >= 7);
    const axis = checks.map((c) => c.axis);
    assert.ok(axis.includes(ValidationAxis.OUT_OF_SAMPLE));
    assert.ok(axis.includes(ValidationAxis.NO_LEAKAGE));
    assert.ok(axis.includes(ValidationAxis.NO_OVERFITTING));
  });
});

    const record = makeRecord("m1", { origin: "synthetic_or_backtested_nominal" });
    const out = evaluateCandidate(record);
    assert.strictEqual(out.verdict, "FAIL");
  });
});

describe("isEligibleForProduction", () => {
  it("is true when all required axes pass", () => {
    const record = makeRecord("m1");
    assert.strictEqual(isEligibleForProduction(record), true);
  });

  it("is false when required axes fail", () => {
    const record = makeRecord("m1", {
      checks: [
        { axis: ValidationAxis.OUT_OF_SAMPLE, passed: false, evidence: "OOS FAIL" },
        { axis: ValidationAxis.WALK_FORWARD, passed: true, evidence: "walk-forward run" },
        { axis: ValidationAxis.POSITIVE_EXPECTED_VALUE, passed: true, evidence: "EV>0" },
        { axis: ValidationAxis.MAX_DRAWDOWN, passed: true, evidence: "maxDD<0.10" },
        { axis: ValidationAxis.CALIBRATION, passed: true, evidence: "calibrationOK" },
        { axis: ValidationAxis.NO_LEAKAGE, passed: true, evidence: "no leakage" },
        { axis: ValidationAxis.NO_OVERFITTING, passed: true, evidence: "no overfit" },
      ],
    });
    assert.strictEqual(isEligibleForProduction(record), false);
  });
});
