/**
 * MultiTimeframeService — multi-timeframe analysis over legitimately
 * provided data only.
 *
 * Example: primary = 1m, context candidates = 5m / 15m / 30m / 1h.
 * A context timeframe is included ONLY if the source actually provided it.
 * Missing ones are reported in `unavailable` — never fabricated.
 *
 * All snapshots (primary + context) are built by the same
 * MarketSnapshotBuilder, so features are consistent across timeframes.
 */

import type { MarketSnapshot, MultiTimeframeContext, Timeframe } from "../types/market.js";
import { MarketSnapshotBuilder, type BuildParams } from "./market_snapshot_builder.js";
import type { RawCandle } from "./candle_store.js";

/** Series per timeframe exactly as the source declared them. */
export type SeriesMap = Partial<Record<Timeframe, RawCandle[]>>;

export interface MultiTimeframeParams {
  asset: string;
  primary: Timeframe;
  series: SeriesMap;
  /** Observation timestamp shared across timeframes. */
  timestamp: number;
  /** Context candidates (defaults to the 5m/15m/30m/1h example). */
  candidates?: Timeframe[];
  /** Eval clock for staleness (live only). */
  now?: number;
}

export const DEFAULT_CONTEXT_CANDIDATES: Timeframe[] = ["5m", "15m", "30m", "1h"];

export interface MultiTimeframeResult {
  snapshot: MarketSnapshot;
  context: MultiTimeframeContext;
}

export class MultiTimeframeService {
  constructor(private readonly builder: MarketSnapshotBuilder) {}

  build(params: MultiTimeframeParams): MultiTimeframeResult {
    const candidates = (params.candidates ?? DEFAULT_CONTEXT_CANDIDATES).filter((tf) =>
      this.builder.timeframeManager.largerThan(params.primary).includes(tf),
    );

    const provided = (Object.keys(params.series) as Timeframe[]).filter(
      (tf) => (params.series[tf] ?? []).length > 0,
    );

    const { selected, unavailable } = this.builder.timeframeManager.selectContext(
      params.primary,
      candidates,
      provided,
    );

    const base: Omit<BuildParams, "timeframe" | "candles"> = {
      asset: params.asset,
      timestamp: params.timestamp,
      source: "structured",
      ...(params.now !== undefined ? { now: params.now } : {}),
    };

    // Primary (numerical source of truth for the signal).
    const primaryCandles = params.series[params.primary] ?? [];
    const snapshot = this.builder.build({ ...base, timeframe: params.primary, candles: primaryCandles });

    // Context snapshots — only provided timeframes.
    const related: MarketSnapshot[] = selected.map((tf) =>
      this.builder.build({ ...base, timeframe: tf, candles: params.series[tf] ?? [] }),
    );

    const context: MultiTimeframeContext = { primary: params.primary, related, unavailable };
    snapshot.context = context;

    return { snapshot, context };
  }
}
