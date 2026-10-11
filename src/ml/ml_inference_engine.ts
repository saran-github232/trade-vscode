/**
 * MLInferenceEngine — deterministic logistic inference over features.
 *
 * Phase 1 ships a fixed-weight logistic model (no network, no randomness).
 * The output score is a conviction value in [-1, 1]; the derived confidence
 * is a self-reported strength, NOT a calibrated win probability.
 *
 * Real training/evaluation hooks live in TrainingPipeline /
 * ModelEvaluationEngine, which can swap the weights after validation.
 */

import type { ModelVote } from "../types/signal.js";
import type { Direction } from "../types/market.js";

/** A versioned set of model weights. */
export interface ModelWeights {
  modelId: string;
  version: string;
  /** Bias + per-feature weights, aligned with FeatureEngineeringEngine.toVector order. */
  weights: number[];
  bias: number;
}

/** Default hand-set weights; positive => favors UP on momentum/rsi. */
export const DEFAULT_WEIGHTS: ModelWeights = {
  modelId: "logistic_momentum_v1",
  version: "1.0.0",
  weights: [1.2, 0.8, 0.9, -0.3, 0.5, 0.6, 1.0, 0.9, -0.2, 0.7, 0.6, -0.5, 0.8, 0.5],
  bias: 0,
};

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Weighted logistic score -> conviction in [-1, 1]. */
export function score(features: number[], w: ModelWeights): number {
  if (features.length !== w.weights.length) {
    // Fail closed: mismatched feature dimension yields a neutral conviction.
    return 0;
  }
  let z = w.bias;
  for (let i = 0; i < features.length; i++) {
    z += (features[i] as number) * (w.weights[i] as number);
  }
  return sigmoid(z) * 2 - 1; // map [0,1] -> [-1,1]
}

export class MLInferenceEngine {
  constructor(private readonly weights: ModelWeights = DEFAULT_WEIGHTS) {}

  get version(): string {
    return `${this.weights.modelId}@${this.weights.version}`;
  }

  /**
   * Produce a model vote for the given feature vector.
   * Direction threshold is deliberately near zero; SignalEngine combines
   * votes and applies the confidence gate.
   */
  predict(features: number[]): ModelVote {
    const s = score(features, this.weights);
    // Confidence reflects distance from neutral, clamped to [0.5, 1].
    const confidence = Math.min(1, 0.5 + Math.abs(s) / 2);
    const direction: Direction = s > 0.05 ? "UP" : s < -0.05 ? "DOWN" : "NO_TRADE";
    return {
      modelId: this.version,
      direction,
      score: s,
      confidence,
    };
  }
}
