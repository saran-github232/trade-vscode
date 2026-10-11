/**
 * Phase 2 tests — Market Data & Chart Analysis Engine.
 *
 * Everything here is deterministic: seeded candles, fixed clocks, no I/O.
 * The critical invariant covered is that LIVE and BACKTEST/REPLAY share the
 * exact same MarketSnapshotBuilder feature pipeline.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { CandleStore, isValidOhlc, type RawCandle } from "../marketData/candle_store.js";
import { DataQualityEngine } from "../marketData/data_quality_engine.js";
import { MarketSnapshotBuilder } from "../marketData/market_snapshot_builder.js";
import { TimeframeManager } from "../marketData/timeframe_manager.js";
import { MultiTimeframeService } from "../marketData/multi_timeframe.js";
import { SnapshotStore } from "../marketData/snapshot_store.js";
import {
  ChartVisionService,
  type VisionExtractor,
  type VisionImage,
} from "../marketData/chart_vision_service.js";
import { MarketDataService, generateCandles } from "../services/market_data_service.js";
import { ChartCaptureService } from "../services/chart_capture_service.js";
import { AnalysisService } from "../services/analysis_service.js";
import { SignalEngine } from "../services/signal_engine.js";
import { RiskEngine } from "../risk/risk_engine.js";
import { MLInferenceEngine } from "../ml/ml_inference_engine.js";
import { BacktestingEngine } from "../backtesting/backtesting_engine.js";

const T0 = 1_700_000_000_000;
const TF5M = 300_000;
const HOUR = 3_600_000;

/** Clean, uniformly-spaced 5m series (quality 100). */
function good5m(seed = 42, count = 100): ReturnType<typeof generateCandles> {
  return generateCandles(seed, count, 100, TF5M, T0);
}

function codes(report: { issues: { code: string }[] }): string[] {
  return report.issues.map((i) => i.code);
}

// ---------------------------------------------------------------------------
// CandleStore
// ---------------------------------------------------------------------------

