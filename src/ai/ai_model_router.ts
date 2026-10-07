/**
 * AIModelRouter — routes analysis requests to a configured AI provider.
 *
 * SECURITY: the router only ever holds a `SecretHandle`. It asks the
 * privileged background worker to sign/authorize a request; it never
 * receives or forwards a raw API key to a page or content script.
 *
 * Phase 1 is local-first: without a configured provider, the router uses
 * a deterministic local template so analysis still works offline.
 */

import type { Signal } from "../types/signal.js";
import type { SecretHandle } from "../security/secrets.js";
import type { LogLevel } from "../utils/logger.js";

/** A provider the router can dispatch to. */
export interface AIProvider {
  id: string;
  /** The opaque handle — NOT the raw key. */
  secretHandle: SecretHandle;
  /** Fully-qualified endpoint (must be https for non-local). */
  endpoint: string;
}

/** The transport abstraction: implemented by the background worker. */
export interface AITransport {
  /**
   * Send a prompt to a provider. The implementation resolves the secret
   * on the privileged side. Implementations must never return the key.
   */
  send(provider: AIProvider, prompt: string): Promise<string>;
}

/** Local transport: no network, deterministic offline reply. */
export class LocalTransport implements AITransport {
  async send(_provider: AIProvider, prompt: string): Promise<string> {
    // Echo a bounded, clearly-local analysis stub.
    return `[local-model] Analysis for prompt length ${prompt.length}. No external API used.`;
  }
}

export class AIModelRouter {
  private provider?: AIProvider;

  constructor(
    private readonly transport: AITransport = new LocalTransport(),
    private readonly log?: (level: LogLevel, msg: string) => void,
  ) {}

  configure(provider: AIProvider): void {
    // Enforce https except localhost (local-first).
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(provider.endpoint);
    if (!provider.endpoint.startsWith("https://") && !isLocal) {
      throw new Error("Refusing non-HTTPS AI endpoint (except localhost).");
    }
    this.provider = provider;
    this.log?.("info", `AI provider configured: ${provider.id}`);
  }

  get configured(): boolean {
    return this.provider !== undefined;
  }

  async analyze(prompt: string): Promise<string> {
    if (!this.provider) {
      // Fail closed to the local transport — still functional offline.
      return new LocalTransport().send({ id: "local", secretHandle: "" as SecretHandle, endpoint: "local://" }, prompt);
    }
    return this.transport.send(this.provider, prompt);
  }
}

/** Convenience: build an analysis prompt from a signal. */
export function buildPrompt(signal: Signal, asset: string): string {
  return [
    `Analyze a ${signal.direction} signal on ${asset} (${signal.timeframe}).`,
    `score=${signal.score.toFixed(3)} confidence=${signal.confidence.toFixed(3)} (conviction, not probability).`,
    `regime=${signal.riskStatus} model=${signal.modelVersion}.`,
    `Evidence: ${signal.evidence.map((e) => e.kind).join(", ")}.`,
  ].join(" ");
}
