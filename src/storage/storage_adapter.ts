/**
 * StorageAdapter — minimal async key/value storage abstraction.
 *
 * Lets the same business logic run against chrome.storage.local (in the
 * extension), localStorage (popup/options fallback), or an in-memory Map
 * (tests / background worker).
 */

export interface StorageAdapter {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** In-memory implementation for tests and non-persistent contexts. */
export class MemoryStorage implements StorageAdapter {
  private readonly map = new Map<string, string>();
  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.map.get(key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }
  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, JSON.stringify(value));
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
}

/**
 * Adapter over the WebExtension `storage.local` area.
 * Only accepts the storage area object; no other chrome APIs are touched.
 */
export function webExtensionStorage(area: {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}): StorageAdapter {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const res = await area.get(key);
      const v = res[key];
      return v as T | undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      await area.set({ [key]: value });
    },
    async remove(key: string): Promise<void> {
      await area.remove(key);
    },
    async keys(): Promise<string[]> {
      // storage.local.get() with no args returns all entries.
      const res = await area.get("");
      return Object.keys(res);
    },
  };
}
