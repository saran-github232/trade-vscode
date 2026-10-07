# TradeVision AI — Architecture

Local-first, AI-assisted market analysis and paper-trading research extension.

> **Scope guardrails (enforced in code, not just prose).**
> This system performs *analysis, backtesting, machine learning, evaluation,
> paper trading, and risk management only.* It contains **no** CAPTCHA/anti-bot
> bypass, no fingerprint spoofing, no credential/session interception, no
> account-security evasion, no platform-security bypass, and **no automated
> real-money trade execution**. The content script is a *passive observer* of
> data the page already exposes and never clicks, types, or mutates platform
> controls. The primary signal vocabulary is `UP | DOWN | NO_TRADE`
> (`CALL`/`PUT` are not used internally).

---

## 1. High-level pipeline

```
candles ──► MarketDataService.buildSnapshot()  ──► MarketSnapshot
                 │  IndicatorEngine
                 │  FeatureEngineeringEngine
                 │  MarketRegimeEngine
                 ▼
MarketSnapshot ─► SignalEngine.analyze()       ──► Signal (UP|DOWN|NO_TRADE)
                 │  MLInferenceEngine  (model votes)
                 │  EnsembleEngine     (consensus + score)
                 │  ConfidenceEngine   (conviction, optional calibration)
                 │  PriceActionEngine  (evidence)
                 │  RiskEngine         (can force NO_TRADE — fail closed)
                 ▼
Signal ─────────► AIAnalystEngine.analyze()    ──► policy-safe Analysis
                    (truth_policy.checkClaimIsSafe)
```

`AnalysisService` wires the whole chain and is the single entry point used by
the popup, sidepanel, options, background worker, and tests — so every surface
produces identical grounded output.

## 2. Confidence ≠ probability

- `Signal.confidence` is the ensemble's **conviction** in `[0,1]`. It is
  *never* presented as a probability of winning.
- `Signal.calibratedProbability` is **optional** and only set when a
  `Calibrator` produced by `ModelEvaluationEngine` has been *fit and validated*
  (measured ECE ≤ `MAX_VALIDATED_ECE` with enough samples) **and** it matches
  the exact `modelVersion`. Otherwise it stays `undefined` (fail closed).
- `ConfidenceEngine.compute()` enforces this: a mismatched or absent calibrator
  never attaches a calibrated probability.

## 3. Folder map

| Folder | Responsibility |
| --- | --- |
| `src/types/` | Canonical types: `market.ts` (MarketSnapshot), `signal.ts` (Signal), `messaging.ts`, `domain.ts` (validation records), `chrome.d.ts` (MV3 ambient types). |
| `src/background/` | MV3 service worker — owns `SecretVault`, `AnalysisService`, message routing. The only context allowed to resolve raw keys. |
| `src/content/` | Passive content script. Reads a `window.__TRADEVISION_DATA__` bridge, renders an extension-owned overlay, does **not** automate the platform. |
| `src/popup/`, `src/sidepanel/`, `src/options/` | UI entry points (HTML + TS). |
| `src/components/` | Shared rendering (`signal_card.ts`) + `ui_client.ts`. |
| `src/services/` | `MarketDataService`, `ChartDataService`, `ChartCaptureService`, `PriceActionEngine`, `MarketRegimeEngine`, `SignalEngine`, `AnalysisService`. |
## 4. Security model

- **Secrets:** `SecretVault` stores keys in extension storage (or an in-memory
  store). Unprivileged contexts receive only a `SecretHandle` + masked
  metadata. `assertNoRawSecrets()` runs on every message leaving the
  background so a raw key can never reach a content/page script.
- **Logging:** every log line passes through `redact()` (strips `sk-…`,
  `ghp_…`, `Bearer …`, and `key=value` secret patterns).
- **Endpoints:** `AIModelRouter.configure()` rejects non-HTTPS endpoints
  (localhost allowed for local-first).
- **CSP:** `manifest.json` sets `script-src 'self'` (no inline/remote scripts).
- **Truth policy:** every AI/report string is checked with the existing
  `checkClaimIsSafe()`; forbidden claims are blocked at the policy layer.

## 5. Build & tooling

- **Type-check:** `tsc --noEmit` (strict + `noUncheckedIndexedAccess`).
- **Lint:** ESLint 9 flat config + `typescript-eslint`.
- **Unit tests:** `node:test`, compiled to `dist/` then run (`npm test`).
- **Production build:** `esbuild` bundles the 5 entry points (ESM except the
  content script, which is IIFE per MV3), injects build-time env as
  `globalThis.__ENV__`, and copies HTML + `manifest.json` into
  `dist/extension/` — the loadable, unpacked extension.

## 6. Environment variables

Read via `loadConfig()` (override > build-time `globalThis.__ENV__` >
`process.env` > default): `NODE_ENV`, `TV_DEBUG`, `TV_DEFAULT_ASSET`,
`TV_DEFAULT_TIMEFRAME`, `TV_MIN_CONFIDENCE`, `TV_MAX_RISK_PER_TRADE`,
`TV_ALLOWED_ASSETS`.

## 7. Phase boundary

This is **Phase 1** (stable: typecheck ✓, lint ✓, 54 tests ✓, production build
✓, demo ✓). Phase 2 (not started): live market data adapters, real model
training, walk-forward integration, and narrowing content-script host
permissions to the specific chart domain.
| `src/indicators/` | `indicator_math.ts` (sma/ema/rsi/macd/bollinger) + `IndicatorEngine`. |
| `src/ml/` | `FeatureEngineeringEngine`, `MLInferenceEngine`, `TrainingPipeline`, `DriftDetectionEngine`. |
| `src/ai/` | `AIModelRouter` (SecretHandle-based, https-enforced), `AIAnalystEngine` (truth-policy gated). |
| `src/ensemble/` | `EnsembleEngine`, `ConfidenceEngine`. |
| `src/risk/` | `RiskEngine` — volatility/confidence gates; can force `NO_TRADE`. |
| `src/backtesting/` | `BacktestingEngine` — replays candles through the live pipeline. |
| `src/paperTrading/` | `PaperTradingEngine` — simulated account (`isPaper = true`). |
| `src/models/` | `ModelRegistry`, `ModelEvaluationEngine`. |
| `src/analytics/` | `SignalHistory`, `PerformanceTracker`. |
| `src/storage/` | `StorageAdapter` + memory / web-extension implementations. |
| `src/security/` | `SecretVault` — storage boundary; raw keys never leave the background. |
| `src/config/` | `loadConfig()` — env + overrides, `paperTrading` always `true`. |
| `src/utils/` | `logger.ts` with redaction. |
| `src/core/`, `src/validators/`, `src/prod/`, `src/policy/`, `src/phases/`, `src/util/` | Existing validation-first constraint/truth layer (unchanged, reused). |
| `src/tests/` | `node:test` unit + integration tests. |
