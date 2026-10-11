# TradeVision AI — Validation-First Analysis & Paper-Trading Extension

TradeVision AI is a **local-first, AI-assisted market analysis and
paper-trading research system** delivered as a Manifest V3 browser extension.
Its primary objective is **not the appearance of accuracy, but genuine
predictive value on unseen market data.**

> **What it does:** market analysis, backtesting, machine learning, AI
> analysis, paper trading, model evaluation, and risk management.
> **What it deliberately does NOT do:** CAPTCHA/anti-bot bypass, fingerprint
> spoofing, credential or session-token theft, account-security evasion,
> platform-security bypass, or automated real-money trade execution. The
> content script only *observes* data the page already shows and never
> automates or modifies the host platform. Signals use the
> `UP | DOWN | NO_TRADE` vocabulary (no `CALL`/`PUT` internally).

---

## Quick start

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # compile + node:test (116 tests)
npm run dev         # dev build (unminified + sourcemaps) + watch -> dist/extension/
npm run build       # esbuild production build -> dist/extension/
npm run demo        # end-to-end demo (Phase 2 market data + constraint gate + truth policy)
```

Load the unpacked extension: Chrome → `chrome://extensions` → Developer mode →
**Load unpacked** → select `dist/extension/`.

> **`npm run dev` is a watcher, not a one-shot build.** After the first build
> the terminal idles *on purpose*: it rebuilds automatically whenever files
> under `src/` change (watch for the `[dev] Rebuild done` hint), then press
> the reload (R) button on the extension card. It only exits with **Ctrl+C**.
> Use `npm run dev -- --once` when you want a single build that exits.

## Commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Strict TypeScript type-check (no emit). |
| `npm run lint` | ESLint 9 (flat config) over the whole repo. |
| `npm test` | Compiles to `dist/` and runs all `node:test` suites. |
| `npm run dev` | Development esbuild **watch** build (unminified, sourcemaps, `NODE_ENV=development`) into `dist/extension/`. Add `-- --once` for a single build. |
| `npm run build` | Production esbuild bundle of all 5 extension entry points. |
| `npm run build:node` | Emit the Node/test build to `dist/`. |
| `npm run demo` | Runs the end-to-end constraint + truth-policy demo. |

## Architecture

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full pipeline, folder
map, security model, and phase boundary.

### Core objects

**MarketSnapshot** — `asset, timestamp, timeframe, candles, currentPrice,
indicators, technicalFeatures, marketRegime, volatility, dataQuality`

**Signal** — `direction (UP|DOWN|NO_TRADE), score, confidence,
calibratedProbability?, timestamp, timeframe, evidence[], modelVotes[],
riskStatus, modelVersion, dataQuality`
## Files created (Phases 1-2)

**Types** — `src/types/market.ts` (incl. `DataQualityReport`,
`MultiTimeframeContext`), `src/types/signal.ts`,
`src/types/messaging.ts`, `src/types/chrome.d.ts`

**Core engines** — `src/indicators/indicator_math.ts`,
`src/indicators/indicator_engine.ts`, `src/services/market_regime_engine.ts`,
`src/services/price_action_engine.ts`, `src/services/market_data_service.ts`
(shared-builder facade + `generateCandles` + `replay()`),
`src/services/chart_data_service.ts`, `src/services/chart_capture_service.ts`
(structured-first + vision fallback), `src/services/signal_engine.ts`,
`src/services/analysis_service.ts` (quality gate + `SnapshotStore`)

**Phase 2 market-data engine** — `src/marketData/candle_store.ts`,
`src/marketData/timeframe_manager.ts`, `src/marketData/data_quality_engine.ts`,
`src/marketData/market_snapshot_builder.ts` (single pipeline),
`src/marketData/multi_timeframe.ts`, `src/marketData/chart_vision_service.ts`,
`src/marketData/snapshot_store.ts`, `src/marketData/replay_mode.ts`

**Phase 3 technical-analysis engine** — `src/technical/trend_engine.ts`,
`src/technical/momentum_engine.ts`, `src/technical/volatility_engine.ts`,
`src/technical/swing_structure_engine.ts`,
`src/technical/support_resistance_engine.ts`,
`src/technical/breakout_engine.ts`, `src/technical/pullback_engine.ts`,
`src/technical/candle_structure_engine.ts`,
`src/technical/technical_analysis_engine.ts` (aggregator),
`src/technical/utils.ts`, `src/types/technical.ts`
(`TechnicalEvidence` on every `MarketSnapshot`); Phase 3 indicators
(ATR14/ADX14/Stochastic/ROC12/MOM10/volatility20/VWAP) added to
`src/indicators/indicator_math.ts` + `indicator_engine.ts`

