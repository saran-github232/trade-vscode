/**
 * ChartCaptureService — structured-first capture with a vision fallback.
 *
 * PRIORITY: STRUCTURED MARKET DATA > IMAGE INTERPRETATION.
 *
 * When a content script forwards real candle data, that is the numerical
 * source of truth: it is validated, quality-scored, and turned into a
 * MarketSnapshot (staleness is evaluated against `observedAt`).
 *
 * Only when NO structured candles are available does the service fall back
 * to the screenshot/chart-vision path, which yields qualitative visual
 * context only — never a numerical snapshot — so downstream analysis fails
 * closed to NO_TRADE instead of inventing a price.
 *
 * This is a pure transformation layer. The content script observes data the
 * user is already viewing; this service does NOT interact with, automate,
 * or modify the host platform in any way.
 */

import type { Candle, MarketSnapshot, Timeframe } from "../types/market.js";
import { MarketDataService } from "./market_data_service.js";
import {
  ChartVisionService,
  type VisionImage,
  type VisionResult,
} from "../marketData/chart_vision_service.js";

/** The shape of data a content script forwards after observing the page. */
export interface ObservedSeries {
  asset: string;
  timeframe: Timeframe;
  candles: Candle[];
  observedAt: number;
}

/** Unified capture outcome covering both the structured and vision paths. */
export interface CaptureResult {
  /** Numerical snapshot — non-null only when structured data passed quality. */
  snapshot: MarketSnapshot | null;
  /** Qualitative visual context when a screenshot was supplied. */
  vision: VisionResult | null;
  /** Which path (if any) produced a numerical source of truth. */
  numericSource: "structured" | "none";
  reason: string;
}

export class ChartCaptureService {
  private readonly vision: ChartVisionService;

  constructor(
    private readonly marketData: MarketDataService,
    vision?: ChartVisionService,
  ) {
    this.vision = vision ?? new ChartVisionService();
  }

  /**
   * Structured path (preferred). Returns a quality-scored snapshot, or null
   * when there is no candle data at all (fail closed).
   */
  capture(observed: ObservedSeries): MarketSnapshot | null {
    if (!observed.candles.length) return null;
    if (observed.candles.some((c) => !Number.isFinite(c.close) || c.close < 0)) {
      return null; // Reject malformed data (fail closed).
    }
    return this.marketData.builder.build({
      asset: observed.asset,
      timeframe: observed.timeframe,
      candles: observed.candles,
      timestamp: observed.observedAt,
      source: "structured",
      now: observed.observedAt, // staleness is meaningful at capture time
    });
  }

  /**
   * Capture with fallback: structured first; vision only when structured is
   * absent. Vision NEVER yields a numerical snapshot.
   */
  captureWithFallback(observed: ObservedSeries, image?: VisionImage): CaptureResult {
    const snapshot = this.capture(observed);

    if (snapshot) {
      if (!snapshot.quality.pass) {
        return {
          snapshot: null,
          vision: image ? this.vision.extractContext(image) : null,
          numericSource: "none",
          reason: `Structured data rejected: quality score ${snapshot.quality.score} < ${snapshot.quality.threshold}.`,
        };
      }
      return {
        snapshot,
        vision: image ? this.vision.extractContext(image) : null,
        numericSource: "structured",
        reason: "Structured candles accepted as numerical source of truth.",
      };
    }

    if (image) {
      const vision = this.vision.extractContext(image);
      return {
        snapshot: null,
        vision,
        numericSource: "none",
        reason: "No structured candles; vision fallback provides qualitative context only (no prices).",
      };
    }

    return { snapshot: null, vision: null, numericSource: "none", reason: "No structured data and no screenshot." };
  }
}
