/**
 * ChartCaptureService — turns raw observed price data into a snapshot.
 *
 * This is a pure transformation layer. The content script observes price
 * data the user is already viewing and forwards it here; this service does
 * NOT interact with, automate, or modify the host platform in any way.
 */

import type { Candle, MarketSnapshot, Timeframe } from "../types/market.js";
import { MarketDataService } from "./market_data_service.js";

/** The shape of data a content script forwards after observing the page. */
export interface ObservedSeries {
  asset: string;
  timeframe: Timeframe;
  candles: Candle[];
  observedAt: number;
}

export class ChartCaptureService {
  constructor(private readonly marketData: MarketDataService) {}

  /** Validate observed series and convert to a MarketSnapshot. */
  capture(observed: ObservedSeries): MarketSnapshot | null {
    if (!observed.candles.length) return null;
    if (observed.candles.some((c) => !Number.isFinite(c.close) || c.close < 0)) {
      return null; // Reject malformed data (fail closed).
    }
    return this.marketData.buildSnapshot(
      observed.asset,
      observed.timeframe,
      observed.candles,
      observed.observedAt,
    );
  }
}
