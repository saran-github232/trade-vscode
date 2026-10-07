/**
 * Market domain types for TradeVision AI.
 *
 * MarketSnapshot is the single immutable input to the analysis pipeline.
 * Every downstream engine consumes a MarketSnapshot and never mutates it.
 */

/** Supported order types. UP/DOWN is the primary vocabulary (binary-friendly). */
export type Direction = "UP" | "DOWN" | "NO_TRADE";

/** Logical timeframes. Kept as a closed union for exhaustiveness checks. */
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/** Data-quality grade attached to every snapshot and every signal. */
export type DataQuality = "good" | "degraded" | "insufficient";

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

/** A snapshot of everything the pipeline needs about the current market. */
export interface MarketSnapshot {
  /** Symbol/asset identifier, e.g. "EURUSD", "BTCUSD". */
  asset: string;
  /** Epoch milliseconds (UTC) when this snapshot was taken. */
  timestamp: number;
  timeframe: Timeframe;
  /** Most recent candles, oldest first. */
  candles: Candle[];
  /** The latest observed price (last close). */
  currentPrice: number;
  indicators: IndicatorSet;
  technicalFeatures: TechnicalFeatures;
  marketRegime: MarketRegime;
  /** Realized volatility over the analysis window (0 = flat). */
  volatility: number;
  dataQuality: DataQuality;
}