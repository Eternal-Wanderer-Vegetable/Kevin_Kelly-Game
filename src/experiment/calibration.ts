import { createHash, randomUUID } from "node:crypto";
import type {
  EvaluationResult,
  HumanAcceptance,
  TaskSpec,
} from "../contracts/index.js";
import { assertTaskSpec } from "../contracts/index.js";
import {
  IndependentEvaluator,
  recordHumanAcceptance,
} from "../evaluation/evaluator.js";
import type {
  TaskRunResult,
  TaskRunnerOptions,
} from "../tasks/task-runner.js";
import { runTask } from "../tasks/task-runner.js";

export interface CalibrationTask {
  readonly task: TaskSpec;
  readonly inputFiles?: Readonly<Record<string, string>>;
}

export interface ExperimentConfig {
  readonly energyConfigHash: string;
  readonly timeoutMs: number;
  readonly queueConfigHash: string;
  readonly fitnessConfigHash: string;
}

export interface ExperimentRun {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly mode: "baseline" | "candidate";
  readonly agentId: string;
  readonly task: TaskSpec;
  readonly taskSpecHash: string;
  readonly configHash: string;
  readonly evaluation: EvaluationResult;
  readonly humanAcceptance?: HumanAcceptance;
}

export interface ExperimentSummary {
  readonly mode: ExperimentRun["mode"];
  readonly taskCount: number;
  readonly successRate: number;
  readonly regressionRate: number;
  readonly averageRuntimeMs: number;
  readonly averageMemoryPeakBytes: number;
  readonly humanAcceptanceRate: number | null;
}

export interface CalibrationChange {
  readonly schemaVersion: 1;
  readonly changeId: string;
  readonly recordedAt: string;
  readonly parameter:
    | "energy"
    | "timeout"
    | "queue"
    | "fitness";
  readonly previousValue: string;
  readonly nextValue: string;
  readonly reason: string;
}

export interface CalibrationComparison {
  readonly baseline: ExperimentSummary;
  readonly candidate: ExperimentSummary;
  readonly successRateDelta: number;
  readonly regressionRateDelta: number;
  readonly runtimeDeltaMs: number;
}

export interface ExperimentRunOptions {
  readonly taskRunner?: TaskRunnerOptions;
  readonly humanAcceptance?: HumanAcceptance;
}

export class CalibrationRunner {
  private readonly evaluator = new IndependentEvaluator();

  public async runBaseline(
    calibrationTask: CalibrationTask,
    agentId: string,
    config: ExperimentConfig,
    options: ExperimentRunOptions = {},
  ): Promise<ExperimentRun> {
    return this.execute(
      calibrationTask,
      agentId,
      "baseline",
      config,
      undefined,
      options,
    );
  }

  public async runCandidate(
    calibrationTask: CalibrationTask,
    agentId: string,
    baseline: ExperimentRun,
    config: ExperimentConfig,
    options: ExperimentRunOptions = {},
  ): Promise<ExperimentRun> {
    if (baseline.mode !== "baseline") {
      throw new Error("candidate evaluation requires a baseline run");
    }
    if (baseline.task.taskId !== calibrationTask.task.taskId) {
      throw new Error("candidate task does not match baseline task");
    }
    return this.execute(
      calibrationTask,
      agentId,
      "candidate",
      config,
      baseline,
      options,
    );
  }

