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

export interface AnalysisOutput {
  snapshot: MarketSnapshot;
  signal: Signal;
  analysis: Analysis;
}

export interface AnalysisServiceConfig {
  defaultAsset: string;
  defaultTimeframe: Timeframe;
  calibrator?: Calibrator;
}

export class AnalysisService {
  readonly marketData = new MarketDataService();
  readonly history = new SignalHistory();
  private readonly router = new AIModelRouter();
  private readonly analyst: AIAnalystEngine;
  private readonly signalEngine: SignalEngine;

  constructor(private readonly cfg: AnalysisServiceConfig) {
    this.analyst = new AIAnalystEngine(this.router);
    this.signalEngine = new SignalEngine({
      models: [new MLInferenceEngine()],
      calibrator: cfg.calibrator,
      modelVersion: cfg.calibrator?.modelVersion,
    });
  }

  /** Run the full pipeline over a candle series. */
  async analyze(candles: Candle[], asset?: string, timeframe?: Timeframe): Promise<AnalysisOutput> {
    const a = asset ?? this.cfg.defaultAsset;
    const tf = timeframe ?? this.cfg.defaultTimeframe;
    const timestamp = candles.length > 0 ? (candles[candles.length - 1]?.closeTime ?? Date.now()) : Date.now();

    const snapshot = this.marketData.buildSnapshot(a, tf, candles, timestamp);
    const features = this.marketData.featureVector(snapshot);
    const signal = this.signalEngine.analyze(snapshot, features);
    const analysis = await this.analyst.analyze(signal, snapshot);

    this.history.push(signal);

    return { snapshot, signal, analysis };
  }
}
