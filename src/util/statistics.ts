/**
 * Deterministic statistics helpers for validation and reporting.
 *
 * These functions are pure and deterministic so that Phase 10 retraining
 * is reproducible: identical inputs yield identical outputs.
 */

/** Scalar metrics computed from a list of per-trade PnL values. */
export interface ScalarMetrics {
  validationAccuracy: number;
  precision: number;
  recall: number;
  winRate: number;
  expectedValue: number;
  profitFactor: number;
  maxDrawdown: number;
  calibrationError: number;
  sharpeLike: number;
  numberOfTrades: number;
  numberOfNoTrade: number;
  perTradePnL: number[];
}

/**
 * Compute scalar metrics from execution records.
 *
 * Each record is either a trade (pnl) or a NO_TRADE. This keeps the
 * numberOfTrades and numberOfNoTrade counts in tension with the raw
 * signal count.
 */
export interface TradeRecord {
  /** The pnl of the executed trade, or 0 for NO_TRADE. */
  pnl: number;
  /** Whether this was a real trade (1) or a NO_TRADE (0). */
  isTrade: number;
  /** Whether the trade was profitable (1) or not (0). */
  wasProfit: number;
  /** The predicted confidence for the signal. */
  confidence: number;
}

/**
 * Compute scalar metrics from an array of raw execution records.
 *
 * This is a deterministic implementation; the calibration error is a
 * simple reliability-diagram ECE with 10 confidence bins.
 */
export function computeScalarMetrics(records: TradeRecord[]): ScalarMetrics {
  const n = records.length;
  if (n === 0) {
    return {
      validationAccuracy: 0,
      precision: 0,
      recall: 0,
      winRate: 0,
      expectedValue: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      calibrationError: 0,
      sharpeLike: 0,
      numberOfTrades: 0,
      numberOfNoTrade: 0,
      perTradePnL: [],
    };
  }

  const isTradeSum = records.reduce((s, r) => s + r.isTrade, 0);
  const numberOfTrades = isTradeSum;
  const numberOfNoTrade = n - isTradeSum;

  // Count profitable trades among executed trades.
  const profitableTrades = records.reduce((s, r) => s + r.wasProfit, 0);

  // Win rate = profitable executed trades / executed trades.
  const winRate = numberOfTrades > 0 ? profitableTrades / numberOfTrades : 0;

  // Expected value = mean pnl per executed trade.
  const pnlSum = records.reduce((s, r) => s + r.pnl, 0);
  const expectedValue = numberOfTrades > 0 ? pnlSum / numberOfTrades : 0;

  // Profit factor = gross profit / |gross loss| across executed trades.
  let grossProfit = 0;
  let grossLoss = 0;
  for (const r of records) {
    if (r.isTrade === 0) continue;
    if (r.pnl > 0) grossProfit += r.pnl;
    else grossLoss += Math.abs(r.pnl);
  }
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Mean pnl across all records (for calibration/accuracy optics).
  const meanPnl = pnlSum / n;

  // Validation accuracy proxy: fraction of records where the predicted
  // direction matched the realized pnl sign. A simplified proxy for OOS.
  let correct = 0;
  for (const r of records) {
    if (r.isTrade === 0) continue;
    const predictedUp = r.pnl > 0;
    const actualUp = r.wasProfit === 1;
    if (predictedUp === actualUp) correct++;
  }
  const validationAccuracy =
    numberOfTrades > 0 ? correct / numberOfTrades : 0;

  // Precision = precision@positive_calls: fraction of positive-predicted
  // executed trades that were profitable. We treat pnl>0 as a positive call.
  let positiveCalls = 0;
  let truePositives = 0;
  for (const r of records) {
    if (r.isTrade === 0) continue;
    const predictedPositive = r.pnl > 0;
    if (predictedPositive) {
      positiveCalls++;
      if (r.wasProfit === 1) truePositives++;
    }
  }
  const precision = positiveCalls > 0 ? truePositives / positiveCalls : 0;

  // Recall = fraction of actually profitable trades that were predicted positive.
  const actualProfitable = records.filter((r) => r.isTrade === 1 && r.wasProfit === 1).length;
  const recall = actualProfitable > 0 ? truePositives / actualProfitable : 0;

  // Sharpe-like (annualized) — deterministic, descriptive only.
  const variance = records.reduce((s, r) => s + Math.pow(r.pnl, 2), 0) / n;
  const sharpeLike = variance > 0 ? Math.sqrt(252) * meanPnl / Math.sqrt(variance) : 0;

  // Max drawdown proxy: largest peak-to-trough decline in cumulative pnl.
  let peak = 0;
  let maxDD = 0;
  let cum = 0;
  for (const r of records) {
    cum += r.pnl;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }
  const maxDrawdown = maxDD / (peak + 1e-9);

  // Calibration error (reliability diagram, 10 bins).
  // Bins: [0.0-0.1, 0.1-0.2, ..., 0.9-1.0].
  const bins = 10;
  const binSize = 1 / bins;
  const binCount = new Array(bins).fill(0);
  const binSumConfidence = new Array(bins).fill(0);
  const binSumActual = new Array(bins).fill(0);

  for (const r of records) {
    if (r.isTrade === 0) continue;
    const binIndex = Math.min(
      bins - 1,
      Math.floor(r.confidence / binSize),
    );
    binCount[binIndex]++;
    binSumConfidence[binIndex] += r.confidence;
    binSumActual[binIndex] += r.wasProfit;
  }

  let calibrationError = 0;
  let binTotal = 0;
  for (let i = 0; i < bins; i++) {
    if (binCount[i] === 0) continue;
    const avgConf = binSumConfidence[i] / binCount[i];
    const avgActual = binSumActual[i] / binCount[i];
    calibrationError += binCount[i] * Math.abs(avgConf - avgActual);
    binTotal += binCount[i];
  }
  calibrationError = binTotal > 0 ? calibrationError / binTotal : 0;

  return {
    validationAccuracy,
    precision,
    recall,
    winRate,
    expectedValue,
    profitFactor,
    maxDrawdown,
    calibrationError,
    sharpeLike,
    numberOfTrades,
    numberOfNoTrade,
    perTradePnL: records.map((r) => r.pnl),
  };
}
