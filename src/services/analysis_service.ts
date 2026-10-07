/**
 * AnalysisService — the single entry point that wires the pipeline.
 *
 * candles -> MarketSnapshot -> Signal -> policy-safe AI analysis.
 * Used identically by popup, sidepanel, background, and tests so every
 * surface produces the same grounded output.
 */

import type { Candle, MarketSnapshot, Timeframe } from "../types/market.js";
import type { Signal } from "../types/signal.js";
import { MarketDataService } from "./market_data_service.js";
import { SignalEngine } from "./signal_engine.js";
import { AIAnalystEngine, type Analysis } from "../ai/ai_analyst_engine.js";
import { AIModelRouter } from "../ai/ai_model_router.js";
import { MLInferenceEngine } from "../ml/ml_inference_engine.js";
import type { Calibrator } from "../ensemble/confidence_engine.js";
import { SignalHistory } from "../analytics/signal_history.js";
import { SnapshotStore } from "../marketData/snapshot_store.js";

export interface AnalysisOutput {
  snapshot: MarketSnapshot;
  signal: Signal;
  analysis: Analysis;
}

export interface AnalysisServiceConfig {
  defaultAsset: string;
  defaultTimeframe: Timeframe;
  calibrator?: Calibrator;
  /** Minimum 0-100 data-quality score to allow a directional signal. */
  minDataQuality?: number;
  /** Source tag stamped on snapshots. */
  source?: MarketSnapshot["source"];
}

export class AnalysisService {
  readonly marketData = new MarketDataService();
  readonly history = new SignalHistory();
  /** Every snapshot produced here is stored with its self-describing metadata. */
  readonly snapshotStore = new SnapshotStore();
  private readonly router = new AIModelRouter();
  private readonly analyst: AIAnalystEngine;
  private readonly signalEngine: SignalEngine;
  private readonly minDataQuality: number;

  constructor(private readonly cfg: AnalysisServiceConfig) {
    this.analyst = new AIAnalystEngine(this.router);
    this.signalEngine = new SignalEngine({
      models: [new MLInferenceEngine()],
      calibrator: cfg.calibrator,
      modelVersion: cfg.calibrator?.modelVersion,
    });
    this.minDataQuality = cfg.minDataQuality ?? 70;
  }

  /** Run the full pipeline over a candle series (shared builder pipeline). */
  async analyze(candles: Candle[], asset?: string, timeframe?: Timeframe): Promise<AnalysisOutput> {
    const a = asset ?? this.cfg.defaultAsset;
    const tf = timeframe ?? this.cfg.defaultTimeframe;
    const timestamp = candles.length > 0 ? (candles[candles.length - 1]?.closeTime ?? Date.now()) : Date.now();

    // Same MarketSnapshotBuilder used by backtest + replay (anti-drift).
    const snapshot = this.marketData.builder.build({
      asset: a,
      timeframe: tf,
      candles,
      timestamp,
      source: this.cfg.source ?? "structured",
      quality: { threshold: this.minDataQuality },
    });
    this.snapshotStore.save(snapshot);

    const features = this.marketData.featureVector(snapshot);
    let signal = this.signalEngine.analyze(snapshot, features);

    // Fail-closed belt: reject below-threshold data regardless of model output.
    if (snapshot.quality.pass === false && signal.direction !== "NO_TRADE") {
      signal = {
        ...signal,
        direction: "NO_TRADE",
        riskStatus: "blocked",
        evidence: [
          ...signal.evidence,
          {
            kind: "risk",
            detail: `Data quality ${snapshot.quality.score} below threshold ${snapshot.quality.threshold}; analysis rejected.`,
          },
        ],
      };
    }

    const analysis = await this.analyst.analyze(signal, snapshot);

    this.history.push(signal);

    return { snapshot, signal, analysis };
  }
}
