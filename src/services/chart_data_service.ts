/**
 * ChartDataService — maintains rolling candle series per asset/timeframe.
 *
 * Local-first buffer: the content script (or an import) pushes candles;
 * consumers query the tail. Pure data plumbing, no network.
 */

import type { Candle, Timeframe } from "../types/market.js";

type SeriesKey = string;

export class ChartDataService {
  private readonly series = new Map<SeriesKey, Candle[]>();
  private readonly maxLen: number;

  constructor(maxLen = 1000) {
    this.maxLen = maxLen;
  }

  private key(asset: string, tf: Timeframe): SeriesKey {
    return `${asset}|${tf}`;
  }

  /** Append candles (oldest first) and trim to the retained window. */
  push(asset: string, tf: Timeframe, candles: Candle[]): void {
    const k = this.key(asset, tf);
    const existing = this.series.get(k) ?? [];
    const merged = [...existing, ...candles].sort((a, b) => a.openTime - b.openTime);
    // De-duplicate by openTime.
    const seen = new Map<number, Candle>();
    for (const c of merged) seen.set(c.openTime, c);
    const deduped = [...seen.values()].sort((a, b) => a.openTime - b.openTime);
    this.series.set(k, deduped.slice(-this.maxLen));
  }

  /** Get the most recent `n` candles for a series (oldest first). */
  tail(asset: string, tf: Timeframe, n: number): Candle[] {
    const s = this.series.get(this.key(asset, tf)) ?? [];
    return s.slice(-n);
  }

  /** Number of candles buffered for a series. */
  count(asset: string, tf: Timeframe): number {
    return (this.series.get(this.key(asset, tf)) ?? []).length;
  }

  clear(asset?: string, tf?: Timeframe): void {
    if (asset && tf) this.series.delete(this.key(asset, tf));
    else this.series.clear();
  }
}
