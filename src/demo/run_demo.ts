/**
 * Demonstration script for the TradeVision AI validation-first architecture.
 *
 * Shows the full pipeline:
 *   1. Phase 7 backtest evaluates a lineup of candidates on a fixed OOS period.
 *   2. The constraint engine enforces the 12 validation priorities.
 *   3. Phase 10 controlled retrain builds a new candidate from a pinned data version.
 *   4. Champion vs Challenger gate enforces robust improvement on unseen data.
 *   5. Production gate turns a model output into a labeled SIGNAL | NO_TRADE.
 *
 * Every decision is labeled with an exact period + dataset, and the system
 * NEVER emits a forbidden claim.
 */

import { runBacktest, BacktestLineup } from "../phases/phase7_backtest/backtest_engine.js";
import { ValidationRecord, ValidationAxis } from "../types/domain.js";
import {
  isEligibleForProduction,
  enforceChampionChallengerGate,
} from "../core/constraint_engine.js";
import { runControlledRetrain } from "../phases/phase10_retrain/retrain_pipeline.js";
import { decide } from "../prod/production_gate.js";
import { checkClaimIsSafe } from "../policy/truth_policy.js";

interface DemoMetrics {
  validationAccuracy: number;
  precision: number;
  recall: number;
  winRate: number;
  expectedValue: number;
  profitFactor: number;
  maxDrawdown: number;
  calibrationError: number;
  sharpeLike: number;
  numberOfTrades: number;
  numberOfNoTrade: number;
  perTradePnL: number[];
}

function demoMetrics(overrides: Partial<DemoMetrics> = {}): DemoMetrics {
  return {
    validationAccuracy: 0.62,
    precision: 0.58,
    recall: 0.41,
    winRate: 0.54,
    expectedValue: 0.032,
    profitFactor: 1.18,
    maxDrawdown: 0.074,
    calibrationError: 0.042,
    sharpeLike: 1.36,
    numberOfTrades: 412,
    numberOfNoTrade: 3281,
    perTradePnL: [],
    ...overrides,
  };
}

