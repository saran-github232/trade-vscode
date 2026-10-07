/**
 * Signal domain types for TradeVision AI.
 *
 * CRITICAL SEMANTICS
 * ------------------
 * `confidence` is a model's self-reported strength of conviction. It is
 * NOT a probability of winning and MUST NOT be presented as one.
 *
 * `calibratedProbability` is only present when statistical calibration has
 * been implemented AND validated (see ModelEvaluationEngine). When absent
 * (`undefined`), consumers must fall back to `confidence` and label it as
 * conviction, never as a win probability.
 */

import type { DataQuality, Direction, Timeframe } from "./market.js";

/** Risk status attached to every signal by the RiskEngine. */
export type RiskStatus = "ok" | "elevated" | "blocked";

/** A single piece of human-readable evidence supporting a signal. */
export interface Evidence {
  /** Short label, e.g. "rsi_reversal", "regime_alignment". */
  kind: string;
  /** Grounded description tied to concrete values. */
  detail: string;
}

/** A vote from one model in the ensemble. */
export interface ModelVote {
  /** Model identifier, e.g. "logistic_v3". */
  modelId: string;
  /** The direction this model voted for. */
  direction: Direction;
  /** The model's conviction score in [-1, 1] (negative = DOWN). */
  score: number;
  /** Model-specific conviction, NOT a win probability. */
  confidence: number;
}

/** The core analysis signal. Immutable once produced. */
export interface Signal {
  direction: Direction;
  /** Ensemble conviction in [-1, 1]: negative favors DOWN, positive favors UP. */
  score: number;
  /** Model conviction in [0, 1]. NOT a probability of winning. */
  confidence: number;
  /**
   * Statistically calibrated probability in [0, 1], ONLY present when a
   * calibration model has been fit and validated for this modelVersion.
   * Undefined otherwise — never invent this value.
   */
  calibratedProbability?: number;
  /** Epoch milliseconds (UTC) when the signal was produced. */
  timestamp: number;
  timeframe: Timeframe;
  evidence: Evidence[];
  modelVotes: ModelVote[];
  riskStatus: RiskStatus;
  /** Semantic version of the model/ensemble that produced this signal. */
  modelVersion: string;
  dataQuality: DataQuality;
}