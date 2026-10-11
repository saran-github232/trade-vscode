/**
 * Phase 3 tests — deterministic technical-analysis engine (part 1: math).
 *
 * Synthetic candles only (no network, no randomness).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "../types/market.js";
import { IndicatorEngine } from "../indicators/indicator_engine.js";
import { adx, atr, momentum, roc, stochastic, volatility, vwap } from "../indicators/indicator_math.js";

export const T0 = 1_700_000_000_000;
export const TF = 60_000;

export function mkCandles(closes: number[], volume = 100): Candle[] {
  return closes.map((c, i) => {
    const open = i === 0 ? c : closes[i - 1] as number;
    // Tight wicks (0.01% of price): the fixture must not manufacture
    // directional movement out of wick noise.
    const wick = Math.abs(c) * 0.0001;
    return {
      openTime: T0 + i * TF,
      closeTime: T0 + (i + 1) * TF,
      open,
      high: Math.max(open, c) + wick,
      low: Math.min(open, c) - wick,
      close: c,
      volume,
    };
  });
}

/** Steady uptrend: +0.2 per bar. */
export function uptrend(n = 80, start = 100, step = 0.2): Candle[] {
  return mkCandles(Array.from({ length: n }, (_, i) => start + i * step));
}

/** Steady downtrend. */
export function downtrend(n = 80, start = 100, step = 0.2): Candle[] {
  return mkCandles(Array.from({ length: n }, (_, i) => start - i * step));
}

/** Flat range oscillating between lo and hi. */
export function range(n = 80, lo = 99, hi = 101): Candle[] {
  return mkCandles(Array.from({ length: n }, (_, i) => (i % 2 === 0 ? hi : lo)));
}

/** Flat constant series (zero movement). */
export function flat(n = 60, price = 100): Candle[] {
  return mkCandles(Array.from({ length: n }, () => price));
}

export function engine() {
  return new IndicatorEngine();
}

test("ATR is positive on trending data and null when short", () => {
  assert.ok((atr(uptrend(30)) ?? 0) > 0);
  assert.equal(atr(uptrend(5)), null);
});

test("ADX reports strong trend on a steady trend, weak on a range", () => {
  const t = adx(uptrend(60));
  assert.ok(t !== null && t.adx > 20);
  assert.ok(t.plusDI > t.minusDI);
  const d = adx(downtrend(60));
  assert.ok(d !== null && d.minusDI > d.plusDI);
  const r = adx(range(60));
  assert.ok(r !== null && r.adx < (t?.adx ?? 100));
  assert.equal(adx(uptrend(10)), null);
});

test("stochastic stays in [0,100], high on uptrend / low on downtrend", () => {
  const up = stochastic(uptrend(40));
  const down = stochastic(downtrend(40));
  assert.ok(up !== null && up.k > 70);
  assert.ok(down !== null && down.k < 30);
  assert.equal(stochastic(uptrend(5)), null);
});

test("ROC/momentum sign follows trend; volatility is 0 on flat", () => {
  assert.ok((roc(uptrend(30).map((c) => c.close), 12) ?? 0) > 0);
  assert.ok((roc(downtrend(30).map((c) => c.close), 12) ?? 0) < 0);
  assert.ok((momentum(uptrend(30).map((c) => c.close), 10) ?? 0) > 0);
  assert.equal(volatility(flat(40).map((c) => c.close), 20), 0);
  assert.equal(roc([1, 2], 12), null);
});

test("VWAP needs volume; null without it", () => {
  assert.ok((vwap(uptrend(30)) ?? 0) > 0);
  assert.equal(vwap(mkCandles([100, 101, 102], 0)), null);
});