test("CandleStore maps timestamp -> openTime, sorts, drops invalid OHLC, derives closeTime", () => {
  const store = new CandleStore();
  const base = good5m(1, 5);
  const raw: RawCandle[] = [
    { timestamp: base[1]!.openTime, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { timestamp: base[0]!.openTime, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    // Invalid: high does not cover open/close.
    { timestamp: base[2]!.openTime, open: 10, high: 5, low: 4, close: 10 },
  ];

  const norm = store.normalize(raw, "5m");
  assert.equal(norm.inputCount, 3);
  assert.equal(norm.candles.length, 2);
  assert.equal(norm.invalidRemoved, 1);
  assert.equal(norm.duplicatesRemoved, 0);
  assert.ok(norm.reOrdered >= 1); // input was out of order
  assert.deepEqual(
    norm.candles.map((c) => c.openTime),
    [base[0]!.openTime, base[1]!.openTime],
  );
  // closeTime derived from the timeframe when absent.
  assert.equal(norm.candles[0]!.closeTime, norm.candles[0]!.openTime + TF5M);
});

test("CandleStore collapses duplicate timestamps (last write wins) and ingests a bounded series", () => {
  const store = new CandleStore({ maxLen: 10 });
  const base = good5m(2, 6);
  const duped: RawCandle[] = [
    { timestamp: base[0]!.openTime, ...ohlc(base[0]!) },
    { timestamp: base[0]!.openTime, ...ohlc(base[0]!), volume: 777 },
    ...base.slice(1).map((c) => ({ timestamp: c.openTime, ...ohlc(c) })),
  ];

  const norm = store.normalize(duped, "5m");
  assert.equal(norm.duplicatesRemoved, 1);
  assert.equal(norm.invalidRemoved, 0);
  assert.equal(norm.candles.length, 6);
  assert.equal(norm.candles[0]!.volume, 777); // last write wins

  const big = good5m(3, 25);
  store.ingest("EURUSD", "5m", big.map((c) => ({ timestamp: c.openTime, ...ohlc(c) })));
  assert.equal(store.count("EURUSD", "5m"), 10); // bounded to maxLen
  assert.equal(store.series("EURUSD", "5m").length, 10);
});

function ohlc(c: { open: number; high: number; low: number; close: number; volume: number }): {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
} {
  return { open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
}

test("isValidOhlc enforces OHLC relationships", () => {
  assert.equal(isValidOhlc({ open: 10, high: 12, low: 9, close: 11 }), true);
  assert.equal(isValidOhlc({ open: 10, high: 10, low: 9, close: 11 }), false); // high < close
  assert.equal(isValidOhlc({ open: 10, high: 12, low: 11, close: 11 }), false); // low > open
  assert.equal(isValidOhlc({ open: 10, high: 9, low: 8, close: 11 }), false); // high < low
  assert.equal(isValidOhlc({ open: 10, high: 12, low: 9, close: Number.NaN }), false);
  assert.equal(isValidOhlc({ open: 10, high: 12, low: 9, close: 11, volume: -5 }), false);
});

// ---------------------------------------------------------------------------
// DataQualityEngine
// ---------------------------------------------------------------------------

test("clean series scores 100 and passes", () => {
  const engine = new DataQualityEngine();
  const r = engine.evaluate(good5m(), "5m");
  assert.equal(r.score, 100);
  assert.equal(r.pass, true);
  assert.equal(r.grade, "good");
  assert.equal(r.issues.length, 0);
  assert.equal(r.evaluatedCount, 100);
  assert.equal(r.acceptedCount, 100);
  assert.equal(r.threshold, 70);
});

test("detects duplicate candles", () => {
  const engine = new DataQualityEngine();
  const candles = good5m();
  // Insert the duplicate adjacent to its original so ordering is preserved
  // (an out-of-order duplicate would additionally trip the out_of_order check).
  const withDup = [...candles.slice(0, 11), { ...candles[10]! }, ...candles.slice(11)];
  const r = engine.evaluate(withDup, "5m");
  assert.ok(codes(r).includes("duplicate_candles"));
  assert.equal(codes(r).includes("out_of_order"), false);
  assert.equal(r.score, 98); // 100 - 2
  assert.ok(r.score >= 0 && r.score <= 100);
});

test("detects out-of-order candles", () => {
  const engine = new DataQualityEngine();
  const candles = good5m();
  const shuffled = [...candles];
  [shuffled[5], shuffled[6]] = [shuffled[6]!, shuffled[5]!];
  const r = engine.evaluate(shuffled, "5m");
  assert.ok(codes(r).includes("out_of_order"));
  assert.ok(r.score < 100);
});

test("detects timestamp gaps and missing candles", () => {
  const engine = new DataQualityEngine();
  const candles = good5m();
  const withGap = candles.filter((_, i) => i !== 50);
  const r = engine.evaluate(withGap, "5m");
  assert.ok(codes(r).includes("timestamp_gaps"));
  assert.ok(codes(r).includes("missing_candles"));
  const gap = r.issues.find((i) => i.code === "missing_candles");
  assert.ok(gap && gap.penalty >= 1); // any missing candle costs something
});

test("detects invalid OHLC relationships in the raw input", () => {
  const engine = new DataQualityEngine();
  const candles = good5m();
  const last = candles[candles.length - 1]!;
  const bad: RawCandle = {
    timestamp: last.openTime + TF5M,
    closeTime: last.closeTime + TF5M,
    open: 100,
    high: 90, // does not cover open/close
    low: 80,
    close: 100,
    volume: 1,
  };
  const r = engine.evaluate([...candles, bad], "5m");
  assert.ok(codes(r).includes("invalid_ohlc"));
});

test("detects stale candles only when a clock is supplied (replay is never penalized)", () => {
  const engine = new DataQualityEngine();
  const candles = good5m();
  const lastClose = candles[candles.length - 1]!.closeTime;

  const hard = engine.evaluate(candles, "5m", { now: lastClose + 2 * HOUR });
  assert.ok(codes(hard).includes("stale_candles"));
  assert.equal(hard.pass, false); // 100 - 60 = 40 < 70
  assert.equal(hard.grade, "insufficient");

  const replay = engine.evaluate(candles, "5m"); // no clock => no staleness
  assert.equal(codes(replay).includes("stale_candles"), false);
  assert.equal(replay.pass, true);
});

test("detects unrealistic values", () => {
  const engine = new DataQualityEngine();
  const candles = good5m();
  const last = candles[candles.length - 1]!;
  const extreme: RawCandle = {
    timestamp: last.openTime + TF5M,
    closeTime: last.closeTime + TF5M,
    open: 100,
    high: 250,
    low: 100,
    close: 200, // +100% in one candle
    volume: 10,
  };
  const r = engine.evaluate([...candles, extreme], "5m");
  assert.ok(codes(r).includes("unrealistic_values"));
  assert.ok(r.score < 100);
});

test("detects incomplete data and rejects it below the threshold", () => {
  const engine = new DataQualityEngine();
  const r = engine.evaluate(good5m(1, 30), "5m");
  assert.ok(codes(r).includes("incomplete_data"));
  assert.equal(r.pass, false);
  assert.equal(r.grade, "insufficient");
  assert.equal(r.score, 60); // 100 - 40
});

test("score is clamped to 0-100 on heavily defective input", () => {
  const engine = new DataQualityEngine();
  const base = good5m(5, 80);
  const broken: RawCandle[] = [];
  for (let i = 0; i < base.length; i += 2) {
    const c = base[i]!;
    const raw: RawCandle = { timestamp: c.openTime, ...ohlc(c) };
    broken.push(raw, raw); // duplicated + every other candle missing
  }
  const lastClose = base[78]!.closeTime;
  const r = engine.evaluate(broken, "5m", { now: lastClose + 5 * HOUR });
  assert.equal(r.score, 0);
  assert.equal(r.pass, false);
  assert.ok(r.score >= 0 && r.score <= 100);
});


// ---------------------------------------------------------------------------
// MarketSnapshotBuilder — metadata + determinism
// ---------------------------------------------------------------------------

test("every snapshot carries snapshotId/timestamp/asset/timeframe/dataVersion/featureVersion", () => {
  const b = new MarketSnapshotBuilder();
  const snap = b.build({ asset: "EURUSD", timeframe: "5m", candles: good5m(), timestamp: T0 });
  assert.match(snap.snapshotId, /^[0-9a-f]{16}$/);
  assert.equal(snap.timestamp, T0);
  assert.equal(snap.asset, "EURUSD");
  assert.equal(snap.timeframe, "5m");
  assert.equal(snap.dataVersion, "ohlcv_v1");
  assert.equal(snap.featureVersion, "features_v2");
  assert.equal(snap.source, "structured");
  assert.equal(typeof snap.quality.score, "number");
  assert.equal(snap.quality.pass, true);
  assert.equal(snap.dataQuality, "good");
});

test("builder is deterministic: identical input => identical id and features", () => {
  const a = new MarketSnapshotBuilder();
  const b = new MarketSnapshotBuilder();
  const input = good5m(7);
  const sa = a.build({ asset: "EURUSD", timeframe: "5m", candles: input, timestamp: T0 });
  const sb = b.build({ asset: "EURUSD", timeframe: "5m", candles: input, timestamp: T0 });

  assert.equal(sa.snapshotId, sb.snapshotId);
  assert.deepEqual(sa.technicalFeatures, sb.technicalFeatures);
  assert.deepEqual(a.featureVector(sa), b.featureVector(sb));

  const sc = b.build({ asset: "EURUSD", timeframe: "5m", candles: good5m(8), timestamp: T0 });
  assert.notEqual(sa.snapshotId, sc.snapshotId);
});

// ---------------------------------------------------------------------------
// Fail-closed quality gating
// ---------------------------------------------------------------------------

test("RiskEngine blocks below-threshold data quality (forces NO_TRADE)", () => {
  const md = new MarketDataService();
  const candles = good5m();
  const lastClose = candles[candles.length - 1]!.closeTime;

  const rejected = md.builder.build({
    asset: "EURUSD",
    timeframe: "5m",
    candles,
    timestamp: lastClose,
    now: lastClose + 5 * HOUR, // hard-stale => score 40 < 70
  });
  assert.equal(rejected.quality.pass, false);
  assert.equal(rejected.dataQuality, "insufficient");

  const risk = new RiskEngine();
  const blocked = risk.evaluate("UP", 0.9, rejected);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.direction, "NO_TRADE");

  const accepted = md.builder.build({
    asset: "EURUSD",
    timeframe: "5m",
    candles,
    timestamp: lastClose,
  });
  assert.equal(accepted.quality.pass, true);
  const ok = risk.evaluate("UP", 0.9, accepted);
  assert.equal(ok.status, "ok");
  assert.equal(ok.direction, "UP");
});

test("SignalEngine cannot emit a direction when quality fails, even from a bullish model", () => {
  const md = new MarketDataService();
  const candles = good5m();
  const lastClose = candles[candles.length - 1]!.closeTime;
  const snapshot = md.builder.build({
    asset: "EURUSD",
    timeframe: "5m",
    candles,
    timestamp: lastClose,
    now: lastClose + 5 * HOUR,
  });

  const bull = new MLInferenceEngine({
    modelId: "bull",
    version: "v1",
    weights: [100, 100, 100, 100, 100, 100],
    bias: 100,
  });
  const engine = new SignalEngine({ models: [bull] });
  const sig = engine.analyze(snapshot, md.featureVector(snapshot));

  assert.equal(sig.direction, "NO_TRADE");
  assert.equal(sig.riskStatus, "blocked");
});

test("AnalysisService rejects incomplete data end-to-end and stores snapshot metadata", async () => {
  const svc = new AnalysisService({ defaultAsset: "EURUSD", defaultTimeframe: "5m" });
  const out = await svc.analyze(good5m(2, 30), "EURUSD", "5m");

  assert.equal(out.snapshot.quality.pass, false);
  assert.equal(out.signal.direction, "NO_TRADE");

  assert.equal(svc.snapshotStore.count(), 1);
  const rec = svc.snapshotStore.records()[0]!;
  assert.equal(rec.snapshotId, out.snapshot.snapshotId);
  assert.equal(rec.timestamp, out.snapshot.timestamp);
  assert.equal(rec.asset, "EURUSD");
  assert.equal(rec.timeframe, "5m");
  assert.equal(rec.dataVersion, out.snapshot.dataVersion);
  assert.equal(rec.featureVersion, out.snapshot.featureVersion);
});


// ---------------------------------------------------------------------------
// TimeframeManager + multi-timeframe analysis
// ---------------------------------------------------------------------------

test("TimeframeManager: durations, alignment, and context selection (no fabrication)", () => {
  const tfm = new TimeframeManager();
  assert.equal(tfm.durationMs("1m"), 60_000);
  assert.equal(tfm.durationMs("30m"), 1_800_000);
  assert.equal(tfm.durationMs("1h"), 3_600_000);
  assert.ok(tfm.isValid("30m"));
  assert.equal(tfm.isValid("7m"), false);

  const ts = T0 + 12_345;
  assert.equal(tfm.alignDown(ts, "5m"), Math.floor(ts / 300_000) * 300_000);

  // Only timeframes the source provided come back as selected.
  const ctx = tfm.selectContext("1m", ["5m", "15m", "30m", "1h"], ["1m", "5m", "15m"]);
  assert.deepEqual(ctx.selected, ["5m", "15m"]);
  assert.deepEqual(ctx.unavailable, ["30m", "1h"]);

  assert.deepEqual(tfm.largerThan("1m"), ["5m", "15m", "30m", "1h", "4h", "1d"]);
});

test("TimeframeManager: exact-multiple OHLC aggregation (5 x 1m -> 5m)", () => {
  const tfm = new TimeframeManager();
  const m1 = generateCandles(11, 10, 100, 60_000, 0);
  const agg = tfm.aggregate(m1, "1m", "5m");

  assert.ok(agg);
  assert.equal(agg.length, 2);

  const bucket = m1.slice(0, 5);
  const first = agg[0]!;
  assert.equal(first.openTime, 0);
  assert.equal(first.open, bucket[0]!.open);
  assert.equal(first.close, bucket[4]!.close);
  assert.equal(first.high, Math.max(...bucket.map((c) => c.high)));
  assert.equal(first.low, Math.min(...bucket.map((c) => c.low)));
  assert.equal(first.volume, bucket.reduce((s, c) => s + c.volume, 0));
  assert.equal(first.closeTime, bucket[4]!.closeTime);

  // Never fabricates: coarser -> finer, and empty input both return null.
  assert.equal(tfm.aggregate(m1, "5m", "1m"), null);
  assert.equal(tfm.aggregate([], "1m", "5m"), null);
});

test("multi-timeframe: uses only provided timeframes (1m primary, 5m/15m context)", () => {
  const md = new MarketDataService();
  const svc = new MultiTimeframeService(md.builder);

  const m1 = generateCandles(1, 60, 100, 60_000, T0);
  const m5 = generateCandles(2, 60, 100, 300_000, T0);
  const m15 = generateCandles(3, 60, 100, 900_000, T0);

  const { snapshot, context } = svc.build({
    asset: "EURUSD",
    primary: "1m",
    series: { "1m": m1, "5m": m5, "15m": m15 },
    timestamp: T0 + 60 * 60_000,
  });

  assert.equal(snapshot.timeframe, "1m");
  assert.equal(context.primary, "1m");
  assert.deepEqual(context.related.map((r) => r.timeframe), ["5m", "15m"]);
  assert.deepEqual(context.unavailable, ["30m", "1h"]);
  assert.equal(snapshot.context?.related.length, 2);
  for (const r of context.related) assert.ok(["5m", "15m"].includes(r.timeframe));
});

test("multi-timeframe: absent context timeframes are reported unavailable, never fabricated", () => {
  const md = new MarketDataService();
  const svc = new MultiTimeframeService(md.builder);
  const m1 = generateCandles(1, 60, 100, 60_000, T0);

  const { context } = svc.build({
    asset: "EURUSD",
    primary: "1m",
    series: { "1m": m1 },
    timestamp: T0,
  });

  assert.equal(context.related.length, 0);
  assert.deepEqual(context.unavailable, ["5m", "15m", "30m", "1h"]);
});


// ---------------------------------------------------------------------------
// Screenshot / chart-vision fallback (visual context only, no numeric invention)
// ---------------------------------------------------------------------------

test("vision fallback extracts only qualitative context and drops numeric attempts", () => {
  const extractor: VisionExtractor = {
    id: "fake-ocr",
    extract: () => ({
      trendBias: "up",
      structure: ["higher highs", "higher lows"],
      patterns: ["double top near 1.2400"],
      levels: ["resistance around 1.2345", "support visible"],
      notes: ["price at 1.2310"],
      numericPrices: [1.231, 1.2345],
      indicatorValues: [{ name: "RSI", value: 61.2 }],
    }),
  };

  const svc = new ChartVisionService(extractor);
  const image: VisionImage = { ref: "shot://1", capturedAt: T0 };
  const res = svc.extractContext(image);

  ChartVisionService.assertNoNumericClaims(res.context); // must not throw
  assert.equal(res.numericSnapshotAvailable, false);
  assert.equal(res.droppedNumericAttempts, 3);
  assert.deepEqual(res.context.numericPrices, []);
  assert.deepEqual(res.context.indicatorValues, []);
  assert.equal(res.context.trendBias, "up");
  assert.deepEqual(res.context.structure, ["higher highs", "higher lows"]);

  // Any price-like numeric string was scrubbed from every text field.
  const priceLike = /\d+\.\d+/;
  for (const field of [...res.context.levels, ...res.context.patterns, ...res.context.notes]) {
    assert.equal(priceLike.test(field), false, `price leaked: ${field}`);
  }
});

test("default vision extractor yields no prices and non-numeric evidence", () => {
  const svc = new ChartVisionService();
  const res = svc.extractContext({ ref: "shot://2", capturedAt: 0 });

  assert.equal(res.droppedNumericAttempts, 0);
  assert.equal(res.context.trendBias, "unknown");
  assert.deepEqual(res.context.numericPrices, []);
  assert.equal(res.numericSnapshotAvailable, false);

  const evidence = svc.toEvidence(res);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]!.kind, "visual");
  assert.equal(/\d+\.\d+/.test(evidence[0]!.detail), false);
});

