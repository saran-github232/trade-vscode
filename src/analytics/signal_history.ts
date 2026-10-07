/**
 * SignalHistory — append-only store of emitted signals with paging.
 *
 * Local-first: keeps a bounded ring buffer. Persists via the injected
 * StorageAdapter so the extension can save across sessions.
 */

import type { Signal } from "../types/signal.js";
import type { StorageAdapter } from "../storage/storage_adapter.js";

const DEFAULT_CAPACITY = 500;
const KEY = "tv_signal_history";

export class SignalHistory {
  private items: Signal[] = [];

  constructor(
    private readonly capacity: number = DEFAULT_CAPACITY,
    private readonly storage?: StorageAdapter,
  ) {}

  /** Load persisted history (no-op if none). */
  async init(): Promise<void> {
    if (!this.storage) return;
    const raw = await this.storage.get<string>(KEY);
    if (raw) {
      try {
        this.items = JSON.parse(raw) as Signal[];
      } catch {
        this.items = [];
      }
    }
  }

  push(signal: Signal): void {
    this.items.push(signal);
    if (this.items.length > this.capacity) {
      this.items = this.items.slice(this.items.length - this.capacity);
    }
    void this.storage?.set(KEY, JSON.stringify(this.items));
  }

  /** Most recent `n` signals, newest first. */
  recent(n = 20): Signal[] {
    return [...this.items].reverse().slice(0, n);
  }

  /** Count of directional vs NO_TRADE signals. */
  stats(): { total: number; up: number; down: number; noTrade: number } {
    let up = 0;
    let down = 0;
    let noTrade = 0;
    for (const s of this.items) {
      if (s.direction === "UP") up++;
      else if (s.direction === "DOWN") down++;
      else noTrade++;
    }
    return { total: this.items.length, up, down, noTrade };
  }

  clear(): void {
    this.items = [];
    void this.storage?.remove(KEY);
  }
}
