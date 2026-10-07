/**
 * BacktestingEngine — replays historical candles through the live pipeline.
 *
 * At each step it builds a snapshot, runs SignalEngine, and if a
 * directional (non-NO_TRADE) signal is produced, settles it against the
 * next candle's move. NO_TRADE steps are recorded and cost nothing.
 *
 * Outputs: per-step results, aggregate trade stats, and labeled examples
 * feeding ModelEvaluationEngine. Deterministic (no randomness added).
 */

import type { Candle, MarketSnapshot, Timeframe } from "../types/market.js";
import type { Signal } from "../types/signal.js";
import { MarketDataService } from "../services/market_data_service.js";
import { SignalEngine } from "../services/signal_engine.js";
import type { EvalExample } from "../models/model_evaluation_engine.js";

export interface BacktestStep {
  index: number;
  signal: Signal;
  /** Realized PnL for this step (0 for NO_TRADE). */
  pnl: number;
  /** Whether this step executed a trade. */
  traded: boolean;
  /** Whether the directional call was correct (only when traded). */
  correct?: boolean;
}

export interface BacktestResult {
  steps: BacktestStep[];
  totalPnl: number;
  trades: number;
  noTrades: number;
  wins: number;
  /** Fraction of traded steps that were correct. */
  accuracy: number;
  /** Expected value per traded step. */
  expectedValue: number;
  examples: EvalExample[];
}

export interface BacktestConfig {
  timeframe: Timeframe;
  /** Candles of warmup before signals are emitted. */
  warmup: number;
  /** Position size (units) for PnL; 1 = unit-normalized. */
  size: number;
}

export const DEFAULT_BACKTEST: BacktestConfig = { timeframe: "5m", warmup: 50, size: 1 };

export class BacktestingEngine {
  constructor(
    private readonly marketData: MarketDataService,
    private readonly signalEngine: SignalEngine,
    private readonly cfg: BacktestConfig = DEFAULT_BACKTEST,
  ) {}

  run(asset: string, candles: Candle[], startTime: number): BacktestResult {
    const steps: BacktestStep[] = [];
    const examples: EvalExample[] = [];
    let totalPnl = 0;
    let trades = 0;
    let noTrades = 0;
    let wins = 0;

    for (let i = this.cfg.warmup; i < candles.length - 1; i++) {
      const window = candles.slice(0, i + 1);
      const snapshot: MarketSnapshot = this.marketData.buildSnapshot(
        asset,
        this.cfg.timeframe,
        window,
        startTime + i,
      );
      const features = this.marketData.featureVector(snapshot);
      const signal = this.signalEngine.analyze(snapshot, features);

      const next = candles[i + 1] as Candle;
      const current = candles[i] as Candle;

      let pnl = 0;
      let traded = false;
      let correct: boolean | undefined;

      if (signal.direction === "UP" || signal.direction === "DOWN") {
        const move = next.close - current.close;
        const dir = signal.direction === "UP" ? 1 : -1;
        pnl = dir * move * this.cfg.size;
        traded = true;
        trades++;
        if (pnl > 0) wins++;
        correct = pnl > 0;
        totalPnl += pnl;
      } else {
        noTrades++;
      }

      examples.push({ confidence: signal.confidence, correct: correct ?? false, traded });
      steps.push({ index: i, signal, pnl, traded, correct });
    }

    const accuracy = trades === 0 ? 0 : wins / trades;
    const expectedValue = trades === 0 ? 0 : totalPnl / trades;

    return { steps, totalPnl, trades, noTrades, wins, accuracy, expectedValue, examples };
  }
}
