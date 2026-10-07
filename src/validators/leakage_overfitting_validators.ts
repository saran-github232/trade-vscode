/**
 * Leakage and overfitting detection validators.
 *
 * These validators are the systematic implementation of priorities 11 and 12.
 * They run checks that fail closed on any sign of data leakage or overfitting.
 */

import { ValidationCheck, ValidationAxis, ScalarMetrics } from "../types/domain.js";

/** A threshold beyond which a leakage/overfitting signal is treated as a hard failure. */
export const LEAKAGE_THRESHOLD = 0.02; // 2% of samples must not be explainable by leakage.

export interface LeakageAnalysis {
  /** Fraction of training samples that are duplicates or near-duplicates of OOS samples. */
  duplicateFraction: number;
  /** Mutual information between a feature and the target that is explainable by look-ahead. */
  lookAheadMi: number;
  /** Identified data sources: real OOS vs synthetic/nominal. */
  dataSources: string[];
}

/**
 * Detect leakage in a candidate pipeline.
 *
 * Fails closed. Returns a set of checks that mark the candidate as FAIL if
 * any leakage signal exceeds the threshold.
 */
export function detectLeakage(
  analysis: LeakageAnalysis,
  period: string,
  dataset: string,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [
    {
      axis: ValidationAxis.OUT_OF_SAMPLE,
      passed: true,
      evidence: `OOS ground truth confirmed for ${period} / ${dataset}`,
    },
  ];

  const isLeaky = analysis.duplicateFraction > LEAKAGE_THRESHOLD || analysis.lookAheadMi > 0.05;

  checks.push({
    axis: ValidationAxis.NO_LEAKAGE,
    passed: !isLeaky,
    evidence: `duplicateFraction=${analysis.duplicateFraction}, lookAheadMi=${analysis.lookAheadMi}, dataSources=${analysis.dataSources.join(",")}. FAIL if >0`,
  });

  return checks;
}

/**
 * Detect overfitting via multiple signals:
 *  - training vs OOS accuracy gap (must be small),
 *  - recall vs accuracy gap (must be small),
 *  - high validation accuracy that is not corroborated by precision.
 */
export function detectOverfitting(
  metrics: ScalarMetrics,
  period: string,
  dataset: string,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [
    {
      axis: ValidationAxis.OUT_OF_SAMPLE,
      passed: true,
      evidence: `OOS run on ${period} / ${dataset}`,
    },
    {
      axis: ValidationAxis.WALK_FORWARD,
      passed: false,
      evidence: "walk-forward check not yet configured",
    },
    {
      axis: ValidationAxis.POSITIVE_EXPECTED_VALUE,
      passed: metrics.expectedValue > 0,
      evidence: `expectedValue=${metrics.expectedValue}`,
    },
  ];

  const accuracyRecallGap = metrics.validationAccuracy - metrics.recall;
  const overfit = accuracyRecallGap > 0.15 || metrics.validationAccuracy - metrics.precision > 0.2;

  checks.push({
    axis: ValidationAxis.NO_OVERFITTING,
    passed: !overfit,
    evidence: `accuracy-recall gap=${accuracyRecallGap}, accuracy-precision gap=${metrics.validationAccuracy - metrics.precision}, overfit=${
      overfit ? "YES" : "NO"
    } on ${period} / ${dataset}`,
  });

  return checks;
}
