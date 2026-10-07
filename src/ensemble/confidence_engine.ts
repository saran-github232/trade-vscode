/**
 * ConfidenceEngine — computes the signal's `confidence` field.
 *
 * IMPORTANT: `confidence` is the ensemble's conviction, NOT a probability
 * of winning. This engine NEVER returns a calibrated probability on its
 * own. A `calibratedProbability` is only attached when an externally
 * validated calibration model (from ModelEvaluationEngine) is supplied.
 */

import type { ModelVote } from "../types/signal.js";

/** Optional, pre-validated calibration mapping conviction -> probability. */
export interface Calibrator {
  /** Model version this calibrator is valid for. */
  modelVersion: string;
  /** Map a raw conviction in [0,1] to a calibrated probability in [0,1]. */
  map(conviction: number): number;
}

export interface ConfidenceResult {
  /** Conviction in [0, 1]. NOT a win probability. */
  confidence: number;
  /** Only set when a validated calibrator for this version is provided. */
  calibratedProbability?: number;
}

export class ConfidenceEngine {
  /**
   * @param votes - ensemble votes
   * @param calibrator - optional validated calibrator; must match version
   * @param modelVersion - the version that produced the votes
   */
  compute(
    votes: ModelVote[],
    calibrator?: Calibrator,
    modelVersion?: string,
  ): ConfidenceResult {
    if (votes.length === 0) return { confidence: 0 };

    // Mean conviction of participating models.
    let sum = 0;
    for (const v of votes) sum += v.confidence;
    const conviction = Math.min(1, Math.max(0, sum / votes.length));

    // Only attach a calibrated probability if the calibrator is valid for
    // this exact model version. Otherwise leave it undefined (fail closed).
    if (calibrator && modelVersion && calibrator.modelVersion === modelVersion) {
      const p = Math.min(1, Math.max(0, calibrator.map(conviction)));
      return { confidence: conviction, calibratedProbability: p };
    }

    return { confidence: conviction };
  }
}