  public summarize(runs: readonly ExperimentRun[]): ExperimentSummary {
    if (runs.length === 0) {
      throw new Error("cannot summarize an empty experiment");
    }
    const firstRun = runs[0];
    if (firstRun === undefined) {
      throw new Error("cannot summarize an empty experiment");
    }
    const successCount = runs.filter((run) => run.evaluation.taskSuccess).length;
    const acceptedRuns = runs.filter(
      (run) => run.humanAcceptance !== undefined,
    );
    const acceptedCount = acceptedRuns.filter(
      (run) =>
        run.humanAcceptance === "accept" ||
        (typeof run.humanAcceptance === "number" && run.humanAcceptance >= 3),
    ).length;
    return {
      mode: firstRun.mode,
      taskCount: runs.length,
      successRate: successCount / runs.length,
      regressionRate:
        runs.reduce((total, run) => total + run.evaluation.regressionRate, 0) /
        runs.length,
      averageRuntimeMs:
        runs.reduce((total, run) => total + run.evaluation.runtimeMs, 0) /
        runs.length,
      averageMemoryPeakBytes:
        runs.reduce(
          (total, run) =>
            total + run.evaluation.resourceConsumption.memoryPeakBytes,
          0,
        ) / runs.length,
      humanAcceptanceRate:
        acceptedRuns.length === 0 ? null : acceptedCount / acceptedRuns.length,
    };
  }

  public compare(
    baselineRuns: readonly ExperimentRun[],
    candidateRuns: readonly ExperimentRun[],
  ): CalibrationComparison {
    const baseline = this.summarize(baselineRuns);
    const candidate = this.summarize(candidateRuns);
    return {
      baseline,
      candidate,
      successRateDelta: candidate.successRate - baseline.successRate,
      regressionRateDelta: candidate.regressionRate - baseline.regressionRate,
      runtimeDeltaMs: candidate.averageRuntimeMs - baseline.averageRuntimeMs,
    };
  }

  public recordCalibrationChange(
    parameter: CalibrationChange["parameter"],
    previousValue: unknown,
    nextValue: unknown,
    reason: string,
    recordedAt = new Date().toISOString(),
  ): CalibrationChange {
    if (reason.trim().length === 0) {
      throw new Error("calibration change reason must not be empty");
    }
    return {
      schemaVersion: 1,
      changeId: `calibration-${randomUUID()}`,
      recordedAt,
      parameter,
      previousValue: canonicalJson(previousValue),
      nextValue: canonicalJson(nextValue),
      reason,
    };
  }

  private async execute(
    calibrationTask: CalibrationTask,
    agentId: string,
    mode: ExperimentRun["mode"],
    config: ExperimentConfig,
    baseline: ExperimentRun | undefined,
    options: ExperimentRunOptions,
  ): Promise<ExperimentRun> {
    assertTaskSpec(calibrationTask.task);
    validateConfig(config);
    const taskResult = await runTask(
      calibrationTask.task,
      calibrationTask.inputFiles === undefined
        ? options.taskRunner
        : {
            ...(options.taskRunner ?? {}),
            inputFiles: calibrationTask.inputFiles,
          },
    );
    const evaluation = this.evaluator.evaluate({
      task: calibrationTask.task,
      agentId,
      candidate: taskResult,
      ...(baseline === undefined
        ? {}
        : {
            baseline: await this.runBaselineTask(calibrationTask, options),
          }),
    });
    const annotated =
      options.humanAcceptance === undefined
        ? evaluation
        : recordHumanAcceptance(evaluation, options.humanAcceptance);
    return {
      schemaVersion: 1,
      runId: `run-${randomUUID()}`,
      mode,
      agentId,
      task: calibrationTask.task,
      taskSpecHash: hashObject(calibrationTask.task),
      configHash: hashObject(config),
      evaluation: annotated,
      ...(options.humanAcceptance === undefined
        ? {}
        : { humanAcceptance: options.humanAcceptance }),
    };
  }

  private async runBaselineTask(
    calibrationTask: CalibrationTask,
    options: ExperimentRunOptions,
  ): Promise<TaskRunResult> {
    return runTask(
      calibrationTask.task,
      calibrationTask.inputFiles === undefined
        ? options.taskRunner
        : {
            ...(options.taskRunner ?? {}),
            inputFiles: calibrationTask.inputFiles,
          },
    );
  }
}

export function hashObject(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function validateConfig(config: ExperimentConfig): void {
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new TypeError("experiment timeoutMs must be a positive integer");
  }
  for (const [name, value] of Object.entries(config)) {
    if (name !== "timeoutMs" && value.trim().length === 0) {
      throw new TypeError(`${name} must not be empty`);
    }
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}
