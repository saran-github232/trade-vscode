/**
 * Secure API-key handling for TradeVision AI.
 *
 * SECURITY MODEL (local-first):
 *  - Secrets live ONLY in extension-private storage (chrome.storage.local
 *    under an isolated key, or an in-memory Map in the background worker).
 *  - A content script runs in the page's world. It must NEVER see a raw key.
 *    It receives a `SecretHandle` (opaque id) and can only ask the
 *    background (privileged) worker to use the key on its behalf.
 *  - Nothing in this module ever returns a raw key to a caller that could
 *    forward it to a page. The raw value is only accessible via the
 *    privileged `resolveForBackground` path used inside the worker.
 *
 * This module has no network side effects; it only stores/retrieves keys.
 */

/** Opaque reference to a stored secret. Safe to pass to untrusted contexts. */
export type SecretHandle = string & { readonly __brand: "SecretHandle" };

/** The metadata view of a stored secret — contains NO raw material. */
export interface SecretMeta {
  handle: SecretHandle;
  /** Non-sensitive label, e.g. "openai". */
  name: string;
  /** Last 4 chars only, for identification, e.g. "...abcd". */
  masked: string;
  createdAt: number;
}

/** The privileged full secret. Only ever materialized in the background. */
export interface ResolvedSecret {
  handle: SecretHandle;
  /** The raw API key. NEVER serialize this to a page or content script. */
  apiKey: string;
}

/** Minimal async storage interface so this is testable without chrome. */
export interface SecureStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** In-memory store used in tests and as the worker fallback. */
export class InMemorySecureStore implements SecureStore {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.map.get(key);
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
}

const PREFIX = "tv_secret:";

interface StoredSecret {
  name: string;
  apiKey: string;
  createdAt: number;
}

function makeHandle(name: string): SecretHandle {
  // Opaque id containing no key material.
  const rand = Math.random().toString(36).slice(2, 10);
  return `sk_${name}_${rand}` as SecretHandle;
}

/**
 * The vault that owns the storage boundary between privileged and
 * unprivileged contexts.
 */
export class SecretVault {
  constructor(private readonly store: SecureStore) {}

  /**
   * Store a raw API key. Returns only the opaque handle + masked metadata.
   * The raw key never leaves this method's return metadata.
   */
  async set(name: string, apiKey: string): Promise<SecretMeta> {
    if (!apiKey || apiKey.length < 8) {
      throw new Error("Refusing to store an empty or implausibly short API key.");
    }
    const handle = makeHandle(name);
    const record: StoredSecret = { name, apiKey, createdAt: Date.now() };
    await this.store.set(PREFIX + handle, JSON.stringify(record));
    return { handle, name, masked: maskKey(apiKey), createdAt: record.createdAt };
  }

  /** List stored secrets without exposing any key material. */
  async list(): Promise<SecretMeta[]> {
    const keys = await this.store.keys();
    const metas: SecretMeta[] = [];
    for (const k of keys) {
      if (!k.startsWith(PREFIX)) continue;
      const raw = await this.store.get(k);
      if (!raw) continue;
      const rec = JSON.parse(raw) as StoredSecret;
      metas.push({
        handle: k.slice(PREFIX.length) as SecretHandle,
        name: rec.name,
        masked: maskKey(rec.apiKey),
        createdAt: rec.createdAt,
      });
    }
    return metas;
  }

  async delete(handle: SecretHandle): Promise<void> {
    await this.store.remove(PREFIX + handle);
  }

  /**
   * PRIVILEGED. Resolve the raw key. Callers MUST be the background worker
   * and must never forward the result to a content script or page script.
   */
  async resolveForBackground(handle: SecretHandle): Promise<ResolvedSecret> {
    const raw = await this.store.get(PREFIX + handle);
    if (!raw) throw new Error("Secret not found for handle.");
    const rec = JSON.parse(raw) as StoredSecret;
    return { handle, apiKey: rec.apiKey };
  }
}

/** Mask a key for display: keep last 4 chars only. */
export function maskKey(apiKey: string): string {
  if (apiKey.length <= 4) return "****";
  return `...${apiKey.slice(-4)}`;
}

/**
 * Guard used before any message crosses to a content script / page.
 * Throws if a payload still contains anything that looks like a raw key.
 */
export function assertNoRawSecrets(payload: unknown): void {
  const json = JSON.stringify(payload);
  if (/(sk-[a-zA-Z0-9]{8,}|[a-zA-Z0-9]{32,})/.test(json)) {
    throw new Error("Blocked: payload appears to contain a raw secret.");
  }
}