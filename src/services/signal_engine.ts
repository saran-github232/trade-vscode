/**
 * SignalEngine — orchestrates the analysis pipeline into a single Signal.
 *
 * Flow: features -> ML votes -> ensemble -> confidence -> risk gate.
 * Output uses the UP / DOWN / NO_TRADE vocabulary. The risk engine can
 * always downgrade a directional call to NO_TRADE (fail closed).
 */

import type { MarketSnapshot } from "../types/market.js";
import type { Evidence, ModelVote, RiskStatus, Signal } from "../types/signal.js";
import { EnsembleEngine } from "../ensemble/ensemble_engine.js";
import { ConfidenceEngine, type Calibrator } from "../ensemble/confidence_engine.js";
import { RiskEngine } from "../risk/risk_engine.js";
import { MLInferenceEngine } from "../ml/ml_inference_engine.js";
import { PriceActionEngine } from "./price_action_engine.js";

export interface SignalEngineDeps {
  models: MLInferenceEngine[];
  risk?: RiskEngine;
  ensemble?: EnsembleEngine;
  confidence?: ConfidenceEngine;
  priceAction?: PriceActionEngine;
  /** Optional validated calibrator; must match the production model version. */
  calibrator?: Calibrator;
  /** The model version reported on signals (defaults to first model). */
  modelVersion?: string;
}

export class SignalEngine {
  private readonly ensemble: EnsembleEngine;
  private readonly confidence: ConfidenceEngine;
  private readonly risk: RiskEngine;
  private readonly priceAction: PriceActionEngine;

  constructor(private readonly deps: SignalEngineDeps) {
    this.ensemble = deps.ensemble ?? new EnsembleEngine();
    this.confidence = deps.confidence ?? new ConfidenceEngine();
    this.risk = deps.risk ?? new RiskEngine();
    this.priceAction = deps.priceAction ?? new PriceActionEngine();
  }

  /** Produce a signal for the current snapshot. Never throws. */
  analyze(snapshot: MarketSnapshot, features: number[]): Signal {
    const modelVersion =
      this.deps.modelVersion ?? this.deps.models[0]?.version ?? "unknown";

    // Collect votes from every model.
    const votes: ModelVote[] = this.deps.models.map((m) => m.predict(features));

    // Ensemble decides direction + conviction.
    const decision = this.ensemble.decide(votes);

    // Confidence (conviction, not probability) + optional calibration.
    const conf = this.confidence.compute(votes, this.deps.calibrator, modelVersion);

    // Risk gate can force NO_TRADE.
    const riskDecision = this.risk.evaluate(decision.direction, conf.confidence, snapshot);

    // Evidence: technical verdict (Phase 3) + price action + regime.
    const evidence: Evidence[] = [];
    if (snapshot.technical) {
      const t = snapshot.technical;
      evidence.push({
        kind: `technical_${t.direction.toLowerCase()}`,
        detail: `Technical verdict ${t.direction} (score ${t.score.toFixed(2)}, ${t.trendState.toLowerCase()}): ` +
          t.evidence.slice(0, 5).map((e) => e.detail).join(" "),
      });
      for (const e of t.evidence.slice(0, 6)) {
        if (e.kind === "technical_verdict" || e.kind === "technical_insufficient") continue;
        evidence.push({ kind: e.kind, detail: e.detail });
      }
    }
    evidence.push(...this.priceAction.analyze(snapshot.candles));
    evidence.push({
      kind: "regime",
      detail: `Market regime: ${snapshot.marketRegime}.`,
    });
    if (riskDecision.status !== "ok") {
      evidence.push({ kind: "risk", detail: riskDecision.reason });
    }

    const direction = riskDecision.direction;
    const riskStatus: RiskStatus = riskDecision.status;

    const signal: Signal = {
      direction,
      score: decision.score,
      confidence: conf.confidence,
      timestamp: snapshot.timestamp,
      timeframe: snapshot.timeframe,
      evidence,
      modelVotes: votes,
      riskStatus,
      modelVersion,
      dataQuality: snapshot.dataQuality,
    };

    // Only attach calibrated probability when the calibrator validated it.
    if (conf.calibratedProbability !== undefined) {
      signal.calibratedProbability = conf.calibratedProbability;
    }

    return signal;
  }
}
