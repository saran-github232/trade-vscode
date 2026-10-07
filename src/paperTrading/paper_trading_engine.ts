/**
 * PaperTradingEngine — simulated paper-trading account.
 *
 * PAPER ONLY (enforced): this engine never touches real funds or places
 * real orders. It fills signals at the current price and settles them on
 * the next candle, tracking balance and equity for local evaluation.
 */

import type { Signal } from "../types/signal.js";

export interface PaperPosition {
  id: string;
  asset: string;
  direction: "UP" | "DOWN";
  entryPrice: number;
  size: number;
  openedAt: number;
}

export interface PaperFill {
  positionId: string;
  pnl: number;
  closedAt: number;
}

export interface PaperState {
  balance: number;
  equity: number;
  openPositions: PaperPosition[];
  realizedPnl: number;
  wins: number;
  losses: number;
}

export interface PaperConfig {
  startingBalance: number;
  /** Fixed size per position, as units of the asset. */
  sizePerTrade: number;
}

export const DEFAULT_PAPER: PaperConfig = { startingBalance: 10_000, sizePerTrade: 1 };

export class PaperTradingEngine {
  private balance: number;
  private realizedPnl = 0;
  private readonly open = new Map<string, PaperPosition>();
  private wins = 0;
  private losses = 0;
  private seq = 0;

  constructor(private readonly cfg: PaperConfig = DEFAULT_PAPER) {
    this.balance = cfg.startingBalance;
  }

  /** Guard: always paper. Exposed for assertions/tests. */
  readonly isPaper = true as const;

  /**
   * Open a position from a directional signal. Returns the position or
   * null for NO_TRADE / blocked signals.
   */
  onSignal(signal: Signal, currentPrice: number, asset: string): PaperPosition | null {
    if (signal.direction !== "UP" && signal.direction !== "DOWN") return null;
    if (signal.riskStatus === "blocked") return null;

    const id = `pp_${++this.seq}`;
    const pos: PaperPosition = {
      id,
      asset,
      direction: signal.direction,
      entryPrice: currentPrice,
      size: this.cfg.sizePerTrade,
      openedAt: signal.timestamp,
    };
    this.open.set(id, pos);
    return pos;
  }

  /** Close a position at the given price; returns the fill record. */
  close(positionId: string, exitPrice: number, closedAt: number): PaperFill | null {
    const pos = this.open.get(positionId);
    if (!pos) return null;
    const dir = pos.direction === "UP" ? 1 : -1;
    const pnl = dir * (exitPrice - pos.entryPrice) * pos.size;
    this.balance += pnl;
    this.realizedPnl += pnl;
    if (pnl >= 0) this.wins++;
    else this.losses++;
    this.open.delete(positionId);
    return { positionId, pnl, closedAt };
  }

  /** Mark-to-market equity given current price of the open position's asset. */
  state(currentPrice: number): PaperState {
    let unrealized = 0;
    for (const p of this.open.values()) {
      const dir = p.direction === "UP" ? 1 : -1;
      unrealized += dir * (currentPrice - p.entryPrice) * p.size;
    }
    return {
      balance: this.balance,
      equity: this.balance + unrealized,
      openPositions: [...this.open.values()],
      realizedPnl: this.realizedPnl,
      wins: this.wins,
      losses: this.losses,
    };
  }
}
