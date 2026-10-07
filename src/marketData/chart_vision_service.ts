/**
 * ChartVisionService — screenshot / chart-vision FALLBACK.
 *
 * Priority rule: STRUCTURED MARKET DATA > IMAGE INTERPRETATION.
 *
 * When legitimate structured candle data is available, it is the numerical
 * source of truth and this service is not consulted for numbers. This service
 * exists only for the case where structured data is unavailable: it extracts
 * *visual context* (trend impression, chart structure, named patterns) and
 * deliberately CANNOT produce numerical prices or indicator values.
 *
 * Any numeric hint an underlying extractor returns is dropped and reported.
 * The result is therefore always non-numeric, which forces downstream
 * analysis to NO_TRADE (fail closed) rather than invent a price.
 */

/** Opaque reference to a captured screenshot (pixels stay local). */
export interface VisionImage {
  ref: string;
  capturedAt: number;
}

/** What an underlying (pluggable) extractor may return — may contain numbers. */
export interface RawVisionHints {
  trendBias?: "up" | "down" | "flat" | "unknown";
  structure?: string[];
  patterns?: string[];
  levels?: string[];
  notes?: string[];
  /** Rejected by design: vision must never contribute prices. */
  numericPrices?: number[];
  /** Rejected by design: vision must never contribute indicator values. */
  indicatorValues?: { name: string; value: number }[];
}

/**
 * Qualitative visual context. `numericPrices` and `indicatorValues` are
 * ALWAYS empty arrays — the service guarantees this by construction.
 */
export interface VisualContext {
  imageRef: string;
  capturedAt: number;
  trendBias: "up" | "down" | "flat" | "unknown";
  /** Chart structure observations, descriptive only. */
  structure: string[];
  /** Named chart patterns (names only, no measured targets). */
  patterns: string[];
  /** Support/resistance described in words — never as a price. */
  levels: string[];
  notes: string[];
  confidenceLabel: "low" | "medium" | "high";
  /** Always [] — enforced. Vision never supplies a price. */
  numericPrices: number[];
  /** Always [] — enforced. Vision never supplies an indicator value. */
  indicatorValues: { name: string; value: number }[];
}

/** Pluggable adapter so a real local vision model can be wired in later. */
export interface VisionExtractor {
  id: string;
  extract(image: VisionImage): RawVisionHints;
}

/** Price-like token: decimal number (1.1234 / 105.5) or 4+ digit run (10500). */
const PRICE_LIKE = /\d+\.\d+|\d{4,}/;

/** Deterministic, conservative default: no numbers, unknown trend. */
export class DefaultVisionExtractor implements VisionExtractor {
  readonly id = "default-vision-v1";
  extract(image: VisionImage): RawVisionHints {
    return {
      trendBias: "unknown",
      structure: [],
      patterns: [],
      levels: [],
      notes: [`Captured ${image.ref} for qualitative review only.`],
    };
  }
}

/** Result of a vision pass, including any dropped numeric attempts. */
export interface VisionResult {
  context: VisualContext;
  /** Number of numeric hints the extractor tried to inject (all dropped). */
  droppedNumericAttempts: number;
  /** Always false: vision can never back a numeric snapshot. */
  numericSnapshotAvailable: false;
}

export class ChartVisionService {
  private readonly extractor: VisionExtractor;

  constructor(extractor: VisionExtractor = new DefaultVisionExtractor()) {
    this.extractor = extractor;
  }

  /** Extract sanitized, strictly qualitative visual context. */
  extractContext(image: VisionImage): VisionResult {
    const hints = this.extractor.extract(image);

    const dropped =
      (hints.numericPrices?.length ?? 0) + (hints.indicatorValues?.length ?? 0);

    const sanitize = (arr: string[] | undefined): string[] =>
      (arr ?? []).filter((s) => !PRICE_LIKE.test(s));

    const context: VisualContext = {
      imageRef: image.ref,
      capturedAt: image.capturedAt,
      trendBias: hints.trendBias ?? "unknown",
      structure: sanitize(hints.structure),
      patterns: sanitize(hints.patterns),
      levels: sanitize(hints.levels),
      notes: sanitize(hints.notes),
      confidenceLabel: "low",
      // Hard guarantees — never populated from vision.
      numericPrices: [],
      indicatorValues: [],
    };

    return { context, droppedNumericAttempts: dropped, numericSnapshotAvailable: false };
  }

  /**
   * Runtime invariant: a VisualContext must never carry a price or indicator
   * value. Throws when violated (defense in depth against a bad extractor).
   */
  static assertNoNumericClaims(context: VisualContext): void {
    if (context.numericPrices.length !== 0) {
      throw new Error("Vision context attempted to carry numeric prices.");
    }
    if (context.indicatorValues.length !== 0) {
      throw new Error("Vision context attempted to carry indicator values.");
    }
  }

  /** Convert visual context into explicitly non-numeric evidence. */
  toEvidence(result: VisionResult): { kind: "visual"; detail: string }[] {
    ChartVisionService.assertNoNumericClaims(result.context);
    const c = result.context;
    const parts: string[] = [`Visual context (non-numeric, confidence ${c.confidenceLabel})`];
    if (c.trendBias !== "unknown") parts.push(`impression: ${c.trendBias}`);
    if (c.structure.length) parts.push(c.structure.join("; "));
    if (c.patterns.length) parts.push(c.patterns.join("; "));
    if (c.levels.length) parts.push(c.levels.join("; "));
    return [{ kind: "visual", detail: `${parts.join(" | ")}.` }];
  }
}
