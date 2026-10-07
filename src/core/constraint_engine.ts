/**
 * The constraint engine.
 *
 * This is the choke point of the entire system. Every model candidate,
 * before it can influence any production signal, must pass through the
 * full validation suite defined by the 12 validation priorities.
 *
 * Enforcement rules:
 *  - A candidate must be "PASS" on ALL required axes to be eligible.
 *  - The production gate uses a Champion vs Challenger comparison.
 *  - The challenger must demonstrate robust improvement on UNSEEN data.
 *  - No exceptions. Fails closed.
 */

import { ValidationRecord, ValidationAxis, Outcome, LabeledSignal } from "../types/domain.js";

/** Codes an axis that is mandatory for any candidate to be eligible. */
export const REQUIRED_AXES = [
  ValidationAxis.OUT_OF_SAMPLE,
  ValidationAxis.WALK_FORWARD,
  ValidationAxis.POSITIVE_EXPECTED_VALUE,
  ValidationAxis.MAX_DRAWDOWN,
  ValidationAxis.CALIBRATION,
  ValidationAxis.NO_LEAKAGE,
  ValidationAxis.NO_OVERFITTING,
] as const;

/**
 * Run the full validation suite on a candidate model.
 *
 * Returns the complete ValidationRecord. The caller must NOT treat the
 * candidate as eligible until every REQUIRED_AXES entry has passed.
 */
export function evaluateCandidate(
  record: ValidationRecord,
): ValidationRecord {
  if (record.origin !== "real_out_of_sample") {
    return {
      ...record,
      origin: "synthetic_or_backtested_nominal",
      verdict: "FAIL",
      checks: [
        ...record.checks,
        {
          axis: ValidationAxis.OUT_OF_SAMPLE,
          passed: false,
          evidence: `Origin must be real_out_of_sample, got "${record.origin}".`,
        },
      ],
    };
  }

  // Recompute the overall verdict from the checks.
  const allChecks = record.checks ?? [];
  const requiredFailed = REQUIRED_AXES.some(
    (axis) =>
      !allChecks.some((c) => c.axis === axis && c.passed),
  );

  return {
    ...record,
    verdict: requiredFailed ? "FAIL" : "PASS",
  };
}

/**
 * Enforce the Champion vs Challenger promotion gate.
 *
 * The challenger must demonstrate robust improvement on unseen data
 * relative to the champion. If it does not, the challenger is rejected
 * and the champion stays production.
 */
export function enforceChampionChallengerGate(
  candidateId: string,
  championRecord: ValidationRecord,
  challengerRecord: ValidationRecord,
): { promoted: boolean; reason: string; championStays: boolean } {
  // The candidate must first be eligible.
  const candidateEvaluated = evaluateCandidate(challengerRecord);
  if (candidateEvaluated.verdict !== "PASS") {
    return {
      promoted: false,
      reason: `Challenger ${candidateId} is not eligible: ${describeFailedChecks(candidateEvaluated)}`,
      championStays: true,
    };
  }

  // Compare on the metrics that matter most for risk-adjusted value.
  // The challenger must beat the champion on OUT_OF_SAMPLE and
  // POSITIVE_EXPECTED_VALUE by at least the required margin.
  const requiredImprovement = 0.01; // 1 percentage point minimum.

  const championMetrics = championRecord.metrics;
  const challengerMetrics = challengerRecord.metrics;

  const outOfSample = challengerMetrics.validationAccuracy > championMetrics.validationAccuracy + requiredImprovement;
  const expectedValue = challengerMetrics.expectedValue > championMetrics.expectedValue + requiredImprovement;

  const robustImprovement = outOfSample && expectedValue;

  if (!robustImprovement) {
    return {
      promoted: false,
      reason: `Challenger ${candidateId} lacks robust improvement on unseen data.`,
      championStays: true,
    };
  }

  // If we reach here, the challenger is promoted.
  return {
    promoted: true,
    reason: `Challenger ${candidateId} robustly outperformed champion on unseen data.`,
    championStays: false,
  };
}

/**
 * A candidate is NOT eligible for production signals until the full
 * validation suite passes. This function is the hard gate.
 */
export function isEligibleForProduction(record: ValidationRecord): boolean {
  const evaluated = evaluateCandidate(record);
  if (evaluated.verdict !== "PASS") return false;

  return REQUIRED_AXES.every((axis) =>
    evaluated.checks?.some((c) => c.axis === axis && c.passed) ?? false,
  );
}

/**
 * Build the NO_TRADE decision path. This is a first-class, rewarded
 * outcome, not a failure. Avoiding low-quality trades is explicitly
 * rewarded over forcing a signal on every candle.
 */
export function decideNoTrade(
  currentPrice: number,
  asset: string,
  timeframe: string,
  reason: string,
  provenance: string,
): LabeledSignal {
  return {
    rawSignal: "FLAT",
    outcome: Outcome.NO_TRADE,
    reason: `[NO_TRADE] ${reason} | asset=${asset} | timeframe=${timeframe} | ~${currentPrice}`,
    provenance,
  };
}

function describeFailedChecks(record: ValidationRecord): string {
  const failed = record.checks?.filter((c) => !c.passed) ?? [];
  if (failed.length === 0) return "no checks defined";
  return failed.map((c) => `${c.axis}: ${c.evidence}`).join("; ");
}
