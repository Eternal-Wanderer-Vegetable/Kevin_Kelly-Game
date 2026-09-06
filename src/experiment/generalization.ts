import type { TaskRunnerOptions } from "../tasks/task-runner.js";
import {
  CalibrationRunner,
  type CalibrationTask,
  type ExperimentConfig,
  type ExperimentRun,
  type ExperimentRunOptions,
  type ExperimentSummary,
} from "./calibration.js";

export type GeneralizationPartition = "evolution" | "validation" | "holdout";

export interface GeneralizationThresholds {
  readonly minSuccessRateDelta: number;
  readonly maxRegressionRate: number;
  readonly maxRuntimeIncreaseMs: number;
  readonly maxMemoryIncreaseBytes: number;
  readonly minHumanAcceptanceRate: number;
  readonly minSampleCount: number;
}

export interface GeneralizationPlan {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly evaluatorConfigHash: string;
  readonly baseHarnessHash: string;
  readonly evolvedGeneration: number;
  readonly thresholds: GeneralizationThresholds;
  readonly tasks: Readonly<Record<GeneralizationPartition, readonly CalibrationTask[]>>;
}

export interface PartitionComparison {
  readonly partition: GeneralizationPartition;
  readonly baseline: ExperimentSummary;
  readonly evolved: ExperimentSummary;
  readonly successRateDelta: number;
  readonly regressionRateDelta: number;
  readonly runtimeDeltaMs: number;
  readonly memoryDeltaBytes: number;
}

export interface GeneralizationReport {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly holdout: PartitionComparison;
  readonly passed: boolean;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly runs: readonly ExperimentRun[];
}

export interface GeneralizationRunOptions {
  readonly baselineByTaskId?: Readonly<Record<string, ExperimentRunOptions>>;
  readonly evolvedByTaskId?: Readonly<Record<string, ExperimentRunOptions>>;
}

export class GeneralizationRunner {
  private readonly calibration = new CalibrationRunner();

  public constructor(private readonly plan: GeneralizationPlan) {
    validatePlan(plan);
  }

  public async run(
    baselineAgentId: string,
    evolvedAgentId: string,
    config: ExperimentConfig,
    options: GeneralizationRunOptions = {},
  ): Promise<GeneralizationReport> {
    const allRuns: ExperimentRun[] = [];
    const comparisons: PartitionComparison[] = [];

    for (const partition of ["evolution", "validation", "holdout"] as const) {
      const baselineRuns: ExperimentRun[] = [];
      const evolvedRuns: ExperimentRun[] = [];
      for (const calibrationTask of this.plan.tasks[partition]) {
        const taskOptions = options.baselineByTaskId?.[calibrationTask.task.taskId] ?? {};
        const baseline = await this.calibration.runBaseline(
          calibrationTask,
          baselineAgentId,
          config,
          taskOptions,
        );
        const evolvedOptions = options.evolvedByTaskId?.[calibrationTask.task.taskId] ?? {};
        const evolved = await this.calibration.runCandidate(
          calibrationTask,
          evolvedAgentId,
          baseline,
          config,
          evolvedOptions,
        );
        baselineRuns.push(baseline);
        evolvedRuns.push(evolved);
        allRuns.push(baseline, evolved);
      }
      comparisons.push(this.comparePartition(partition, baselineRuns, evolvedRuns));
    }

    const holdout = comparisons[2];
    if (holdout === undefined) {
      throw new Error("generalization plan must contain a holdout partition");
    }
    const checks = this.evaluateHoldout(holdout);
    return {
      schemaVersion: 1,
      planId: this.plan.planId,
      holdout,
      passed: Object.values(checks).every(Boolean),
      checks,
      runs: allRuns,
    };
  }

  private comparePartition(
    partition: GeneralizationPartition,
    baselineRuns: readonly ExperimentRun[],
    evolvedRuns: readonly ExperimentRun[],
  ): PartitionComparison {
    const baseline = this.calibration.summarize(baselineRuns);
    const evolved = this.calibration.summarize(evolvedRuns);
    return {
      partition,
      baseline,
      evolved,
      successRateDelta: evolved.successRate - baseline.successRate,
      regressionRateDelta: evolved.regressionRate - baseline.regressionRate,
      runtimeDeltaMs: evolved.averageRuntimeMs - baseline.averageRuntimeMs,
      memoryDeltaBytes:
        evolved.averageMemoryPeakBytes - baseline.averageMemoryPeakBytes,
    };
  }

  private evaluateHoldout(
    holdout: PartitionComparison,
  ): Record<string, boolean> {
    const thresholds = this.plan.thresholds;
    const acceptanceRate = holdout.evolved.humanAcceptanceRate;
    return {
      minimumSuccessRateImprovement:
        holdout.successRateDelta >= thresholds.minSuccessRateDelta,
      maximumRegressionRate:
        holdout.evolved.regressionRate <= thresholds.maxRegressionRate,
      maximumRuntimeIncrease:
        holdout.runtimeDeltaMs <= thresholds.maxRuntimeIncreaseMs,
      maximumMemoryIncrease:
        holdout.memoryDeltaBytes <= thresholds.maxMemoryIncreaseBytes,
      minimumHumanAcceptance:
        acceptanceRate !== null &&
        acceptanceRate >= thresholds.minHumanAcceptanceRate,
      minimumSampleCount:
        holdout.evolved.taskCount >= thresholds.minSampleCount,
    };
  }
}

function validatePlan(plan: GeneralizationPlan): void {
  if (plan.schemaVersion !== 1) {
    throw new TypeError("generalization plan schemaVersion is unsupported");
  }
  for (const value of [
    plan.planId,
    plan.evaluatorConfigHash,
    plan.baseHarnessHash,
  ]) {
    if (value.trim().length === 0) throw new TypeError("generalization plan identity must not be empty");
  }
  if (!Number.isInteger(plan.evolvedGeneration) || plan.evolvedGeneration < 1) {
    throw new TypeError("evolvedGeneration must be a positive integer");
  }
  validateThresholds(plan.thresholds);

  const seenTaskIds = new Set<string>();
  for (const partition of ["evolution", "validation", "holdout"] as const) {
    const tasks = plan.tasks[partition];
    if (tasks.length === 0) {
      throw new Error(`${partition} partition must not be empty`);
    }
    for (const calibrationTask of tasks) {
      if (seenTaskIds.has(calibrationTask.task.taskId)) {
        throw new Error(`task appears in multiple partitions: ${calibrationTask.task.taskId}`);
      }
      seenTaskIds.add(calibrationTask.task.taskId);
    }
  }
}

function validateThresholds(thresholds: GeneralizationThresholds): void {
  if (
    !Number.isFinite(thresholds.minSuccessRateDelta) ||
    !Number.isFinite(thresholds.maxRegressionRate) ||
    !Number.isFinite(thresholds.maxRuntimeIncreaseMs) ||
    !Number.isFinite(thresholds.maxMemoryIncreaseBytes) ||
    !Number.isFinite(thresholds.minHumanAcceptanceRate) ||
    !Number.isInteger(thresholds.minSampleCount) ||
    thresholds.minSampleCount < 1
  ) {
    throw new TypeError("generalization thresholds are invalid");
  }
  if (thresholds.maxRegressionRate < 0 || thresholds.maxRegressionRate > 1) {
    throw new TypeError("maxRegressionRate must be between 0 and 1");
  }
  if (
    thresholds.minHumanAcceptanceRate < 0 ||
    thresholds.minHumanAcceptanceRate > 1
  ) {
    throw new TypeError("minHumanAcceptanceRate must be between 0 and 1");
  }
}
