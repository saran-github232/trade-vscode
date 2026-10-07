/**
 * Configuration management for TradeVision AI.
 *
 * Local-first: all configuration is resolved from (in priority order):
 *   1. Explicit overrides passed by the caller (tests, options UI).
 *   2. Build-time environment variables (injected by esbuild `define`).
 *   3. Runtime `process.env` (Node / tests only).
 *   4. Safe defaults.
 *
 * Secrets (API keys) are NEVER placed in config that reaches page scripts.
 * See src/security/secrets.ts for the storage boundary.
 */

/** Environment variables are flattened to strings, per the spec. */
export type Env = Record<string, string | undefined>;

/** The full runtime configuration object. */
export interface AppConfig {
  /** Deployment environment. */
  env: "development" | "test" | "production";
  /** Enable verbose logging. */
  debug: boolean;
  /** Paper trading is always on in Phase 1 (no real-money execution). */
  paperTrading: true;
  /** Default asset symbol. */
  defaultAsset: string;
  /** Default timeframe. */
  defaultTimeframe: string;
  /** Minimum confidence required to emit a non-NO_TRADE signal. */
  minConfidence: number;
  /** Maximum allowed fraction of equity risked per trade. */
  maxRiskPerTrade: number;
  /** Comma-separated allow-list of assets. Empty = allow all. */
  allowedAssets: string[];
  /**
   * Minimum data-quality score (0-100) required before analysis is allowed.
   * Below this, signals are forced to NO_TRADE (fail closed).
   */
  minDataQuality: number;
  /** Age of the newest candle (ms) beyond which data is considered stale. */
  staleAfterMs: number;
}

/** Build-time env vars esbuild injects as globalThis.__ENV__. */
declare global {
  var __ENV__: Env | undefined;
}

function readEnv(): Env {
  // Build-time injection (browser bundle).
  if (typeof globalThis.__ENV__ === "object" && globalThis.__ENV__ !== null) {
    return globalThis.__ENV__;
  }
  // Runtime (Node / tests). Guarded so it never throws in a browser.
  if (typeof process !== "undefined" && process.env) {
    return process.env as Env;
  }
  return {};
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pick(env: Env, overrides: Partial<AppConfig>): AppConfig {
  const nodeEnv = (env["NODE_ENV"] ?? "development") as AppConfig["env"];
  const envName: AppConfig["env"] =
    nodeEnv === "production" || nodeEnv === "test" || nodeEnv === "development"
      ? nodeEnv
      : "development";

  const base: AppConfig = {
    env: envName,
    debug: bool(env["TV_DEBUG"], false),
    paperTrading: true, // Phase 1: always paper. Non-configurable on purpose.
    defaultAsset: env["TV_DEFAULT_ASSET"] ?? "EURUSD",
    defaultTimeframe: env["TV_DEFAULT_TIMEFRAME"] ?? "5m",
    minConfidence: num(env["TV_MIN_CONFIDENCE"], 0.6),
    maxRiskPerTrade: num(env["TV_MAX_RISK_PER_TRADE"], 0.02),
    allowedAssets: (env["TV_ALLOWED_ASSETS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    minDataQuality: num(env["TV_MIN_DATA_QUALITY"], 70),
    staleAfterMs: num(env["TV_STALE_AFTER_MS"], 300_000),
  };

  return { ...base, ...overrides };
}

/**
 * Resolve configuration from environment + optional overrides.
 * Pure and side-effect free so tests can inject env deterministically.
 */
export function loadConfig(overrides: Partial<AppConfig> = {}, env?: Env): AppConfig {
  return pick(env ?? readEnv(), overrides);
}