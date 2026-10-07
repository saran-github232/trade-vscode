/**
 * SnapshotStore — persists every MarketSnapshot keyed by its deterministic
 * `snapshotId`, indexed by asset/timeframe.
 *
 * Each stored record carries the self-describing metadata required by the
 * Phase 2 spec: snapshotId, timestamp, asset, timeframe, dataVersion,
 * featureVersion. Local-first and in-memory (bounded); no network.
 */

import type { MarketSnapshot, Timeframe } from "../types/market.js";

export interface SnapshotRecord {
  snapshotId: string;
  timestamp: number;
  asset: string;
  timeframe: Timeframe;
  dataVersion: string;
  featureVersion: string;
  /** Convenience projections for indexing. */
  score: number;
  source: MarketSnapshot["source"];
}

export interface SnapshotQuery {
  asset?: string;
  timeframe?: Timeframe;
  /** Inclusive epoch-ms bounds on snapshot.timestamp. */
  from?: number;
  to?: number;
  limit?: number;
}

function toRecord(s: MarketSnapshot): SnapshotRecord {
  return {
    snapshotId: s.snapshotId,
    timestamp: s.timestamp,
    asset: s.asset,
    timeframe: s.timeframe,
    dataVersion: s.dataVersion,
    featureVersion: s.featureVersion,
    score: s.quality.score,
    source: s.source,
  };
}

export class SnapshotStore {
  private readonly byId = new Map<string, MarketSnapshot>();
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  /**
   * Store a snapshot. Identical `snapshotId` overwrites (idempotent) and does
   * not grow the store. Returns the stored snapshot.
   */
  save(snapshot: MarketSnapshot): MarketSnapshot {
    this.byId.set(snapshot.snapshotId, snapshot);
    // Bounded: drop oldest by timestamp when over capacity.
    if (this.byId.size > this.maxEntries) {
      const ordered = [...this.byId.values()].sort((a, b) => a.timestamp - b.timestamp);
      const excess = ordered.slice(0, this.byId.size - this.maxEntries);
      for (const s of excess) this.byId.delete(s.snapshotId);
    }
    return snapshot;
  }

  get(snapshotId: string): MarketSnapshot | undefined {
    return this.byId.get(snapshotId);
  }

  has(snapshotId: string): boolean {
    return this.byId.has(snapshotId);
  }

  /** Metadata-only view of all stored snapshots (newest first). */
  records(query: SnapshotQuery = {}): SnapshotRecord[] {
    let out = [...this.byId.values()];
    if (query.asset !== undefined) out = out.filter((s) => s.asset === query.asset);
    if (query.timeframe !== undefined) out = out.filter((s) => s.timeframe === query.timeframe);
    if (query.from !== undefined) out = out.filter((s) => s.timestamp >= query.from!);
    if (query.to !== undefined) out = out.filter((s) => s.timestamp <= query.to!);
    out.sort((a, b) => b.timestamp - a.timestamp);
    if (query.limit !== undefined) out = out.slice(0, query.limit);
    return out.map(toRecord);
  }

  count(): number {
    return this.byId.size;
  }

  clear(): void {
    this.byId.clear();
  }
}