test("capture: structured data wins; vision-only path produces no numeric snapshot", () => {
  const md = new MarketDataService();
  const svc = new ChartCaptureService(md);
  const image: VisionImage = { ref: "shot://3", capturedAt: T0 + 1000 };
  const candles = good5m();

  const structured = svc.captureWithFallback(
    { asset: "EURUSD", timeframe: "5m", candles, observedAt: T0 + 100 * TF5M },
    image,
  );
  assert.equal(structured.numericSource, "structured");
  assert.ok(structured.snapshot);
  assert.equal(structured.snapshot!.quality.pass, true);
  assert.ok(structured.vision); // supplementary only

  const visionOnly = svc.captureWithFallback(
    { asset: "EURUSD", timeframe: "5m", candles: [], observedAt: T0 },
    image,
  );
  assert.equal(visionOnly.snapshot, null);
  assert.equal(visionOnly.numericSource, "none");
  assert.ok(visionOnly.vision);
  assert.deepEqual(visionOnly.vision!.context.numericPrices, []);
});

// ---------------------------------------------------------------------------
// SnapshotStore
// ---------------------------------------------------------------------------

test("SnapshotStore persists self-describing snapshot metadata", () => {
  const md = new MarketDataService();
  const s1 = md.buildSnapshot("EURUSD", "5m", good5m(1, 60), T0);
  const s2 = md.buildSnapshot("BTCUSD", "5m", good5m(2, 60), T0 + 1000);

  const store = new SnapshotStore();
  store.save(s1);
  store.save(s2);
  store.save(s1); // idempotent (same snapshotId)
  assert.equal(store.count(), 2);
  assert.equal(store.get(s1.snapshotId)?.asset, "EURUSD");

  const all = store.records();
  assert.equal(all.length, 2);
  assert.equal(all[0]!.asset, "BTCUSD"); // newest first
  for (const r of all) {
    assert.ok(r.snapshotId.length > 0);
    assert.equal(typeof r.timestamp, "number");
    assert.ok(r.asset.length > 0);
    assert.ok(r.timeframe.length > 0);
    assert.ok(r.dataVersion.length > 0);
    assert.ok(r.featureVersion.length > 0);
  }
  assert.equal(store.records({ asset: "EURUSD" }).length, 1);
});


