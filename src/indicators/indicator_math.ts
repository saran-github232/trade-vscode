/**
 * IndicatorEngine — computes technical indicators from candles.
 *
 * Pure and deterministic: same candles in -> same IndicatorSet out.
 * Returns `null` for any indicator that lacks sufficient history rather
 * than emitting a misleading number.
 */

/** Compute an SMA over closes; null if fewer than `period` values. */
export function sma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i] as number;
  }
  return sum / period;
}

/** Compute an EMA over closes; null if fewer than `period` values. */
export function ema(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values.
  let acc = 0;
  for (let i = 0; i < period; i++) acc += values[i] as number;
  let prev = acc / period;
  for (let i = period; i < values.length; i++) {
    prev = (values[i] as number) * k + prev * (1 - k);
  }
  return prev;
}

/** Wilder-smoothed RSI (0-100); null if not enough data. */
export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period || period <= 0) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = (values[i] as number) - (values[i - 1] as number);
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = (values[i] as number) - (values[i - 1] as number);
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Standard deviation helper. */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Compute MACD (12,26,9); null if not enough data. */
export function macd(values: number[]): { line: number; signal: number; histogram: number } | null {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  if (fast === null || slow === null) return null;
  const line = fast - slow;
  // Approximate signal line from the line series.
  const lineSeries: number[] = [];
  for (let i = 25; i < values.length; i++) {
    const f = ema(values.slice(0, i + 1), 12);
    const s = ema(values.slice(0, i + 1), 26);
    if (f !== null && s !== null) lineSeries.push(f - s);
  }
  const signal = ema(lineSeries, 9);
  if (signal === null) return null;
  return { line, signal, histogram: line - signal };
}

/** Compute Bollinger bands (20, 2); null if not enough data. */
export function bollinger(values: number[], period = 20): { mid: number; upper: number; lower: number } | null {
  const mid = sma(values, period);
  if (mid === null || values.length < period) return null;
  const window = values.slice(values.length - period);
  const sd = stddev(window);
  return { mid, upper: mid + 2 * sd, lower: mid - 2 * sd };
}
