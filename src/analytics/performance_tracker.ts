/**
 * PerformanceTracker — computes risk/return stats over a paper equity curve.
 *
 * All metrics are computed from the local paper-trading equity series and
 * are reported only alongside the exact observation count (no ungrounded
 * accuracy/profit claims).
 */

export interface PerformanceSummary {
  /** Number of equity points observed. */
  n: number;
  /** Total return fraction from first to last equity point. */
  totalReturn: number;
  /** Largest peak-to-trough equity decline (fraction). */
  maxDrawdown: number;
  /** Simple win rate over closed trades (fraction), 0 if none. */
  winRate: number;
  /** Number of closed trades. */
  trades: number;
}

export class PerformanceTracker {
  private readonly curve: number[] = [];
  private wins = 0;
  private losses = 0;

  /** Record an equity point. */
  record(equity: number): void {
    this.curve.push(equity);
  }

  /** Record a closed trade outcome. */
  recordTrade(pnl: number): void {
    if (pnl >= 0) this.wins++;
    else this.losses++;
  }

  summary(): PerformanceSummary {
    const n = this.curve.length;
    if (n < 2) {
      return { n, totalReturn: 0, maxDrawdown: 0, winRate: this.winRate(), trades: this.wins + this.losses };
    }
    const first = this.curve[0] as number;
    const last = this.curve[n - 1] as number;
    const totalReturn = first === 0 ? 0 : (last - first) / first;

    // Max drawdown.
    let peak = this.curve[0] as number;
    let maxDd = 0;
    for (const eq of this.curve) {
      if (eq > peak) peak = eq;
      const dd = peak === 0 ? 0 : (peak - eq) / peak;
      if (dd > maxDd) maxDd = dd;
    }

    return {
      n,
      totalReturn,
      maxDrawdown: maxDd,
      winRate: this.winRate(),
      trades: this.wins + this.losses,
    };
  }

  private winRate(): number {
    const t = this.wins + this.losses;
    return t === 0 ? 0 : this.wins / t;
  }

  reset(): void {
    this.curve.length = 0;
    this.wins = 0;
    this.losses = 0;
  }
}
