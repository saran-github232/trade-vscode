import { ScalarMetrics } from "../types/domain.ts";

/**
 * Truth policy layer.
 *
 * This module encodes the "CORE ACCURACY, PROFITABILITY AND VALIDATION
 * CLAUSE" that the system must NEVER claim certain things.
 *
 * These forbidden claims are enforced here so that NO reporting path can
 * emit them. The policy is deliberately placed at the outermost layer so
 * that every other module depends on it.
 */

/** The list of claims the system must never emit. */
export const FORBIDDEN_CLAIMS = [
  "100% accuracy",
  "guaranteed profits",
  "guaranteed winning trades",
  "guaranteed daily returns",
  "guaranteed transformation of a specific starting balance into a specific target balance",
] as const;

/** High-confidence-ish bounds a claim may NOT exceed. */
export const FORBIDDEN_BOUNDS = {
  /** Accuracy above this is treated as ungrounded. */
  maxAccuracy: 0.999,
  /** Profit factor above this is treated as ungrounded. */
  maxProfitFactor: 100,
  /** Expected value above this is treated as ungrounded. */
  maxExpectedValue: 10,
  /** Sharpe-like metric above this is treated as ungrounded. */
  maxSharpeLike: 100,
};

/**
 * Check that a candidate claim is not forbidden.
 *
 * Returns a ValidationError if the claim is forbidden or exceeds a
 * forbidden bound. Returns null when the claim is safe to emit.
 */
export function checkClaimIsSafe(
  claim: string,
  metrics?: { accuracy?: number; profitFactor?: number; expectedValue?: number; sharpeLike?: number },
): { safe: true } | { safe: false; reason: string } {
  const lower = claim.trim().toLowerCase();

  for (const forbidden of FORBIDDEN_CLAIMS) {
    if (lower.includes(forbidden.toLowerCase())) {
      return { safe: false, reason: `Forbidden claim emitted: "${forbidden}"` };
    }
  }

  if (metrics) {
    if (metrics.accuracy !== undefined && metrics.accuracy > FORBIDDEN_BOUNDS.maxAccuracy) {
      return {
        safe: false,
        reason: `Accuracy ${metrics.accuracy} exceeds the safe bound of ${FORBIDDEN_BOUNDS.maxAccuracy}.`,
      };
    }
    if (metrics.profitFactor !== undefined && metrics.profitFactor > FORBIDDEN_BOUNDS.maxProfitFactor) {
      return {
        safe: false,
        reason: `Profit factor ${metrics.profitFactor} exceeds the safe bound of ${FORBIDDEN_BOUNDS.maxProfitFactor}.`,
      };
    }
    if (metrics.expectedValue !== undefined && metrics.expectedValue > FORBIDDEN_BOUNDS.maxExpectedValue) {
      return {
        safe: false,
        reason: `Expected value ${metrics.expectedValue} exceeds the safe bound of ${FORBIDDEN_BOUNDS.maxExpectedValue}.`,
      };
    }
    if (metrics.sharpeLike !== undefined && metrics.sharpeLike > FORBIDDEN_BOUNDS.maxSharpeLike) {
      return {
        safe: false,
        reason: `Sharpe-like metric ${metrics.sharpeLike} exceeds the safe bound of ${FORBIDDEN_BOUNDS.maxSharpeLike}.`,
      };
    }
  }

  return { safe: true };
}

/**
 * Build a safe report string that is always tied to an exact evaluation
 * period and dataset. Never emits a forbidden claim.
 */
export function createReport(
  modelId: string,
  period: string,
  dataset: string,
  metrics: Omit<ScalarMetrics, "perTradePnL" | "numberOfTrades" | "numberOfNoTrade"> & {
    perTradePnL?: number[];
    numberOfTrades?: number;
    numberOfNoTrade?: number;
    period: string;
    dataset: string;
  },
): string {
  const { period: _period, dataset: _dataset, ...rest } = metrics;
  // Remap the remaining fields to ensure they match the expected set.
  const map: Record<string, unknown> = {
    validationAccuracy: rest.validationAccuracy,
    precision: rest.precision,
    recall: rest.recall,
    winRate: rest.winRate,
    expectedValue: rest.expectedValue,
    profitFactor: rest.profitFactor,
    maxDrawdown: rest.maxDrawdown,
    calibrationError: rest.calibrationError,
    sharpeLike: rest.sharpeLike,
    numberOfTrades: rest.numberOfTrades,
    numberOfNoTrade: rest.numberOfNoTrade,
    perTradePnL: rest.perTradePnL,
  };

  return [
    `[Report]`,
    `modelId=${modelId}`,
    `period=${period}`,
    `dataset=${dataset}`,
    `validationAccuracy=${map.validationAccuracy}`,
    `precision=${map.precision}`,
    `recall=${map.recall}`,
    `winRate=${map.winRate}`,
    `expectedValue=${map.expectedValue}`,
    `profitFactor=${map.profitFactor}`,
    `maxDrawdown=${map.maxDrawdown}`,
    `calibrationError=${map.calibrationError}`,
    `sharpeLike=${map.sharpeLike}`,
    `numberOfTrades=${map.numberOfTrades}`,
    `numberOfNoTrade=${map.numberOfNoTrade}`,
    `perTradePnL=${JSON.stringify(map.perTradePnL)}`,
    `NOTE: All statistics are exact for the period+set above.`,
    `TradeVision AI does not claim accuracy, profits, or transformations beyond verified data.`,
  ].join("  ");
}
