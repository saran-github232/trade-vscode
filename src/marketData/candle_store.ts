/**
 * CandleStore — normalizes, de-duplicates, orders, and buffers OHLCV candles.
 *
 * Structured candle data is the numerical source of truth. The store is a
 * pure, deterministic data layer: it never fabricates a candle and never
 * invents a value. Raw input may legitimately use `timestamp` (Phase 2 spec)
 * or `openTime` (internal) — both are accepted and normalized to `Candle`.
 */

import type { Candle, Timeframe } from "../types/market.js";
import { TimeframeManager } from "./timeframe_manager.js";

/**
 * Loose input shape accepted from any source. `timestamp` maps to `openTime`.
 * `closeTime` is optional and derived from the timeframe when omitted.
 */
export interface RawCandle {
  timestamp?: number;
  openTime?: number;
  closeTime?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Result of a normalization pass (counts only — no values are mutated). */
export interface NormalizeResult {
  candles: Candle[];
  /** Raw input size. */
  inputCount: number;
  duplicatesRemoved: number;
  reOrdered: number;
  invalidRemoved: number;
}

function isFinitePositive(n: number | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** A candle is structurally valid when OHLC relationships and finiteness hold. */
export function isValidOhlc(c: {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}): boolean {
  if (![c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v))) return false;
  if (!isFinitePositive(c.open) || !isFinitePositive(c.high) || !isFinitePositive(c.low) || !isFinitePositive(c.close)) {
    return false;
  }
  if (c.volume !== undefined && (!Number.isFinite(c.volume) || c.volume < 0)) return false;
  // OHLC envelope: high must cover open/close; low must be under open/close.
  if (c.high < c.open || c.high < c.close) return false;
  if (c.low > c.open || c.low > c.close) return false;
  if (c.high < c.low) return false;
  return true;
}

export class CandleStore {
  private readonly store = new Map<string, Candle[]>();
  private readonly maxLen: number;
  private readonly tfm: TimeframeManager;

  constructor(opts: { maxLen?: number; timeframeManager?: TimeframeManager } = {}) {
    this.maxLen = opts.maxLen ?? 2000;
    this.tfm = opts.timeframeManager ?? new TimeframeManager();
  }

  private key(asset: string, tf: Timeframe): string {
    return `${asset}|${tf}`;
  }

  /**
   * Normalize raw input into canonical `Candle[]`:
   *  - map `timestamp` -> `openTime`
   *  - derive `closeTime` from the timeframe when missing
   *  - drop structurally invalid OHLC
   *  - de-duplicate by `openTime` (last write wins)
   *  - sort strictly oldest-first
   *
   * Pure: does not touch stored state.
   */
  normalize(raw: RawCandle[], timeframe: Timeframe): NormalizeResult {
    const tfMs = this.tfm.durationMs(timeframe);
    const inputCount = raw.length;

    // 1. Map + derive, drop invalid.
    const mapped: Candle[] = [];
    let invalidRemoved = 0;
    for (const r of raw) {
      const openTime = r.openTime ?? r.timestamp;
      if (openTime === undefined || !Number.isFinite(openTime)) {
        invalidRemoved++;
        continue;
      }
      const volume = r.volume ?? 0;
      if (!isValidOhlc({ open: r.open, high: r.high, low: r.low, close: r.close, volume })) {
        invalidRemoved++;
        continue;
      }
      const closeTime = r.closeTime ?? openTime + tfMs;
      mapped.push({ openTime, closeTime, open: r.open, high: r.high, low: r.low, close: r.close, volume });
    }

    // 2. Sort by openTime and count how many were out of order.
    const sorted = [...mapped].sort((a, b) => a.openTime - b.openTime);
    let reOrdered = 0;
    for (let i = 0; i < mapped.length; i++) {
      if (mapped[i]!.openTime !== sorted[i]!.openTime) {
        reOrdered++;
      }
    }

    // 3. De-duplicate by openTime (last occurrence in original order wins).
    const byTime = new Map<number, Candle>();
    for (const c of sorted) byTime.set(c.openTime, c);
    const deduped = [...byTime.values()].sort((a, b) => a.openTime - b.openTime);
    const duplicatesRemoved = sorted.length - deduped.length;

    return {
      candles: deduped,
      inputCount,
      duplicatesRemoved,
      reOrdered,
      invalidRemoved,
    };
  }

  /**
   * Normalize and store candles for an asset/timeframe. Returns the stored
   * series (oldest first) trimmed to the retention window.
   */
  ingest(asset: string, timeframe: Timeframe, raw: RawCandle[]): Candle[] {
    const norm = this.normalize(raw, timeframe);
    const k = this.key(asset, timeframe);
    const existing = this.store.get(k) ?? [];
    const merged = [...existing, ...norm.candles];
    const byTime = new Map<number, Candle>();
    for (const c of merged) byTime.set(c.openTime, c);
    const deduped = [...byTime.values()].sort((a, b) => a.openTime - b.openTime);
    const trimmed = deduped.slice(-this.maxLen);
    this.store.set(k, trimmed);
    return trimmed;
  }

  /** Most recent `n` candles for a series (oldest first). */
  tail(asset: string, timeframe: Timeframe, n: number): Candle[] {
    return (this.store.get(this.key(asset, timeframe)) ?? []).slice(-n);
  }

  /** Full stored series (oldest first). */
  series(asset: string, timeframe: Timeframe): Candle[] {
    return [...(this.store.get(this.key(asset, timeframe)) ?? [])];
  }

  count(asset: string, timeframe: Timeframe): number {
    return (this.store.get(this.key(asset, timeframe)) ?? []).length;
  }

  clear(asset?: string, timeframe?: Timeframe): void {
    if (asset && timeframe) this.store.delete(this.key(asset, timeframe));
    else this.store.clear();
  }
}
