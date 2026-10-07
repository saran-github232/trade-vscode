/**
 * PriceActionEngine — detects simple candlestick patterns.
 *
 * Produces Evidence entries for the SignalEngine. Pure and deterministic.
 */

import type { Candle } from "../types/market.js";
import type { Evidence } from "../types/signal.js";

/** Body and range helpers for the last candle. */
function body(c: Candle): number {
  return Math.abs(c.close - c.open);
}
function range(c: Candle): number {
  return c.high - c.low;
}
function isBull(c: Candle): boolean {
  return c.close > c.open;
}

export class PriceActionEngine {
  /** Detect patterns over the tail of the candle series. */
  analyze(candles: Candle[]): Evidence[] {
    const out: Evidence[] = [];
    if (candles.length < 3) return out;

    const prev = candles[candles.length - 2] as Candle;
    const last = candles[candles.length - 1] as Candle;

    // Bullish / bearish engulfing.
    if (!isBull(prev) && isBull(last) && last.close >= prev.open && last.open <= prev.close) {
      out.push({ kind: "bullish_engulfing", detail: "Last candle engulfs prior down candle." });
    }
    if (isBull(prev) && !isBull(last) && last.close <= prev.open && last.open >= prev.close) {
      out.push({ kind: "bearish_engulfing", detail: "Last candle engulfs prior up candle." });
    }

    // Pin bar / rejection wick (long lower wick => bullish rejection).
    const r = range(last);
    if (r > 0) {
      const lowerWick = Math.min(last.open, last.close) - last.low;
      const upperWick = last.high - Math.max(last.open, last.close);
      if (lowerWick / r > 0.6) {
        out.push({ kind: "bullish_pin", detail: "Long lower wick indicates downside rejection." });
      }
      if (upperWick / r > 0.6) {
        out.push({ kind: "bearish_pin", detail: "Long upper wick indicates upside rejection." });
      }
    }

    // Momentum: consecutive closes in one direction.
    const c2 = candles[candles.length - 3] as Candle;
    if (isBull(c2) && isBull(prev) && isBull(last)) {
      out.push({ kind: "up_streak", detail: "Three consecutive bullish closes." });
    }
    if (!isBull(c2) && !isBull(prev) && !isBull(last)) {
      out.push({ kind: "down_streak", detail: "Three consecutive bearish closes." });
    }

    // Tiny body => indecision.
    if (r > 0 && body(last) / r < 0.1) {
      out.push({ kind: "indecision", detail: "Doji-like candle; direction unclear." });
    }

    return out;
  }
}
