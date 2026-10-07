/**
 * Tests for the production gate (validateProductionEligibility + decide).
 *
 * Uses Node's built-in test runner (node:test).
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  validateProductionEligibility,
  decide,
} from "../prod/production_gate.js";
import { ValidationRecord, ValidationAxis, Outcome } from "../types/domain.js";

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

function features() {
  return {
    timestamp: 1704067200,
    asset: "TST",
    timeframe: "5m",
    values: { sma20: 100.5, rsi14: 55.0 },
  };
}

describe("validateProductionEligibility", () => {
  it("is eligible when the requested model matches and the record passes", () => {
    const out = validateProductionEligibility("m1", makeRecord("m1"), "m1");
    assert.strictEqual(out.eligible, true);
  });

  it("is not eligible when the requested model differs from production", () => {
    const out = validateProductionEligibility("m1", makeRecord("m1"), "m2");
    assert.strictEqual(out.eligible, false);
    assert.ok(out.reason.includes("mismatch"));
  });

  it("is not eligible when the production record fails validation", () => {
    const record = makeRecord("m1", { origin: "synthetic_or_backtested_nominal" });
    const out = validateProductionEligibility("m1", record, "m1");
    assert.strictEqual(out.eligible, false);
    assert.ok(out.reason.includes("not eligible"));
  });
});

describe("decide", () => {
  it("returns SIGNAL for an eligible model with a safe reason", () => {
    const prod = decide(
      "m1",
      makeRecord("m1"),
      "m1",
      features(),
      "BUY",
      0.66,
      "validated OOS on 2024-01-01..2024-06-30/oos_ch3_5m_v4",
      "p0",
    );
    assert.strictEqual(prod.outcome, Outcome.SIGNAL);
    assert.strictEqual(prod.labeledSignal.rawSignal, "BUY");
  });

  it("returns NO_TRADE when the requested model is not production", () => {
    const prod = decide(
      "m1",
      makeRecord("m1"),
      "m2",
      features(),
      "BUY",
      0.66,
      "some reason",
      "p0",
    );
    assert.strictEqual(prod.outcome, Outcome.NO_TRADE);
    assert.strictEqual(prod.labeledSignal.rawSignal, "FLAT");
  });

  it("returns NO_TRADE when the record fails validation (fail closed)", () => {
    const record = makeRecord("m1", {
      checks: [
        { axis: ValidationAxis.OUT_OF_SAMPLE, passed: false, evidence: "OOS FAIL" },
      ],
    });
    const prod = decide("m1", record, "m1", features(), "SELL", 0.7, "reason", "p0");
    assert.strictEqual(prod.outcome, Outcome.NO_TRADE);
    assert.strictEqual(prod.labeledSignal.rawSignal, "FLAT");
  });

  it("blocks a forbidden claim in the reason and converts to NO_TRADE", () => {
    const prod = decide(
      "m1",
      makeRecord("m1"),
      "m1",
      features(),
      "BUY",
      0.66,
      "This signal offers guaranteed profits on every trade",
      "p0",
    );
    assert.strictEqual(prod.outcome, Outcome.NO_TRADE);
    assert.strictEqual(prod.labeledSignal.rawSignal, "FLAT");
    assert.ok(prod.labeledSignal.reason.includes("POLICY_BLOCKED"));
  });

  it("a FLAT raw signal is NO_TRADE even for an eligible model", () => {
    const prod = decide("m1", makeRecord("m1"), "m1", features(), "FLAT", 0.5, "flat", "p0");
    assert.strictEqual(prod.outcome, Outcome.NO_TRADE);
  });
});
