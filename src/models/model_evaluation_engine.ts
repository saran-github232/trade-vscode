/**
 * ModelEvaluationEngine — evaluates predictions against realized outcomes.
 *
 * Responsibilities:
 *  - Compute accuracy and expected-calibration-error (ECE) on a labeled set.
 *  - Produce a `Calibrator` ONLY when measured ECE is below a threshold,
 *    i.e. calibration is implemented AND validated. Otherwise returns null
 *    and consumers must leave `calibratedProbability` undefined.
 */

import type { Calibrator } from "../ensemble/confidence_engine.js";

/** One labeled example: what the model said vs what happened. */
export interface EvalExample {
  /** Model conviction in [0,1]. */
  confidence: number;
  /** Did the directional call win? (ignored for NO_TRADE) */
  correct: boolean;
  /** Whether the model emitted a directional call at all. */
  traded: boolean;
}

export interface EvalMetrics {
  /** Fraction of traded predictions that were correct. */
  accuracy: number;
  /** Expected calibration error (0 = perfectly calibrated). */
  calibrationError: number;
  /** Number of evaluated examples. */
  n: number;
}

/** Max ECE tolerated before a calibrator is considered "validated". */
export const MAX_VALIDATED_ECE = 0.1;

const BINS = 10;

export class ModelEvaluationEngine {
  /** Compute accuracy + ECE over a labeled evaluation set. */
  evaluate(examples: EvalExample[]): EvalMetrics {
    const traded = examples.filter((e) => e.traded);
    const n = traded.length;
    if (n === 0) return { accuracy: 0, calibrationError: 1, n: 0 };

    let correct = 0;
    // Bin by confidence for ECE.
    const binConf = new Array<number>(BINS).fill(0);
    const binAcc = new Array<number>(BINS).fill(0);
    const binCount = new Array<number>(BINS).fill(0);

    for (const e of traded) {
      if (e.correct) correct++;
      const b = Math.min(BINS - 1, Math.floor(e.confidence * BINS));
      binConf[b] = (binConf[b] as number) + e.confidence;
      binAcc[b] = (binAcc[b] as number) + (e.correct ? 1 : 0);
      binCount[b] = (binCount[b] as number) + 1;
    }

    let ece = 0;
    for (let b = 0; b < BINS; b++) {
      const c = binCount[b] as number;
      if (c === 0) continue;
      const meanConf = (binConf[b] as number) / c;
      const meanAcc = (binAcc[b] as number) / c;
      ece += (c / n) * Math.abs(meanConf - meanAcc);
    }

    return { accuracy: correct / n, calibrationError: ece, n };
  }

  /**
   * Build a validated calibrator from a held-out set.
   * Returns null if there is too little data or ECE is already fine but
   * we cannot improve (Phase 1: isotonic-free binned mapping).
   */
  fitCalibrator(modelVersion: string, examples: EvalExample[]): Calibrator | null {
    const metrics = this.evaluate(examples);
    if (metrics.n < 50) return null; // Not enough data to validate.
    if (metrics.calibrationError > MAX_VALIDATED_ECE) return null; // Not calibrated.

    // Build binned empirical mapping confidence -> observed accuracy.
    const binAcc = new Array<number>(BINS).fill(0);
    const binCount = new Array<number>(BINS).fill(0);
    for (const e of examples.filter((x) => x.traded)) {
      const b = Math.min(BINS - 1, Math.floor(e.confidence * BINS));
      binAcc[b] = (binAcc[b] as number) + (e.correct ? 1 : 0);
      binCount[b] = (binCount[b] as number) + 1;
    }
    const mapping = binAcc.map((acc, i) => {
      const c = binCount[i] as number;
      return c === 0 ? (i + 0.5) / BINS : acc / c;
    });

    return {
      modelVersion,
      map(conviction: number): number {
        const b = Math.min(BINS - 1, Math.max(0, Math.floor(conviction * BINS)));
        return mapping[b] as number;
      },
    };
  }
}
