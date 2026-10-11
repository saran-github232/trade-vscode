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

/** Clamp helper (shared by the Phase 3 indicators below). */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Wilder smoothing over a series of per-bar values.
 * The first value seeds from the SMA of the first `period` entries so the
 * result is fully deterministic.
 */
function wilderSeries(values: number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];
  const out = new Array<number>(values.length);
  const seedEnd = Math.min(period, values.length);
  let acc = 0;
  for (let i = 0; i < seedEnd; i++) acc += values[i] as number;
  let prev = acc / seedEnd;
  for (let i = 0; i < values.length; i++) {
    if (i < seedEnd) {
      out[i] = prev;
    } else {
      prev = (prev * (period - 1) + (values[i] as number)) / period;
      out[i] = prev;
    }
  }
  return out;
}

type Hlc = { high: number; low: number; close: number };

/** True-range series for a candle list (same length as input). */
function trueRanges(candles: Hlc[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i] as Hlc;
    if (i === 0) {
      out.push(c.high - c.low);
    } else {
      const prevClose = (candles[i - 1] as Hlc).close;
      out.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
    }
  }
  return out;
}

/**
 * Average True Range (Wilder, period 14); null if not enough data.
 * Used by VolatilityEngine and for ATR-normalized breakout distances.
 */
export function atr(candles: Hlc[], period = 14): number | null {
  if (candles.length < period + 1 || period <= 0) return null;
  const smoothed = wilderSeries(trueRanges(candles), period);
  return smoothed[smoothed.length - 1] ?? null;
}

/**
 * Average Directional Index (Wilder, period 14) with +DI / -DI.
 * Null when history is insufficient. ADX is non-directional strength
 * (0-100); the DI spread gives the direction.
 *
 * Noise floor: directional movement below `DM_NOISE_FLOOR` (1%) of the
 * bar's true range is wick noise, not direction. Without this gate, a
 * perfectly flat market with micro-wicks yields one smoothed DM slightly
 * above the other; DX is scale-invariant, so it saturates at 100 and ADX
 * falsely reports a "perfect trend" on a range.
 */
export function adx(
  candles: Hlc[],
  period = 14,
): { adx: number; plusDI: number; minusDI: number } | null {
  if (candles.length < period * 2 + 1 || period <= 0) return null;
  const tr = trueRanges(candles);
  const dmNoiseFloor = 0.01;
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i] as Hlc;
    const prev = candles[i - 1] as Hlc;
    const upMove = cur.high - prev.high;
    const downMove = prev.low - cur.low;
    const floor = (tr[i] as number) * dmNoiseFloor;
    plusDM.push(upMove > downMove && upMove > floor ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > floor ? downMove : 0);
  }
  const sTR = wilderSeries(tr, period);
  const sPlus = wilderSeries(plusDM, period);
  const sMinus = wilderSeries(minusDM, period);
  const dx: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    // No directional movement on this bar (both DMs are wick noise) means
    // no trend evidence: DX would otherwise saturate at 100 from the decaying
    // Wilder-smoothed residue of a single past move, making a flat range
    // read as a "perfect trend".
    if ((plusDM[i] as number) === 0 && (minusDM[i] as number) === 0) {
      dx.push(0);
      continue;
    }
    const t = sTR[i] as number;
    if (t === 0) {
      dx.push(0);
      continue;
    }
    const pdi = (100 * ((sPlus[i] as number) / t));
    const mdi = (100 * ((sMinus[i] as number) / t));
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum);
  }
  const adxSeries = wilderSeries(dx, period);
  const adxVal = adxSeries[adxSeries.length - 1];
  if (adxVal === undefined) return null;
  const t = sTR[sTR.length - 1] as number;
  const plusDI = t === 0 ? 0 : (100 * ((sPlus[sPlus.length - 1] as number) / t));
  const minusDI = t === 0 ? 0 : (100 * ((sMinus[sMinus.length - 1] as number) / t));
  return { adx: clamp(adxVal, 0, 100), plusDI: clamp(plusDI, 0, 100), minusDI: clamp(minusDI, 0, 100) };
}

/**
 * Stochastic oscillator %K / %D (k=14, slowing=3, d=3); null if short.
 * %K = 100 * (close - lowestLow) / (highestHigh - lowestLow).
 */
export function stochastic(
  candles: Hlc[],
  kPeriod = 14,
  dPeriod = 3,
): { k: number; d: number } | null {
  if (candles.length < kPeriod + dPeriod || kPeriod <= 0 || dPeriod <= 0) return null;
  const rawK: number[] = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      const c = candles[j] as Hlc;
      if (c.high > hh) hh = c.high;
      if (c.low < ll) ll = c.low;
    }
    const close = (candles[i] as Hlc).close;
    const span = hh - ll;
    rawK.push(span === 0 ? 50 : (100 * (close - ll)) / span);
  }
  const slowed: number[] = [];
  for (let i = 2; i < rawK.length; i++) {
    slowed.push(((rawK[i - 2] as number) + (rawK[i - 1] as number) + (rawK[i] as number)) / 3);
  }
  const k = slowed[slowed.length - 1];
  if (k === undefined || slowed.length < dPeriod) return null;
  const tail = slowed.slice(slowed.length - dPeriod);
  const d = tail.reduce((a, b) => a + b, 0) / tail.length;
  return { k: clamp(k, 0, 100), d: clamp(d, 0, 100) };
}

/**
 * Rate of Change in percent: 100 * (last - nAgo) / nAgo. Null if short.
 */
export function roc(values: number[], period = 12): number | null {
  if (values.length <= period || period <= 0) return null;
  const last = values[values.length - 1] as number;
  const ago = values[values.length - 1 - period] as number;
  if (ago === 0) return null;
  return (100 * (last - ago)) / ago;
}

/** Momentum: last close minus close N periods ago (points). Null if short. */
export function momentum(values: number[], period = 10): number | null {
  if (values.length <= period || period <= 0) return null;
  return (values[values.length - 1] as number) - (values[values.length - 1 - period] as number);
}

/**
 * Realized volatility: sample std of simple returns over `period` bars.
 * Returns 0 (never null) when there is no measurable movement.
 */
export function volatility(values: number[], period = 20): number {
  if (values.length < 3 || period <= 1) return 0;
  const window = values.slice(Math.max(1, values.length - period));
  const rets: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1] as number;
    const cur = window[i] as number;
    rets.push(prev === 0 ? 0 : (cur - prev) / prev);
  }
  return stddev(rets);
}

/**
 * VWAP over the series (cumulative typical-price x volume / cum. volume).
 * Null when no volume info exists — callers treat VWAP as unavailable
 * ("where appropriate").
 */
export function vwap(
  candles: (Hlc & { volume?: number })[],
): number | null {
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const v = c.volume ?? 0;
    if (!Number.isFinite(v) || v <= 0) continue;
    pv += ((c.high + c.low + c.close) / 3) * v;
    vol += v;
  }
  if (vol <= 0) return null;
  return pv / vol;
}