async function main() {
  console.log("=== TradeVision AI Demonstration ===\n");

  // --- Step 1: Phase 7 Backtest ---
  const lineup: BacktestLineup = {
    period: "2024-01-01..2024-06-30",
    dataset: "oos_ch3_5m_v4",
    candidates: [
      { modelId: "candidate_a", featureParams: { std: 20 }, origin: "real_out_of_sample" },
      { modelId: "candidate_b", featureParams: { std: 40 }, origin: "real_out_of_sample" },
    ],
  };

  const result = runBacktest(lineup);
  console.log("[Phase 7 Backtest]");
  console.log(`  period: ${result.period}`);
  console.log(`  dataset: ${result.dataset}\n`);

  // In a real system, the candidate would be evaluated by the full
  // Phase 7 backtest suite and the walk-forward checks would be completed
  // before production. Here we simulate a fully validated candidate so
  // the demo can show the full promotion path.
  const rawChampion = result.results[0];
  if (!rawChampion) {
    console.error("  Error: no candidate results produced.");
    process.exit(1);
    return;
  }
  const champion: ValidationRecord = rawChampion;
  const eligibleChamp = isEligibleForProduction(champion);
  console.log(`  candidate: ${champion.modelId}`);
  console.log(`    validationAccuracy=${champion.metrics.validationAccuracy}`);
  console.log(`    expectedValue=${champion.metrics.expectedValue}`);
  console.log(`    verdict=${champion.verdict}`);
  console.log(`    eligibleForProduction=${eligibleChamp}`);

  if (!eligibleChamp) {
    console.log(`\n  [Demo] The default runBacktest() result has walk-forward not yet configured.`);
    console.log(`  The system correctly refuses production promotion until full checks pass.`);
    console.log(`  To see a successful promotion, the candidate would need to pass:`);
    console.log(`    - OUT_OF_SAMPLE`);
    console.log(`    - WALK_FORWARD`);
    console.log(`    - POSITIVE_EXPECTED_VALUE`);
    console.log(`    - MAX_DRAWDOWN`);
    console.log(`    - CALIBRATION`);
    console.log(`    - NO_LEAKAGE`);
    console.log(`    - NO_OVERFITTING`);
    console.log(`  The Phase 10 retrain pipeline demonstrates how a retrained candidate`);
    console.log(`  gets evaluated on this exact checklist before the Champion vs Challenger`);
    console.log(`  gate is even consulted.`);
  }

  // --- Simulated fully-validated champion (clearly labeled) ---
  // In a real deployment this record would be produced by the full
  // validation suite (including walk-forward). We construct it here so the
  // demo can show the promotion + production path end-to-end.
  const simulatedChampion: ValidationRecord = {
    ...champion,
    verdict: "PASS",
    checks: [
      { axis: ValidationAxis.OUT_OF_SAMPLE, passed: true, evidence: `OOS on ${champion.period}/${champion.dataset}` },
      { axis: ValidationAxis.WALK_FORWARD, passed: true, evidence: "walk-forward folds passed" },
      { axis: ValidationAxis.POSITIVE_EXPECTED_VALUE, passed: true, evidence: `expectedValue=${champion.metrics.expectedValue}` },
      { axis: ValidationAxis.MAX_DRAWDOWN, passed: true, evidence: `maxDrawdown=${champion.metrics.maxDrawdown}` },
      { axis: ValidationAxis.CALIBRATION, passed: true, evidence: `calibrationError=${champion.metrics.calibrationError}` },
      { axis: ValidationAxis.NO_LEAKAGE, passed: true, evidence: "no leakage detected" },
      { axis: ValidationAxis.NO_OVERFITTING, passed: true, evidence: "no overfitting detected" },
    ],
  };
  console.log(`\n  [Demo] Using a simulated fully-validated champion record:`);
  console.log(`    modelId=${simulatedChampion.modelId} eligibleForProduction=${isEligibleForProduction(simulatedChampion)}`);

  // --- Step 2: Phase 10 Controlled Retrain ---
  const challenger = runControlledRetrain(
    "retrain_run_001",
    "ch3_features_v4",
    "ensemble_logistic_v3",
    simulatedChampion,
    demoMetrics({ validationAccuracy: 0.66, expectedValue: 0.041, precision: 0.60 }),
    ["baseline_moving_average_v3"],
    { period: "2024-01-01..2024-06-30", dataset: "ch3_features_v4_oos", value: {accuracy: 0.66, expectedValue: 0.041} },
    simulatedChampion.modelId,
  );

  console.log("\n[Phase 10 Controlled Retrain]");
  console.log(`  runId: ${challenger.runId}`);
  console.log(`  dataVersion: ${challenger.dataVersion}`);
  console.log(`  candidate verdict: ${challenger.candidateRecord.verdict}`);

  if (challenger.gateResult.state === "PROMOTED") {
    console.log(`  gateResult: PROMOTED -> ${challenger.gateResult.promotedId}`);
  } else {
    console.log(`  gateResult: REJECTED -> ${challenger.gateResult.reason}`);
  }

  // --- Step 3: Champion vs Challenger gate ---
  const championRecord = simulatedChampion;
  const gateResult = enforceChampionChallengerGate(
    challenger.candidateRecord.modelId,
    championRecord,
    challenger.candidateRecord,
  );
  console.log("\n[Champion vs Challenger Gate]");
  console.log(`  promoted: ${gateResult.promoted}`);
  console.log(`  championStays: ${gateResult.championStays}`);

  // --- Step 4: Production decide ---
  const productionRecord = championRecord;
  const prod = decide(
    productionRecord.modelId,
    productionRecord,
    productionRecord.modelId, // requested production model matches
    {
      timestamp: 1704067200,
      asset: "TST",
      timeframe: "5m",
      values: { sma20: 100.5, rsi14: 55.0, bb_width: 0.02 },
    },
    "BUY",
    0.66,
    `ensemble_logistic_v3: validated OOS on ${productionRecord.period}/${productionRecord.dataset}`,
    "p0",
  );

  console.log("\n[Production Decide]");
  console.log(`  outcome: ${prod.outcome}`);
  console.log(`  rawSignal: ${prod.labeledSignal.rawSignal}`);
  console.log(`  reason: ${prod.labeledSignal.reason}`);

  // A forbidden claim in the reason must block the signal (fail closed).
  const prodBlocked = decide(
    productionRecord.modelId,
    productionRecord,
    productionRecord.modelId,
    {
      timestamp: 1704067201,
      asset: "TST",
      timeframe: "5m",
      values: { sma20: 100.5, rsi14: 55.0, bb_width: 0.02 },
    },
    "BUY",
    0.66,
    "This signal offers guaranteed profits on every trade",
    "p0",
  );

  console.log("\n[Production Decide - forbidden claim]");
  console.log(`  outcome: ${prodBlocked.outcome}`);
  console.log(`  reason: ${prodBlocked.labeledSignal.reason}`);

  // --- Step 5: Truth policy enforcement ---
  const claimCheck = checkClaimIsSafe(
    `This model has 99.9% accuracy and guaranteed profits on ${productionRecord.period}/${productionRecord.dataset}`,
  );
  console.log("\n[Truth Policy Enforcement]");
  if (claimCheck.safe) {
    console.log(`  claim is safe`);
  } else {
    console.log(`  claim blocked: ${claimCheck.reason}`);
  }

  const safeReport = `[Report] modelId=${productionRecord.modelId} period=${productionRecord.period} dataset=${productionRecord.dataset} validationAccuracy=${productionRecord.metrics.validationAccuracy} winRate=${productionRecord.metrics.winRate} expectedValue=${productionRecord.metrics.expectedValue} numberOfTrades=${productionRecord.metrics.numberOfTrades} numberOfNoTrade=${productionRecord.metrics.numberOfNoTrade}`;
  console.log(`\n  SAFE REPORT: ${safeReport}`);
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
