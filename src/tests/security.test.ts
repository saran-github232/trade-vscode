/**
 * Security tests: secret handling, log redaction, config env parsing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SecretVault,
  InMemorySecureStore,
  maskKey,
  assertNoRawSecrets,
} from "../security/secrets.js";
import { redact, Logger, MemorySink } from "../utils/logger.js";
import { loadConfig } from "../config/config.js";

test("SecretVault never exposes raw keys via list()", async () => {
  const vault = new SecretVault(new InMemorySecureStore());
  const meta = await vault.set("openai", "sk-abcdef1234567890abcd");
  const list = await vault.list();
  const serialized = JSON.stringify(list);
  assert.ok(!serialized.includes("sk-abcdef1234567890abcd"));
  assert.ok(meta.masked.endsWith("abcd"));
  assert.ok(list.length === 1);
});

test("resolveForBackground is the only raw-key path and works", async () => {
  const vault = new SecretVault(new InMemorySecureStore());
  const meta = await vault.set("provider", "sk-secretvalue1234");
  const resolved = await vault.resolveForBackground(meta.handle);
  assert.equal(resolved.apiKey, "sk-secretvalue1234");
});

test("vault rejects implausibly short keys", async () => {
  const vault = new SecretVault(new InMemorySecureStore());
  await assert.rejects(() => vault.set("bad", "short"));
});

test("maskKey keeps only the last 4 characters", () => {
  assert.equal(maskKey("sk-1234567890"), "...7890");
  assert.equal(maskKey("abcd"), "****");
});

test("assertNoRawSecrets blocks payloads containing raw-looking keys", () => {
  assert.throws(() => assertNoRawSecrets({ apiKey: "sk-abcdefghijklmnop" }));
  assert.doesNotThrow(() => assertNoRawSecrets({ apiKey: "[REDACTED]", note: "safe" }));
});

test("logger redacts secrets and key=value pairs", () => {
  assert.ok(redact("key is sk-abcdef123456").includes("[REDACTED]"));
  assert.ok(redact("api_key=supersecret123").includes("[REDACTED]"));
  assert.ok(!redact("token: ghp_abcdefghijklmnop").includes("ghp_abcdefghijklmnop"));
  assert.ok(redact("Bearer abcdef123456789").includes("[REDACTED]"));
});

test("logger sink receives redacted lines only", () => {
  const sink = new MemorySink();
  const log = new Logger("debug", sink, "test");
  log.info("using key", { apiKey: "sk-topsecret9999" });
  const all = sink.lines.map((l) => l.line).join(" ");
  assert.ok(!all.includes("sk-topsecret9999"));
  assert.ok(all.includes("[REDACTED]"));
});

test("logger respects minimum level", () => {
  const sink = new MemorySink();
  const log = new Logger("warn", sink);
  log.debug("hidden");
  log.info("hidden");
  log.warn("shown");
  assert.equal(sink.lines.length, 1);
  assert.equal(sink.lines[0]?.level, "warn");
});

test("loadConfig parses env vars with defaults and overrides", () => {
  const cfg = loadConfig({}, {
    TV_DEBUG: "true",
    TV_MIN_CONFIDENCE: "0.75",
    TV_DEFAULT_ASSET: "BTCUSD",
    TV_ALLOWED_ASSETS: "EURUSD, BTCUSD",
    NODE_ENV: "test",
  });
  assert.equal(cfg.debug, true);
  assert.equal(cfg.minConfidence, 0.75);
  assert.equal(cfg.defaultAsset, "BTCUSD");
  assert.deepEqual(cfg.allowedAssets, ["EURUSD", "BTCUSD"]);
  assert.equal(cfg.env, "test");
  // Paper trading is always on.
  assert.equal(cfg.paperTrading, true);

  // Overrides win over env.
  const over = loadConfig({ minConfidence: 0.9 }, { TV_MIN_CONFIDENCE: "0.5" });
  assert.equal(over.minConfidence, 0.9);
});
