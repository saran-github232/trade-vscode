/**
 * Tests for the Champion vs Challenger gate.
 *
 * Uses Node's built-in test runner (node:test).
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  enforceChampionChallengerGate,
} from "../core/constraint_engine.js";
import { ValidationRecord, ValidationAxis } from "../types/domain.js";

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
      ...overrides,
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

describe("enforceChampionChallengerGate", () => {
  it("promotes a challenger that robustly beats the champion on accuracy and expected value", () => {
    const champion = makeRecord("champ");
    const challenger = makeRecord("challenger", {
      metrics: {
        validationAccuracy: 0.70,
        precision: 0.62,
        recall: 0.45,
        winRate: 0.56,
        expectedValue: 0.05,
        profitFactor: 1.20,
        maxDrawdown: 0.060,
        calibrationError: 0.038,
        sharpeLike: 1.45,
        numberOfTrades: 420,
        numberOfNoTrade: 3300,
        perTradePnL: [],
      },
    });
    const out = enforceChampionChallengerGate("challenger", champion, challenger);
    assert.strictEqual(out.promoted, true);
    assert.strictEqual(out.championStays, false);
  });

  it("rejects a challenger that does not beat champion on unseen accuracy", () => {
    const champion = makeRecord("champ");
    const challenger = makeRecord("challenger", {
      metrics: {
        validationAccuracy: 0.63,
        precision: 0.58,
        recall: 0.42,
        winRate: 0.55,
        expectedValue: 0.03,
        profitFactor: 1.15,
        maxDrawdown: 0.080,
        calibrationError: 0.050,
        sharpeLike: 1.25,
        numberOfTrades: 400,
        numberOfNoTrade: 3200,
        perTradePnL: [],
      },
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
