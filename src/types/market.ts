/**
 * Market domain types for TradeVision AI.
 *
 * MarketSnapshot is the single immutable input to the analysis pipeline.
 * Every downstream engine consumes a MarketSnapshot and never mutates it.
 */

/** Supported order types. UP/DOWN is the primary vocabulary (binary-friendly). */
export type Direction = "UP" | "DOWN" | "NO_TRADE";

/** Logical timeframes. Kept as a closed union for exhaustiveness checks. */
export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

/** Data-quality grade attached to every snapshot and every signal. */
export type DataQuality = "good" | "degraded" | "insufficient";

/** Where a candle series came from. Structured is the numerical source of truth. */
export type CandleSource = "structured" | "generator" | "replay" | "vision";

/** Machine-readable data-quality defect codes (Phase 2). */
export type DataQualityIssueCode =
  | "duplicate_candles"
  | "out_of_order"
  | "missing_candles"
  | "invalid_ohlc"
  | "stale_candles"
  | "timestamp_gaps"
  | "unrealistic_values"
  | "incomplete_data";

/** A single detected data-quality defect. */
export interface DataQualityIssue {
  code: DataQualityIssueCode;
  /** Human-readable explanation (never contains raw secrets or prices invented by vision). */
  message: string;
  /** How many candles triggered the defect (1 for series-level issues). */
  count: number;
  /** Points deducted from the 0-100 score. */
  penalty: number;
}

/**
 * Full data-quality report attached to every snapshot.
 * `score` is 0-100. Analysis is rejected when `pass === false`.
 */
export interface DataQualityReport {
  /** 0-100 composite score. */
  score: number;
  grade: DataQuality;
  /** Threshold the score was measured against. */
  threshold: number;
  /** True when the score meets the threshold (analysis allowed). */
  pass: boolean;
  issues: DataQualityIssue[];
  /** Candles supplied by the source (raw, before normalization). */
  evaluatedCount: number;
  /** Candles that survived normalization (dedup/sort/validity). */
  acceptedCount: number;
}

/** A single OHLCV candle. */
export interface Candle {
  /** Epoch milliseconds (UTC) of the candle open. */
  openTime: number;
  /** Epoch milliseconds (UTC) of the candle close. */
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Technical indicator outputs computed for the snapshot's asset/timeframe. */
export interface IndicatorSet {
  /** Simple moving average over close. */
  sma20: number | null;
  sma50: number | null;
  /** Exponential moving average over close. */
  ema12: number | null;
  ema26: number | null;
  /** Relative strength index (0-100). */
  rsi14: number | null;
  /** MACD line, signal line, and histogram. */
  macd: { line: number; signal: number; histogram: number } | null;
  /** Bollinger band mid/upper/lower. */
  bollinger: { mid: number; upper: number; lower: number } | null;
}

/** Derived technical features (normalized) fed into the ML feature vector. */
export interface TechnicalFeatures {
  /** Close-to-close return over the last candle. */
  return1: number;
  /** EMA12 - EMA26 normalized by price. */
  macdNorm: number;
  /** RSI rescaled to [-1, 1] (50 -> 0). */
  rsiNorm: number;
  /** Realized volatility (std of log returns) over the window. */
  volatility: number;
  /** Position of close within the recent high/low range [0, 1]. */
  rangePosition: number;
  /** Current close relative to SMA20 (normalized). */
  sma20Deviation: number;
  /** True if enough history existed to compute all features. */
  complete: boolean;
}

/** The detected market regime. */
export type MarketRegime = "trending_up" | "trending_down" | "ranging" | "volatile" | "unknown";

/**
 * Multi-timeframe context attached when higher timeframes are legitimately
 * available from the source. Timeframes the source does NOT provide are
 * simply absent — they are never fabricated.
 */
export interface MultiTimeframeContext {
  /** The snapshot's own (primary) timeframe. */
  primary: Timeframe;
  /** Higher-timeframe snapshots, ordered from smallest to largest duration. */
  related: MarketSnapshot[];
  /** Timeframes requested for context but unavailable from this source. */
  unavailable: Timeframe[];
}

/**
 * A snapshot of everything the pipeline needs about the current market.
 *
 * Every snapshot is self-describing so it can be persisted and replayed:
 * `snapshotId`, `timestamp`, `asset`, `timeframe`, `dataVersion`,
 * `featureVersion`, plus the full `quality` report.
 */
export interface MarketSnapshot {
  /** Stable, deterministic identifier for this exact snapshot content. */
  snapshotId: string;
  /** Symbol/asset identifier, e.g. "EURUSD", "BTCUSD". */
  asset: string;
  /** Epoch milliseconds (UTC) when this snapshot was taken. */
  timestamp: number;
  timeframe: Timeframe;
  /** Version tag for the raw candle/data pipeline that produced this snapshot. */
  dataVersion: string;
  /** Version tag for the feature-generation pipeline that produced this snapshot. */
  featureVersion: string;
  /** Where the underlying candles came from (structured is source of truth). */
  source: CandleSource;
  /** Most recent candles, oldest first. */
  candles: Candle[];
  /** The latest observed price (last close). */
  currentPrice: number;
  indicators: IndicatorSet;
  technicalFeatures: TechnicalFeatures;
  marketRegime: MarketRegime;
  /** Realized volatility over the analysis window (0 = flat). */
  volatility: number;
  /** Coarse grade derived from `quality.score`. */
  dataQuality: DataQuality;
  /** Full 0-100 data-quality report. Analysis is rejected when `pass === false`. */
  quality: DataQualityReport;
  /** Optional higher-timeframe context (only timeframes the source provided). */
  context?: MultiTimeframeContext;
}