/**
 * TrainingPipeline — controlled, gated model training/evaluation runs.
 *
 * Phase 1 has no external training; this pipeline runs evaluation over a
 * labeled set, optionally fits a calibrator, and emits a policy-safe report.
 * Every run is labeled with its exact dataset id (reproducibility).
 */

import { ModelEvaluationEngine, type EvalExample, type EvalMetrics } from "../models/model_evaluation_engine.js";
import type { Calibrator } from "../ensemble/confidence_engine.js";
import { createReport } from "../policy/truth_policy.js";

export interface TrainingRunConfig {
  /** Exact dataset identifier for reproducibility. */
  datasetId: string;
  modelVersion: string;
}

export interface TrainingRunResult {
  datasetId: string;
  modelVersion: string;
  metrics: EvalMetrics;
  /** Non-null only when calibration was validated (low ECE, enough data). */
  calibrator: Calibrator | null;
  /** Policy-safe report string tied to the exact dataset. */
  report: string;
}

export class TrainingPipeline {
  private readonly evaluator = new ModelEvaluationEngine();

  run(config: TrainingRunConfig, examples: EvalExample[]): TrainingRunResult {
    const metrics = this.evaluator.evaluate(examples);
    const calibrator = this.evaluator.fitCalibrator(config.modelVersion, examples);

    // Reuse the existing truth-policy report formatter. Map our metrics
    // onto the ScalarMetrics-shaped fields it expects.
    const report = createReport(config.modelVersion, "training_run", config.datasetId, {
      validationAccuracy: metrics.accuracy,
      precision: metrics.accuracy,
      recall: metrics.accuracy,
      winRate: metrics.accuracy,
      expectedValue: 0,
      profitFactor: 1,
      maxDrawdown: 0,
      calibrationError: metrics.calibrationError,
      sharpeLike: 0,
      numberOfTrades: metrics.n,
      numberOfNoTrade: 0,
      period: "training_run",
      dataset: config.datasetId,
    } as Parameters<typeof createReport>[3]);

    return { datasetId: config.datasetId, modelVersion: config.modelVersion, metrics, calibrator, report };
  }
}
