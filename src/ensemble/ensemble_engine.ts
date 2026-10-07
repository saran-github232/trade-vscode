/**
 * EnsembleEngine — aggregates model votes into a single ensemble decision.
 *
 * Weighted mean of model scores (weights = model confidence). Produces an
 * overall conviction score in [-1, 1] and a consensus direction.
 */

import type { ModelVote } from "../types/signal.js";
import type { Direction } from "../types/market.js";

export interface EnsembleDecision {
  /** Confidence-weighted mean score in [-1, 1]. */
  score: number;
  direction: Direction;
  votes: ModelVote[];
}

/** How many models must agree on a direction before it counts. */
const MIN_AGREEMENT = 0.5;

export class EnsembleEngine {
  decide(votes: ModelVote[]): EnsembleDecision {
    if (votes.length === 0) {
      return { score: 0, direction: "NO_TRADE", votes };
    }

    // Confidence-weighted mean of scores.
    let num = 0;
    let den = 0;
    for (const v of votes) {
      num += v.score * v.confidence;
      den += v.confidence;
    }
    const score = den === 0 ? 0 : num / den;

    // Direction consensus: fraction of weight voting each way.
    let upW = 0;
    let downW = 0;
    let flatW = 0;
    for (const v of votes) {
      if (v.direction === "UP") upW += v.confidence;
      else if (v.direction === "DOWN") downW += v.confidence;
      else flatW += v.confidence;
    }
    const total = upW + downW + flatW || 1;

    let direction: Direction = "NO_TRADE";
    if (upW / total >= MIN_AGREEMENT && score > 0) direction = "UP";
    else if (downW / total >= MIN_AGREEMENT && score < 0) direction = "DOWN";

    return { score, direction, votes };
  }
}
