/**
 * MarketSnapshotBuilder — the ONE feature-generation pipeline.
 *
 * Live analysis, backtesting, and replay all call this exact class so the
 * features a model sees in production are identical to the features it was
 * measured on. There is deliberately no second code path.
 *
 * Every snapshot it emits is self-describing:
 *   snapshotId, timestamp, asset, timeframe, dataVersion, featureVersion,
 *   source, and the full `quality` report.
 */

import type {
  Candle,
  CandleSource,
  DataQualityReport,
  IndicatorSet,
  MarketSnapshot,
  MultiTimeframeContext,
  TechnicalFeatures,
  Timeframe,
} from "../types/market.js";
import { IndicatorEngine } from "../indicators/indicator_engine.js";
import { FeatureEngineeringEngine } from "../ml/feature_engineering_engine.js";
import { MarketRegimeEngine } from "../services/market_regime_engine.js";
import { CandleStore, type RawCandle } from "./candle_store.js";
import { TimeframeManager } from "./timeframe_manager.js";
import { DataQualityEngine, type DataQualityOptions } from "./data_quality_engine.js";

/** Version tags stamped on every snapshot (override per pipeline release). */
export interface SnapshotVersions {
  dataVersion: string;
  featureVersion: string;
}

export const DEFAULT_VERSIONS: SnapshotVersions = {
  dataVersion: "ohlcv_v1",
  featureVersion: "features_v1",
};

export interface BuildParams {
  asset: string;
  timeframe: Timeframe;
  /** Raw candles (structured preferred). May contain defects — quality is scored. */
  candles: RawCandle[];
  /** Snapshot timestamp (epoch ms). */
  timestamp: number;
  source?: CandleSource;
  /** Override the data-version tag (defaults to the builder's version). */
  dataVersion?: string;
  /** Override the feature-version tag (defaults to the builder's version). */
  featureVersion?: string;
  /** Evaluation clock for staleness. Omit in replay/backtest. */
  now?: number;
  /** Overrides for the data-quality gate (threshold etc.). */
  quality?: DataQualityOptions;
  /** Optional higher-timeframe context from legitimately provided data. */
  context?: MultiTimeframeContext;
}

/** Deterministic 32-bit FNV-1a hash -> fixed-width hex. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export class MarketSnapshotBuilder {
  readonly candleStore: CandleStore;
  readonly timeframeManager: TimeframeManager;
  readonly qualityEngine: DataQualityEngine;
  private readonly indicators = new IndicatorEngine();
  private readonly features = new FeatureEngineeringEngine();
  private readonly regime = new MarketRegimeEngine();
  readonly versions: SnapshotVersions;

  constructor(opts: {
    versions?: Partial<SnapshotVersions>;
    candleStore?: CandleStore;
    timeframeManager?: TimeframeManager;
    qualityEngine?: DataQualityEngine;
  } = {}) {
    this.timeframeManager = opts.timeframeManager ?? new TimeframeManager();
    this.candleStore = opts.candleStore ?? new CandleStore({ timeframeManager: this.timeframeManager });
    this.qualityEngine =
      opts.qualityEngine ??
      new DataQualityEngine({ candleStore: this.candleStore, timeframeManager: this.timeframeManager });
    this.versions = { ...DEFAULT_VERSIONS, ...opts.versions };
  }

  /** Build a snapshot. Deterministic for identical inputs. */
  build(params: BuildParams): MarketSnapshot {
    const { asset, timeframe, timestamp } = params;
    const source: CandleSource = params.source ?? "structured";
    const dataVersion = params.dataVersion ?? this.versions.dataVersion;
    const featureVersion = params.featureVersion ?? this.versions.featureVersion;

    // 1. Score the RAW input (fail-closed gate).
    const quality: DataQualityReport = this.qualityEngine.evaluate(params.candles, timeframe, {
      ...params.quality,
      ...(params.now !== undefined ? { now: params.now } : {}),
    });

    // 2. Normalize (dedup/sort/drop invalid) — never fabricate a candle.
    const { candles } = this.candleStore.normalize(params.candles, timeframe);

    // 3. The shared feature-generation pipeline (identical everywhere).
    const indicators: IndicatorSet = this.indicators.compute(candles);
    const technicalFeatures: TechnicalFeatures = this.features.compute(candles, indicators);
    const volatility = technicalFeatures.volatility;
    const marketRegime = this.regime.classify(candles, volatility);
    const last = candles[candles.length - 1];

    const snapshot: MarketSnapshot = {
      snapshotId: snapshotId({ asset, timeframe, timestamp, dataVersion, featureVersion, source, quality, candles }),
      asset,
      timestamp,
      timeframe,
      dataVersion,
      featureVersion,
      source,
      candles,
      currentPrice: last ? last.close : 0,
      indicators,
      technicalFeatures,
      marketRegime,
      volatility,
      dataQuality: quality.grade,
      quality,
    };

    if (params.context) snapshot.context = params.context;
    return snapshot;
  }

  /** Flatten a snapshot into the ordered ML feature vector (shared). */
  featureVector(snapshot: MarketSnapshot): number[] {
    return this.features.toVector(snapshot.technicalFeatures);
  }
}

/**
 * Content-addressed, deterministic id. Identical inputs (including the
 * quality score) always produce the same id — a replay of the same window
 * yields the same id as the live build.
 */
function snapshotId(args: {
  asset: string;
  timeframe: Timeframe;
  timestamp: number;
  dataVersion: string;
  featureVersion: string;
  source: CandleSource;
  quality: DataQualityReport;
  candles: Candle[];
}): string {
  const { candles } = args;
  const head = candles[0];
  const tail = candles[candles.length - 1];
  const key = [
    args.asset,
    args.timeframe,
    args.timestamp,
    args.dataVersion,
    args.featureVersion,
    args.source,
    args.quality.score,
    candles.length,
    head ? head.openTime : "none",
    tail ? tail.openTime : "none",
    tail ? tail.close : "none",
  ].join("|");
  return `${fnv1a(key)}${fnv1a(`${key}|tradevision`)}`;
}

