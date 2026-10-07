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
npm test            # compile + node:test (54 tests)
npm run build       # esbuild production build -> dist/extension/
npm run demo        # end-to-end demo (constraint gate + truth policy)
```

Load the unpacked extension: Chrome → `chrome://extensions` → Developer mode →
**Load unpacked** → select `dist/extension/`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Strict TypeScript type-check (no emit). |
| `npm run lint` | ESLint 9 (flat config) over the whole repo. |
| `npm test` | Compiles to `dist/` and runs all `node:test` suites. |
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
## Files created (Phase 1)

**Types** — `src/types/market.ts`, `src/types/signal.ts`,
`src/types/messaging.ts`, `src/types/chrome.d.ts`

**Core engines** — `src/indicators/indicator_math.ts`,
`src/indicators/indicator_engine.ts`, `src/services/market_regime_engine.ts`,
`src/services/price_action_engine.ts`, `src/services/market_data_service.ts`,
`src/services/chart_data_service.ts`, `src/services/chart_capture_service.ts`,
`src/services/signal_engine.ts`, `src/services/analysis_service.ts`

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

**Tooling / docs** — `scripts/build.mjs`, `eslint.config.mjs`,
`.gitignore`, `ARCHITECTURE.md` (this README updated)

**Tests** — `src/tests/pipeline.test.ts`, `src/tests/security.test.ts`,
`src/tests/engines.test.ts` (23 new assertions across these)

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

## Validation status (Phase 1)

- `npm run typecheck` — ✅ clean
- `npm run lint` — ✅ clean
- `npm test` — ✅ 54/54 passing (31 pre-existing + 23 new)
- `npm run build` — ✅ `dist/extension/` produced (exit 0)
- `npm run demo` — ✅ runs end-to-end (constraint gate + truth policy)

**Phase 2 is intentionally not started until this Phase 1 is stable.**

> `confidence` is model **conviction**, **not** a probability of winning.
> `calibratedProbability` is only present after statistical calibration has
> been implemented *and validated* for that exact model version.
