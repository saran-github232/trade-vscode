/**
 * Single source of truth for TradeVision AI domain models.
 *
 * Every model is labeled with the exact evaluation period and dataset that
 * produced any reported statistic. No statistic may exist without a
 * (period, dataset) pair.
 */

/** The canonical prediction outcome. NO_TRADE is a valid, first-class outcome. */
export enum Outcome {
  SIGNAL = "SIGNAL",
  NO_TRADE = "NO_TRADE",
}

/** A labeled signal: what to trade + why it is safe to trade. */
export interface LabeledSignal {
  /** The raw market signal (e.g., buy / sell / flat). */
  rawSignal: "BUY" | "SELL" | "FLAT";
  outcome: Outcome;
  /** Free-text reason, always grounded in validated evidence. */
  reason: string;
  /** Which data generation / validation run produced this signal. */
  provenance: string;
}

/** A metric record always carries the exact evaluation window + dataset. */
export interface LabeledMetric<T extends number | string | Record<string, number> = Record<string, number>> {
  /** The exact evaluation period, e.g. "2024-01-01..2024-06-30". */
  period: string;
  /** The exact dataset identifier, e.g. "oos_ch3_5m_v4". */
  dataset: string;
  /** Raw measured value(s). */
  value: T;
}

/** Canonical scalar metrics reported in a validation record. */
export interface ScalarMetrics {
  /** Fraction of in-period outcomes correctly ranked by the model. */
  validationAccuracy: number;
  /** Fraction of positive calls that were actually profitable. */
  precision: number;
  /** Fraction of actual positives that the model captured. */
  recall: number;
  /** Fraction of executed signals that were profitable. */
  winRate: number;
  /** Expected value per signal = mean(pnl / |position|) across signals. */
  expectedValue: number;
  /** Gross profit / |gross loss|. */
  profitFactor: number;
  /** Largest peak-to-trough equity decline in the evaluation period. */
  maxDrawdown: number;
  /** Expected calibration error between predicted confidence and realized frequency. */
  calibrationError: number;
  /** Risk-adjusted return per unit of volatility (not a guarantee). */
  sharpeLike: number;
  /** Number of executed signals. */
  numberOfTrades: number;
  /** Number of NO_TRADE decisions executed. */
  numberOfNoTrade: number;
  /** Per-signal PnL in the evaluation period. */
  perTradePnL: number[];
}


/** A full validation record for one model + one dataset. */
export interface ValidationRecord {
  /** Model identifier (e.g. "enriched_logistic_v3"). */
  modelId: string;
  /** Dataset identifier (e.g. "oos_ch3_5m_v4"). */
  dataset: string;
  /** Evaluation period (e.g. "2024-01-01..2024-06-30"). */
  period: string;
  /** Source of the features and labeling. Only "real_out_of_sample" is acceptable. */
  origin: "real_out_of_sample" | "synthetic_or_backtested_nominal";
  /** Metrics for this candidate model. */
  metrics: ScalarMetrics;
  /** Baselines the candidate must beat on unseen data. */
  baselines: BaselineComparison[];
  /** Enforced pass/fail for each validation axis. */
  checks: ValidationCheck[];
  /** Overall validation verdict. */
  verdict: "PASS" | "FAIL";
}

/** A baseline the candidate must beat on unseen data. */
export interface BaselineComparison {
  /** The baseline model. */
  baselineId: string;
  /** The metric being compared. */
  metric: BaselineMetric;
  /** The minimum improvement margin required. */
  requiredImprovement: number;
  /** Observed comparison result. */
  comparison: "BEAT" | "LOSE" | "INCONCLUSIVE";
}

/** A single enforced validation axis. Fails closed. */
export interface ValidationCheck {
  /** The axis being checked. */
  axis: ValidationAxis;
  /** PASS / FAIL. */
  passed: boolean;
  /** Human-readable summary of the verdict and the exact period/dataset. */
  evidence: string;
}

/** The validation axes - covering all 12 priorities plus more. */
export enum ValidationAxis {
  OUT_OF_SAMPLE = "out_of_sample",
  WALK_FORWARD = "walk_forward",
  POSITIVE_EXPECTED_VALUE = "positive_expected_value",
  REGIME_STABILITY = "regime_stability",
  MAX_DRAWDOWN = "max_drawdown",
  ACROSS_ASSETS = "across_assets",
  ACROSS_TIMEFRAMES = "across_timeframes",
  CALIBRATION = "calibration",
  MODEL_STABILITY = "model_stability",
  REPRODUCIBILITY = "reproducibility",
  NO_LEAKAGE = "no_leakage",
  NO_OVERFITTING = "no_overfitting",
}

/** Baseline metric names. */
export enum BaselineMetric {
  VALIDATION_ACCURACY = "validationAccuracy",
  PRECISION = "precision",
  RECALL = "recall",
  WIN_RATE = "winRate",
  EXPECTED_VALUE = "expectedValue",
  PROFIT_FACTOR = "profitFactor",
  SHARPE_LIKE = "sharpeLike",
  CALIBRATION_ERROR = "calibrationError",
  MAX_DRAWDOWN = "maxDrawdown",
}

/** Provenance history for a model attempting to reach production. */
export interface ModelProvenance {
  candidateId: string;
  validation: ValidationRecord;
  challenger?: ChallengerRecord;
  isProduction: boolean;
  promotionTimestamp: string;
}

/** A Challenger's validation record for a Champion vs Challenger gate. */
export interface ChallengerRecord {
  challengerId: string;
  evaluation: { period: string; dataset: string };
  robustImprovement: boolean;
  headToHead: LabeledMetric<Record<string, number>>;
}

/** The decision pipeline result. Never emits an ungrounded signal. */
export interface DecisionResult {
  outcome: Outcome;
  labeledSignal: LabeledSignal;
  validationRecord: ValidationRecord;
}

/** The production promotion request. */
export interface PromotionRequest {
  candidateId: string;
  challengerId?: string;
  championId: string;
  baselineDatasets: string[];
  championVsChallenger: LabeledMetric<Record<string, number>>;
}

/** The outcome of a promotion decision. Fails closed: never auto-promotes. */
export interface PromotionResult {
  promoted: boolean;
  promotedId: string;
  reason: string;
  evidence: string;
}

/** Transfer function from (features, event) -> (rawSignal, confidence). */
export interface TransferFunction {
  predict(features: FeatureVector): PredictionResult;
}

/** A single prediction with confidence and a NO_TRADE option. */
export interface PredictionResult {
  outcome: Outcome;
  rawSignal: "BUY" | "SELL" | "FLAT";
  confidence: number;
  reason: string;
  provenance: string;
}

/** Feature vector for a candle/event. */
export interface FeatureVector {
  timestamp: number;
  asset: string;
  timeframe: string;
  values: Record<string, number>;
}
