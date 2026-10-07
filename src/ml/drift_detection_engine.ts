/**
 * DriftDetectionEngine — detects distribution/performance drift.
 *
 * Compares a recent window of confidences/accuracies against a reference
 * window. Signals drift when the mean accuracy shifts beyond a threshold
 * or the feature scale changes materially (fail-closed flag for retraining).
 */

export interface DriftReport {
  drifted: boolean;
  /** Absolute change in mean accuracy between windows. */
  accuracyDelta: number;
  /** Absolute change in mean confidence between windows. */
  confidenceDelta: number;
  reason: string;
}

export interface DriftSample {
  confidence: number;
  correct: boolean;
  traded: boolean;
}

export interface DriftConfig {
  /** Accuracy shift beyond this triggers drift. */
  accuracyThreshold: number;
  /** Confidence shift beyond this triggers drift. */
  confidenceThreshold: number;
}

export const DEFAULT_DRIFT: DriftConfig = { accuracyThreshold: 0.1, confidenceThreshold: 0.15 };

function mean(v: number[]): number {
  return v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length;
}

export class DriftDetectionEngine {
  constructor(private readonly cfg: DriftConfig = DEFAULT_DRIFT) {}

  compare(reference: DriftSample[], recent: DriftSample[]): DriftReport {
    const acc = (s: DriftSample[]): number => {
      const t = s.filter((x) => x.traded);
      return t.length === 0 ? 0 : mean(t.map((x) => (x.correct ? 1 : 0)));
    };
    const conf = (s: DriftSample[]): number => mean(s.map((x) => x.confidence));

    const accuracyDelta = Math.abs(acc(reference) - acc(recent));
    const confidenceDelta = Math.abs(conf(reference) - conf(recent));

    const drifted = accuracyDelta > this.cfg.accuracyThreshold || confidenceDelta > this.cfg.confidenceThreshold;
    return {
      drifted,
      accuracyDelta,
      confidenceDelta,
      reason: drifted
        ? `Drift detected: accuracyDelta=${accuracyDelta.toFixed(3)} confidenceDelta=${confidenceDelta.toFixed(3)}`
        : "No significant drift.",
    };
  }
}