// ---------------------------------------------------------------------------
// THE critical requirement: LIVE and BACKTEST/REPLAY share one pipeline
// ---------------------------------------------------------------------------

test("LIVE and REPLAY produce identical snapshots through the same builder", () => {
  const md = new MarketDataService();
  const series = good5m(9, 120);
  const idx = 99;
  const window = series.slice(0, idx + 1);
  const ts = window[window.length - 1]!.closeTime;

  // Live path: MarketDataService.buildSnapshot -> shared builder.
  const live = md.buildSnapshot("EURUSD", "5m", window, ts, "replay");
  // Replay path: same MarketDataService.builder.
  const replayStep = md.replay().buildAt(series, idx, { asset: "EURUSD", timeframe: "5m" });

  assert.equal(replayStep.index, idx);
  assert.equal(replayStep.snapshot.timestamp, ts);
  assert.equal(replayStep.snapshot.snapshotId, live.snapshotId);
  assert.deepEqual(replayStep.snapshot.technicalFeatures, live.technicalFeatures);
  assert.deepEqual(replayStep.features, md.featureVector(live));
  assert.deepEqual(replayStep.snapshot.indicators, live.indicators);
  assert.equal(replayStep.snapshot.dataVersion, live.dataVersion);
  assert.equal(replayStep.snapshot.featureVersion, live.featureVersion);
});