**ML / AI / ensemble** — `src/ml/feature_engineering_engine.ts`,
`src/ml/ml_inference_engine.ts`, `src/ml/training_pipeline.ts`,
`src/ml/drift_detection_engine.ts`, `src/ai/ai_model_router.ts`,
`src/ai/ai_analyst_engine.ts`, `src/ensemble/ensemble_engine.ts`,
`src/ensemble/confidence_engine.ts`

**Risk / backtest / paper / models / analytics** —
`src/risk/risk_engine.ts`, `src/backtesting/backtesting_engine.ts`,
`src/paperTrading/paper_trading_engine.ts`, `src/models/model_registry.ts`,
`src/models/model_evaluation_engine.ts`, `src/analytics/signal_history.ts`,
`src/analytics/performance_tracker.ts`

**Infrastructure** — `src/config/config.ts`, `src/security/secrets.ts`,
`src/storage/storage_adapter.ts`, `src/utils/logger.ts`

**Extension shell** — `manifest.json`, `src/background/service_worker.ts`,
`src/content/content_script.ts`, `src/popup/{popup.ts,popup.html}`,
`src/sidepanel/{sidepanel.ts,sidepanel.html}`,
`src/options/{options.ts,options.html}`,
`src/components/{signal_card.ts,ui_client.ts}`

**Tooling / docs** — `scripts/build.mjs`, `scripts/dev.mjs` (dev watch
build), `eslint.config.mjs`, `.gitignore`, `ARCHITECTURE.md` (this README
updated)

**Tests** — `src/tests/pipeline.test.ts`, `src/tests/security.test.ts`,
`src/tests/engines.test.ts`, `src/tests/market_data.test.ts` (29 Phase 2
deterministic tests: quality defects, multi-timeframe, vision fallback,
live/replay parity), `src/tests/technical.test.ts` +
`technical_{a,b,c}.test.ts` (Phase 3 indicator & analysis-engine tests)

## Files modified (Phase 1)

- `package.json` — added `lint`, `build`, `build:node`, `demo` scripts; kept
  `typecheck`/`test`; removed the dangling `check:integrity` reference.
- `tsconfig.json` — added `DOM`, `DOM.Iterable`, `WebWorker` libs (browser
  extension code) while keeping `node` types (tests).
- `src/phases/phase10_retrain/retrain_pipeline.ts`,
  `src/phases/phase7_backtest/backtest_engine.ts`,
  `src/prod/production_gate.ts`, `src/demo/run_demo.ts`,
  `src/validators/*.ts`, `src/tests/champion_challenger_gate.test.ts`,
  `src/tests/core_constraint_engine.test.ts` — removed **unused imports only**
  (no logic changed) so lint passes.

## Dependencies

**Runtime:** `zod` (schema validation), `date-fns` (date math) — unchanged.

**Dev:** `typescript` (~6.0.2), `@types/node`, **`esbuild`** (production
bundle), **`eslint`** + **`@eslint/js`** + **`typescript-eslint`** + **`globals`**
(lint). No `@types/chrome` — MV3 APIs are declared in
`src/types/chrome.d.ts`.

## Validation status (Phases 2-3)

- `npm run typecheck` — ✅ clean
- `npm run lint` — ✅ clean
- `npm test` — ✅ 116/116 passing (54 Phase 1 + 29 Phase 2 + 33 Phase 3)
- `npm run dev` — ✅ dev bundle + watch rebuilds into `dist/extension/` (`-- --once` for single build)
- `npm run build` — ✅ `dist/extension/` produced (exit 0)
- `npm run demo` — ✅ runs end-to-end (Phase 2 market data + constraint gate + truth policy)

### Phase 2 guarantees (tested)

- **Structured > vision:** verified — vision-only capture yields
  `snapshot: null` + `numericSnapshotAvailable: false`, `numericPrices: []`.
- **Quality gate:** 8 defect classes scored 0-100; below `minDataQuality`
  (default 70) `AnalysisService`/`SignalEngine`/`RiskEngine` force NO_TRADE.
- **No fabrication:** absent context timeframes appear in `unavailable`,
  never as snapshots.
- **Single pipeline:** live, backtest, and replay share one
  `MarketSnapshotBuilder` — replayed snapshots are byte-identical
  (`snapshotId` match) to live builds.

### Phase 3 guarantees (tested)

- **Fail-closed indicators:** ATR/ADX/Stochastic/ROC/MOM return `null`
  (never a misleading number) when history is insufficient.
- **ADX noise floor:** directional movement below 1% of a bar's true range
  is wick noise; bars with no directional movement contribute 0 DX, so a
  flat/micro-wick range cannot fake a "perfect trend" (ADX ~0 on a range,
  ~100 on a steady trend).
- **One vote per input:** each trend/momentum/structure input is a single
  vote; `TrendEngine` labels flat ranges `SIDEWAYS` (weak ADX mutes score
  to 0), never a directional state without evidence.

> `confidence` is model **conviction**, **not** a probability of winning.
> `calibratedProbability` is only present after statistical calibration has
> been implemented *and validated* for that exact model version.
