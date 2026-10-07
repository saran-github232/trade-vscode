/**
 * Background service worker (MV3) — the privileged context.
 *
 * Owns the SecretVault, the AnalysisService, and message routing. This is
 * the ONLY context allowed to resolve raw API keys, and it strips them
 * from every outgoing message via `assertNoRawSecrets`.
 *
 * Local-first: no network calls are initiated here.
 */

import { loadConfig } from "../config/config.js";
import { createLogger } from "../utils/logger.js";
import { SecretVault, InMemorySecureStore, assertNoRawSecrets } from "../security/secrets.js";
import { AnalysisService } from "../services/analysis_service.js";
import type { Candle, Timeframe } from "../types/market.js";
import type { ExtensionRequest, ExtensionResponse, SafeSignalView } from "../types/messaging.js";

const cfg = loadConfig();
const log = createLogger("background", cfg.debug ? "debug" : "info");

// Prefer chrome.storage.local when available; else in-memory.
const store = typeof chrome !== "undefined" && chrome.storage ? secureFromChrome() : new InMemorySecureStore();
const vault = new SecretVault(store);
const analysis = new AnalysisService({
  defaultAsset: cfg.defaultAsset,
  defaultTimeframe: cfg.defaultTimeframe as Timeframe,
});

function secureFromChrome(): import("../security/secrets.js").SecureStore {
  const area = chrome.storage.local;
  return {
    async get(key: string) {
      const res = await area.get([key]);
      return res[key] as string | undefined;
    },
    async set(key: string, value: string) {
      await area.set({ [key]: value });
    },
    async remove(key: string) {
      await area.remove([key]);
    },
    async keys() {
      const res = await area.get(null);
      return Object.keys(res);
    },
  };
}

function toView(
  direction: SafeSignalView["direction"],
  score: number,
  confidence: number,
  timestamp: number,
  timeframe: string,
  asset: string,
  riskStatus: SafeSignalView["riskStatus"],
  modelVersion: string,
  dataQuality: SafeSignalView["dataQuality"],
  evidence: SafeSignalView["evidence"],
  summary: string,
  calibratedProbability?: number,
): SafeSignalView {
  const view: SafeSignalView = {
    direction, score, confidence, timestamp, timeframe, asset,
    riskStatus, modelVersion, dataQuality, evidence, summary,
  };
  if (calibratedProbability !== undefined) view.calibratedProbability = calibratedProbability;
  return view;
}

async function handle(req: ExtensionRequest): Promise<ExtensionResponse> {
  switch (req.type) {
    case "ANALYZE": {
      const candles = (req.candles ?? []) as Candle[];
      const out = await analysis.analyze(candles, req.asset, req.timeframe);
      const s = out.signal;
      const view = toView(
        s.direction, s.score, s.confidence, s.timestamp, s.timeframe,
        out.snapshot.asset, s.riskStatus, s.modelVersion, s.dataQuality,
        s.evidence, out.analysis.summary, s.calibratedProbability,
      );
      const resp: ExtensionResponse = {
        type: "ANALYZE_RESULT",
        view,
        snapshot: {
          asset: out.snapshot.asset,
          currentPrice: out.snapshot.currentPrice,
          marketRegime: out.snapshot.marketRegime,
          volatility: out.snapshot.volatility,
          dataQuality: out.snapshot.dataQuality,
        },
      };
      assertNoRawSecrets(resp);
      return resp;
    }
    case "GET_STATE": {
      const secrets = await vault.list();
      const resp: ExtensionResponse = { type: "STATE", hasKey: secrets.length > 0, paper: true };
      return resp;
    }
    case "SAVE_API_KEY": {
      const meta = await vault.set(req.name, req.apiKey);
      const resp: ExtensionResponse = { type: "SECRET_SAVED", name: meta.name, masked: meta.masked };
      assertNoRawSecrets(resp);
      return resp;
    }
    case "LIST_SECRETS": {
      const items = (await vault.list()).map((m) => ({ name: m.name, masked: m.masked }));
      const resp: ExtensionResponse = { type: "SECRETS", items };
      assertNoRawSecrets(resp);
      return resp;
    }
    case "DELETE_SECRET": {
      await vault.delete(req.handle as never);
      return { type: "OK" };
    }
    default:
      return { type: "ERROR", message: "Unknown request type." };
  }
}

// Wire the message listener when running inside an extension worker.
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handle(msg as unknown as ExtensionRequest)
      .then(sendResponse)
      .catch((err: unknown) => sendResponse({ type: "ERROR", message: String(err) }));
    return true; // async response
  });
  log.info("TradeVision background worker ready (paper-only).");
}

export { handle as handleMessage };
