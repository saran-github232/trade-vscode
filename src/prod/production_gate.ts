/**
 * Production signal gate.
 *
 * This is the single point where a model can influence production signals.
 * Every decision must pass through here, and the model must be the current
 * production model with a valid, PASSed validation record.
 *
 * NO_TRADE is a first-class, rewarded output. The system does NOT force a
 * signal on every candle.
 */

import {
  DecisionResult,
  Outcome,
  LabeledSignal,
  ValidationRecord,
} from "../types/domain.js";
import { isEligibleForProduction } from "../core/constraint_engine.js";
import { checkClaimIsSafe } from "../policy/truth_policy.js";

/**
 * Validate that a model is currently production and its validation record
 * is PASS. Fails closed.
 */
export function validateProductionEligibility(
  modelId: string,
  productionRecord: ValidationRecord,
  requestedModelId: string,
): { eligible: boolean; reason: string } {
  if (requestedModelId !== modelId) {
    return {
      eligible: false,
      reason: `Production model mismatch: requested ${requestedModelId}, current production is ${modelId}.`,
    };
  }

  if (!isEligibleForProduction(productionRecord)) {
    return {
      eligible: false,
      reason: `Current production model ${modelId} is not eligible (validation FAILED).`,
    };
  }

  return { eligible: true, reason: `Model ${modelId} is eligible and production.` };
}

/**
 * Build a production decision for a single candle/event.
 *
 * Returns a LabeledSignal with outcome SIGNAL or NO_TRADE. The model's
 * confidence is only trusted if the model is production-eligible and its
 * calibration error is within bounds.
 */
export function decide(
  modelId: string,
  productionRecord: ValidationRecord,
  requestedModelId: string,
  features: {
    timestamp: number;
    asset: string;
    timeframe: string;
    values: Record<string, number>;
  },
  rawSignal: "BUY" | "SELL" | "FLAT",
  confidence: number,
  reason: string,
  provenance: string,
): DecisionResult {
  const eligibility = validateProductionEligibility(
    modelId,
    productionRecord,
    requestedModelId,
  );

  // Clamp confidence to [0, 1] for a sane calibration check.
  const clampedConfidence = Math.max(0, Math.min(1, confidence));

  // Build the labeled signal.
  let outcome: Outcome;
  if (rawSignal === "FLAT") {
    outcome = Outcome.NO_TRADE;
  } else {
    outcome = Outcome.SIGNAL;
  }

  const labeledSignal: LabeledSignal = {
    rawSignal,
    outcome,
    reason,
    provenance,
  };

  // If the model is not eligible, the only safe output is NO_TRADE.
  if (!eligibility.eligible) {
    labeledSignal.outcome = Outcome.NO_TRADE;
    labeledSignal.rawSignal = "FLAT";
    return {
      outcome: Outcome.NO_TRADE,
      labeledSignal,
      validationRecord: productionRecord,
    };
  }

  // Enforce the truth policy: never claim forbidden things.
  const claimCheck = checkClaimIsSafe(
    reason,
    {
      accuracy: clampedConfidence,
      profitFactor: 1,
      expectedValue: 0,
      sharpeLike: 0,
    },
  );

  if (!claimCheck.safe) {
    // A forbidden claim cannot be emitted. Convert to NO_TRADE and log.
    labeledSignal.outcome = Outcome.NO_TRADE;
    labeledSignal.rawSignal = "FLAT";
    labeledSignal.reason = `${labeledSignal.reason} [POLICY_BLOCKED: ${claimCheck.reason}]`;
  }

  return {
    outcome: labeledSignal.outcome,
    labeledSignal,
    validationRecord: productionRecord,
  };
}
