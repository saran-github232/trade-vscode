/**
 * AIAnalystEngine — composes a grounded, human-readable analysis.
 *
 * Every statement is derived from concrete signal/snapshot values and is
 * passed through the existing truth policy (`checkClaimIsSafe`) so no
 * forbidden claim (100% accuracy, guaranteed profits, ...) can be emitted.
 * Confidence is always labeled as conviction, never as a win probability.
 */

import type { MarketSnapshot } from "../types/market.js";
import type { Signal } from "../types/signal.js";
import { checkClaimIsSafe } from "../policy/truth_policy.js";
import { AIModelRouter } from "./ai_model_router.js";

export interface Analysis {
  /** Grounded summary text (policy-checked). */
  summary: string;
  /** Bullet points tied to concrete values. */
  bullets: string[];
  /** Direction from the signal, for display. */
  direction: Signal["direction"];
  /** True when the analysis passed the truth policy. */
  policySafe: boolean;
}

export class AIAnalystEngine {
  constructor(private readonly router: AIModelRouter) {}

  async analyze(signal: Signal, snapshot: MarketSnapshot): Promise<Analysis> {
    const convictionPct = (signal.confidence * 100).toFixed(1);
    const calibrationNote =
      signal.calibratedProbability !== undefined
        ? ` calibratedProbability=${(signal.calibratedProbability * 100).toFixed(1)}%`
        : " no validated calibration available (confidence is conviction, not probability)";

    const bullets: string[] = [
      `Asset ${snapshot.asset} @ ${snapshot.currentPrice} (${snapshot.timeframe})`,
      `Direction ${signal.direction} | score ${signal.score.toFixed(3)} | conviction ${convictionPct}%`,
      `Regime ${snapshot.marketRegime} | volatility ${snapshot.volatility.toFixed(4)}`,
      `Risk ${signal.riskStatus} | model ${signal.modelVersion} | data ${signal.dataQuality}`,
      `Evidence: ${signal.evidence.map((e) => e.kind).join(", ") || "none"} |${calibrationNote}`,
    ];

    const summary = [
      `TradeVision analysis for ${snapshot.asset}: ${signal.direction}.`,
      `The ensemble conviction is ${convictionPct}% (a model strength score, not a probability of winning).`,
      `Market regime is ${snapshot.marketRegime} with volatility ${snapshot.volatility.toFixed(4)}.`,
      `Paper-trading only; no real-money execution.`,
    ].join(" ");

    // Enforce the truth policy on every emitted string.
    const summaryCheck = checkClaimIsSafe(summary);
    const safeBullets = bullets.filter((b) => checkClaimIsSafe(b).safe);

    // Optionally enrich via the router (local transport by default).
    let routerNote = "";
    if (this.router.configured) {
      routerNote = await this.router.analyze(summary);
      if (!checkClaimIsSafe(routerNote).safe) routerNote = "[ai-blocked-by-policy]";
    }

    const finalSummary = summaryCheck.safe ? summary : summaryCheck.reason;

    return {
      summary: routerNote ? `${finalSummary} ${routerNote}` : finalSummary,
      bullets: safeBullets,
      direction: signal.direction,
      policySafe: summaryCheck.safe,
    };
  }
}
