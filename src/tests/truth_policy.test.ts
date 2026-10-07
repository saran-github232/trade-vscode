/**
 * Tests for the truth policy layer (checkClaimIsSafe + createReport).
 *
 * Uses Node's built-in test runner (node:test).
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  checkClaimIsSafe,
  createReport,
  FORBIDDEN_CLAIMS,
  FORBIDDEN_BOUNDS,
} from "../policy/truth_policy.js";

describe("checkClaimIsSafe", () => {
  it("blocks every entry in FORBIDDEN_CLAIMS (case-insensitive)", () => {
    for (const claim of FORBIDDEN_CLAIMS) {
      const upper = claim.toUpperCase();
      const out = checkClaimIsSafe(`We promise ${upper} today`);
      assert.strictEqual(out.safe, false, `expected block for: ${claim}`);
    }
  });

  it("allows a grounded claim tied to period and dataset", () => {
    const out = checkClaimIsSafe(
      "validationAccuracy=0.62 on 2024-01-01..2024-06-30/oos_ch3_5m_v4",
    );
    assert.strictEqual(out.safe, true);
  });

  it("blocks accuracy above the safe bound", () => {
    const out = checkClaimIsSafe("accuracy claim", {
      accuracy: FORBIDDEN_BOUNDS.maxAccuracy + 0.001,
    });
    assert.strictEqual(out.safe, false);
  });

  it("blocks profit factor above the safe bound", () => {
    const out = checkClaimIsSafe("pf claim", {
      profitFactor: FORBIDDEN_BOUNDS.maxProfitFactor + 1,
    });
    assert.strictEqual(out.safe, false);
  });

  it("blocks expected value above the safe bound", () => {
    const out = checkClaimIsSafe("ev claim", {
      expectedValue: FORBIDDEN_BOUNDS.maxExpectedValue + 1,
    });
    assert.strictEqual(out.safe, false);
  });

  it("blocks sharpe-like above the safe bound", () => {
    const out = checkClaimIsSafe("sharpe claim", {
      sharpeLike: FORBIDDEN_BOUNDS.maxSharpeLike + 1,
    });
    assert.strictEqual(out.safe, false);
  });

  it("allows metrics within the safe bounds", () => {
    const out = checkClaimIsSafe("grounded claim", {
      accuracy: 0.62,
      profitFactor: 1.18,
      expectedValue: 0.032,
      sharpeLike: 1.36,
    });
    assert.strictEqual(out.safe, true);
  });
});

describe("createReport", () => {
  const metrics = {
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
    perTradePnL: [] as number[],
    period: "2024-01-01..2024-06-30",
    dataset: "oos_ch3_5m_v4",
  };

  it("labels the report with the exact period and dataset", () => {
    const report = createReport("m1", metrics.period, metrics.dataset, metrics);
    assert.ok(report.includes("period=2024-01-01..2024-06-30"));
    assert.ok(report.includes("dataset=oos_ch3_5m_v4"));
    assert.ok(report.includes("modelId=m1"));
  });

  it("never emits a forbidden claim", () => {
    const report = createReport("m1", metrics.period, metrics.dataset, metrics);
    const lower = report.toLowerCase();
    for (const claim of FORBIDDEN_CLAIMS) {
      assert.ok(
        !lower.includes(claim.toLowerCase()),
        `report must not contain forbidden claim: ${claim}`,
      );
    }
  });

  it("includes the core metrics and the exactness note", () => {
    const report = createReport("m1", metrics.period, metrics.dataset, metrics);
    assert.ok(report.includes("validationAccuracy=0.62"));
    assert.ok(report.includes("expectedValue=0.032"));
    assert.ok(report.includes("NOTE: All statistics are exact"));
  });
});
