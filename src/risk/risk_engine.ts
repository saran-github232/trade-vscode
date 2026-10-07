/**
 * RiskEngine — evaluates whether a signal is safe to emit.
 *
 * Fail-closed: blocks (forces NO_TRADE) when volatility is extreme, the
 * data quality is insufficient, or the signal's conviction is below the
 * configured minimum. Also sizes positions as a fraction of equity.
 */

import type { MarketSnapshot } from "../types/market.js";
import type { Direction } from "../types/market.js";
import type { RiskStatus } from "../types/signal.js";

export interface RiskDecision {
  status: RiskStatus;
  /** Direction after risk override; "NO_TRADE" when blocked. */
  direction: Direction;
  /** Why the risk engine allowed/blocked, for the evidence trail. */
  reason: string;
  /** Position size as a fraction of equity (0 when blocked). */
  sizeFraction: number;
}

export interface RiskConfig {
  /** Minimum confidence to allow any signal. */
  minConfidence: number;
  /** Max fraction of equity risked per trade. */
  maxRiskPerTrade: number;
  /** Volatility above this (annualized-ish) elevates risk. */
  volatilityElevated: number;
  /** Volatility above this blocks trading entirely. */
  volatilityBlock: number;
}

export const DEFAULT_RISK: RiskConfig = {
  minConfidence: 0.6,
  maxRiskPerTrade: 0.02,
  volatilityElevated: 0.05,
  volatilityBlock: 0.12,
};

export class RiskEngine {
  constructor(private readonly cfg: RiskConfig = DEFAULT_RISK) {}

  evaluate(
    direction: Direction,
    confidence: number,
    snapshot: MarketSnapshot,
  ): RiskDecision {
    // Insufficient or below-threshold data quality => never trade (fail closed).
    if (
      snapshot.dataQuality === "insufficient" ||
      snapshot.quality?.pass === false ||
      !snapshot.technicalFeatures.complete
    ) {
      const score = snapshot.quality?.score ?? 0;
      const threshold = snapshot.quality?.threshold ?? 0;
      return this.block(
        direction,
        `Data quality rejected (score ${score} < threshold ${threshold}) or features incomplete.`,
      );
    }

    // Extreme volatility => block.
    if (snapshot.volatility >= this.cfg.volatilityBlock) {
      return this.block(direction, `Volatility ${snapshot.volatility.toFixed(4)} exceeds block threshold.`);
    }

    // Direction is already NO_TRADE.
    if (direction === "NO_TRADE") {
      return {
        status: "ok",
        direction: "NO_TRADE",
        reason: "Ensemble did not reach a directional consensus.",
        sizeFraction: 0,
      };
    }

    // Confidence below minimum => block.
    if (confidence < this.cfg.minConfidence) {
      return this.block(direction, `Confidence ${confidence.toFixed(3)} below minimum ${this.cfg.minConfidence}.`);
    }

    // Elevated volatility => allow but flag and halve size.
    if (snapshot.volatility >= this.cfg.volatilityElevated) {
      return {
        status: "elevated",
        direction,
        reason: `Elevated volatility ${snapshot.volatility.toFixed(4)}; halved position.`,
        sizeFraction: this.cfg.maxRiskPerTrade / 2,
      };
    }

    return {
      status: "ok",
      direction,
      reason: "Risk checks passed.",
      sizeFraction: this.cfg.maxRiskPerTrade,
    };
  }

  private block(direction: Direction, reason: string): RiskDecision {
    void direction;
    return { status: "blocked", direction: "NO_TRADE", reason, sizeFraction: 0 };
  }
}