test("REPLAY never applies staleness to historical data (shared quality gate)", () => {
  const md = new MarketDataService();
  const series = good5m(4, 80); // timestamps far in the past
  const step = md.replay().buildAt(series, 79, { asset: "EURUSD", timeframe: "5m" });

  assert.equal(codes(step.snapshot.quality).includes("stale_candles"), false);
  assert.equal(step.snapshot.quality.pass, true);
  assert.equal(step.snapshot.source, "replay");
});

test("BACKTEST and REPLAY emit identical signals (same snapshot, same engine)", () => {
  const md = new MarketDataService();
  const signalEngine = new SignalEngine({ models: [new MLInferenceEngine()] });
  const bt = new BacktestingEngine(md, signalEngine, { timeframe: "5m", warmup: 50, size: 1 });

  const series = good5m(10, 80);
  const startTime = 1_234;
  const result = bt.run("EURUSD", series, startTime);
  assert.ok(result.steps.length > 0);

  const idx = 70;
  const backtestStep = result.steps.find((s) => s.index === idx);
  assert.ok(backtestStep);

  const replayStep = md.replay().buildAt(series, idx, {
    asset: "EURUSD",
    timeframe: "5m",
    source: "structured",
    timestampAt: (_w, i) => startTime + i,
  });

  // The replayed snapshot is byte-identical to the one backtesting used...
  const btSnapshot = md.buildSnapshot("EURUSD", "5m", series.slice(0, idx + 1), startTime + idx);
  assert.equal(replayStep.snapshot.snapshotId, btSnapshot.snapshotId);

  // ...so the signal derived from it is identical too.
  const replaySignal = signalEngine.analyze(replayStep.snapshot, replayStep.features);
  assert.equal(replaySignal.direction, backtestStep!.signal.direction);
  assert.equal(replaySignal.confidence, backtestStep!.signal.confidence);
  assert.equal(replaySignal.score, backtestStep!.signal.score);
});

test("AnalysisService snapshot matches an independent builder run (single pipeline)", async () => {
  const svc = new AnalysisService({ defaultAsset: "EURUSD", defaultTimeframe: "5m" });
  const input = good5m(11, 150);
  const out = await svc.analyze(input, "EURUSD", "5m");

  const reference = new MarketDataService();
  const ts = input[input.length - 1]!.closeTime;
  const expected = reference.buildSnapshot("EURUSD", "5m", input, ts, "structured");

  assert.equal(out.snapshot.snapshotId, expected.snapshotId);
  assert.deepEqual(reference.featureVector(expected), svc.marketData.featureVector(out.snapshot));
  assert.deepEqual(out.snapshot.technicalFeatures, expected.technicalFeatures);
});

