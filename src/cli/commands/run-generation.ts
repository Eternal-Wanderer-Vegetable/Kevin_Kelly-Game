/*
 * Copyright (C) 2026 Vegetable
 *
 * This file is part of Evolving Coding Harness.
 *
 * Evolving Coding Harness is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Evolving Coding Harness is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Evolving Coding Harness. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  assertTaskSpec,
  type ExperimentEvent,
  type HumanAcceptance,
  type TaskSpec,
} from "../../contracts/index.js";
import {
  CalibrationRunner,
  hashObject,
  type CalibrationComparison,
  type CalibrationTask,
  type ExperimentConfig,
  type ExperimentRun,
  type ExperimentRunOptions,
} from "../../experiment/calibration.js";
import {
  GeneralizationRunner,
  type GeneralizationThresholds,
  type GeneralizationPlan,
  type GeneralizationReport,
  type GeneralizationRunOptions,
} from "../../experiment/generalization.js";
import { EventLog } from "../../experiment/event-log.js";
import {
  CONFIG_OPTIONS,
  CONFIG_OPTION_HELP,
  formatOption,
  parseCommandArgs,
  requireStringOption,
  resolveConfig,
  stringOption,
  type CliOptionConfig,
} from "../args.js";
import { CliError, describeError, type CliCommand } from "../command.js";
import { resolveEventLogPath } from "../events.js";
import type { CommandDefinition } from "../help.js";

export const definition: CommandDefinition = {
  name: "run-generation",
  summary: "Run one calibration or generalization experiment generation.",
  usage: "run-generation --plan <plan.json> [--format <json|text>]",
  options: [
    "--plan <path>                Read a calibration or generalization plan.",
    "--format <json|text>         Choose the output format; text by default.",
    "--event-log <path>           Override the append-only event log path.",
    ...CONFIG_OPTION_HELP.filter((option) => !option.startsWith("--event-log")),
    "--help, -h                   Show this help.",
  ],
};

const options: CliOptionConfig = {
  plan: { type: "string" },
  format: { type: "string" },
  ...CONFIG_OPTIONS,
};

export type GenerationPlan =
  | CalibrationGenerationPlan
  | GeneralizationGenerationPlan;

export interface CalibrationGenerationPlan {
  readonly schemaVersion: 1;
  readonly mode: "calibration";
  readonly config: ExperimentConfig;
  readonly task: CalibrationTask;
  readonly baselineAgentId: string;
  readonly candidateAgentId: string;
  readonly baselineOptions?: ExperimentRunOptions;
  readonly candidateOptions?: ExperimentRunOptions;
}

export interface GeneralizationGenerationPlan {
  readonly schemaVersion: 1;
  readonly mode: "generalization";
  readonly config: ExperimentConfig;
  readonly plan: GeneralizationPlan;
  readonly baselineAgentId: string;
  readonly evolvedAgentId: string;
  readonly options?: GeneralizationRunOptions;
}

export interface CalibrationGenerationResult {
  readonly baseline: ExperimentRun;
  readonly candidate: ExperimentRun;
  readonly comparison: CalibrationComparison;
}

export interface GenerationExecution {
  readonly eventLog: string;
  readonly generationRunId: string;
  readonly mode: GenerationPlan["mode"];
  readonly eventCount: number;
  readonly result:
    | CalibrationGenerationResult
    | GeneralizationReport;
}

export const runGenerationCommand: CliCommand = {
  definition,
  helpWhenEmpty: true,
  async run(args, io) {
    const { values, positionals } = parseCommandArgs(definition, args, options);
    if (positionals.length > 0) {
      throw new CliError(
        `unexpected positional argument: ${positionals[0]}`,
        definition,
      );
    }

    const planPath = requireStringOption(definition, values, "plan");
    const plan = await readGenerationPlan(planPath);
    const config = resolveConfig(values);
    const eventLogPath = resolveEventLogPath(values, config);
    const execution = await executeGeneration(plan, eventLogPath);
    const format = formatOption(values);

    io.out(
      format === "json"
        ? `${JSON.stringify(execution, null, 2)}\n`
        : formatGenerationText(execution),
    );
    return isSuccessful(execution) ? 0 : 1;
  },
};

export async function readGenerationPlan(
  path: string,
): Promise<GenerationPlan> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new CliError(`cannot read generation plan ${path}: ${describeError(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliError(
      `generation plan ${path} is not valid JSON: ${describeError(error)}`,
    );
  }

  try {
    return parseGenerationPlan(parsed);
  } catch (error) {
    throw new CliError(
      `generation plan ${path} is invalid: ${describeError(error)}`,
      definition,
    );
  }
}

export async function executeGeneration(
  plan: GenerationPlan,
  eventLogPath: string,
  generationRunId = `generation-${randomUUID()}`,
): Promise<GenerationExecution> {
  const eventLog = new EventLog(eventLogPath);
  const started = createEvent(
    generationRunId,
    "GENERATION_STARTED",
    undefined,
    {
      mode: plan.mode,
      configHash: hashObject(plan.config),
      taskCount: countTasks(plan),
    },
  );
  await eventLog.append(started);

  if (plan.mode === "calibration") {
    const runner = new CalibrationRunner();
    const baseline = await runner.runBaseline(
      plan.task,
      plan.baselineAgentId,
      plan.config,
      plan.baselineOptions,
    );
    const candidate = await runner.runCandidate(
      plan.task,
      plan.candidateAgentId,
      baseline,
      plan.config,
      plan.candidateOptions,
    );
    await eventLog.append(
      createRunEvent(generationRunId, baseline, 0),
    );
    await eventLog.append(
      createRunEvent(generationRunId, candidate, 0),
    );

    const result: CalibrationGenerationResult = {
      baseline,
      candidate,
      comparison: runner.compare([baseline], [candidate]),
    };
    await eventLog.append(
      createEvent(generationRunId, "GENERATION_COMPLETED", undefined, {
        mode: plan.mode,
        result,
      }),
    );
    return {
      eventLog: eventLogPath,
      generationRunId,
      mode: plan.mode,
      eventCount: 4,
      result,
    };
  }

  const report = await new GeneralizationRunner(plan.plan).run(
    plan.baselineAgentId,
    plan.evolvedAgentId,
    plan.config,
    plan.options,
  );
  for (const run of report.runs) {
    await eventLog.append(
      createRunEvent(generationRunId, run, plan.plan.evolvedGeneration),
    );
  }
  await eventLog.append(
    createEvent(generationRunId, "GENERATION_COMPLETED", undefined, {
      mode: plan.mode,
      result: report,
    }),
  );
  return {
    eventLog: eventLogPath,
    generationRunId,
    mode: plan.mode,
    eventCount: report.runs.length + 2,
    result: report,
  };
}

export function formatGenerationText(execution: GenerationExecution): string {
  const lines = [
    `event log:      ${execution.eventLog}`,
    `generation run: ${execution.generationRunId}`,
    `mode:           ${execution.mode}`,
    `events appended: ${execution.eventCount}`,
  ];

  if (execution.mode === "calibration") {
    const result = execution.result as CalibrationGenerationResult;
    lines.push(
      `tasks:          1`,
      `baseline:       ${formatRate(result.comparison.baseline.successRate)}`,
      `candidate:      ${formatRate(result.comparison.candidate.successRate)}`,
      `success delta:  ${formatSigned(result.comparison.successRateDelta)}`,
    );
  } else {
    const result = execution.result as GeneralizationReport;
    lines.push(
      `plan:           ${result.planId}`,
      `holdout tasks:  ${result.holdout.evolved.taskCount}`,
      `passed:         ${result.passed}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function parseGenerationPlan(value: unknown): GenerationPlan {
  const object = requireObject(value, "plan");
  if (object.schemaVersion !== 1) {
    throw new TypeError("schemaVersion must be 1");
  }
  const mode = requireString(object.mode, "mode");
  const config = parseExperimentConfig(object.config);

  if (mode === "calibration") {
    return {
      schemaVersion: 1,
      mode,
      config,
      task: parseCalibrationTask(object.task),
      baselineAgentId: optionalString(
        object.baselineAgentId,
        "agent-baseline",
        "baselineAgentId",
      ),
      candidateAgentId: optionalString(
        object.candidateAgentId,
        "agent-candidate",
        "candidateAgentId",
      ),
      ...optionalProperty(
        "baselineOptions",
        object.baselineOptions,
        parseExperimentRunOptions,
      ),
      ...optionalProperty(
        "candidateOptions",
        object.candidateOptions,
        parseExperimentRunOptions,
      ),
    };
  }

  if (mode === "generalization") {
    return {
      schemaVersion: 1,
      mode,
      config,
      plan: parseGeneralizationPlan(object.plan),
      baselineAgentId: optionalString(
        object.baselineAgentId,
        "agent-base",
        "baselineAgentId",
      ),
      evolvedAgentId: optionalString(
        object.evolvedAgentId,
        "agent-evolved",
        "evolvedAgentId",
      ),
      ...optionalProperty(
        "options",
        object.options,
        parseGeneralizationRunOptions,
      ),
    };
  }

  throw new TypeError(`mode must be calibration or generalization, received: ${mode}`);
}

function parseExperimentConfig(value: unknown): ExperimentConfig {
  const object = requireObject(value, "config");
  const timeoutMs = object.timeoutMs;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new TypeError("config.timeoutMs must be a positive integer");
  }
  return {
    energyConfigHash: requireString(object.energyConfigHash, "config.energyConfigHash"),
    timeoutMs,
    queueConfigHash: requireString(object.queueConfigHash, "config.queueConfigHash"),
    fitnessConfigHash: requireString(
      object.fitnessConfigHash,
      "config.fitnessConfigHash",
    ),
  };
}

function parseCalibrationTask(value: unknown): CalibrationTask {
  const object = requireObject(value, "task");
  const task = object.task;
  assertTaskSpec(task);
  const inputFiles = object.inputFiles;
  if (inputFiles === undefined) return { task };
  return { task, inputFiles: parseStringRecord(inputFiles, "inputFiles") };
}

function parseGeneralizationPlan(value: unknown): GeneralizationPlan {
  const object = requireObject(value, "plan");
  const tasks = requireObject(object.tasks, "plan.tasks");
  const plan: GeneralizationPlan = {
    schemaVersion: requireSchemaVersion(object.schemaVersion, "plan"),
    planId: requireString(object.planId, "plan.planId"),
    evaluatorConfigHash: requireString(
      object.evaluatorConfigHash,
      "plan.evaluatorConfigHash",
    ),
    baseHarnessHash: requireString(object.baseHarnessHash, "plan.baseHarnessHash"),
    evolvedGeneration: requirePositiveInteger(
      object.evolvedGeneration,
      "plan.evolvedGeneration",
    ),
    thresholds: parseGeneralizationThresholds(object.thresholds),
    tasks: {
      evolution: parseTaskList(tasks.evolution, "plan.tasks.evolution"),
      validation: parseTaskList(tasks.validation, "plan.tasks.validation"),
      holdout: parseTaskList(tasks.holdout, "plan.tasks.holdout"),
    },
  };
  new GeneralizationRunner(plan);
  return plan;
}

function parseGeneralizationThresholds(
  value: unknown,
): GeneralizationThresholds {
  const object = requireObject(value, "plan.thresholds");
  return {
    minSuccessRateDelta: requireFiniteNumber(
      object.minSuccessRateDelta,
      "plan.thresholds.minSuccessRateDelta",
    ),
    maxRegressionRate: requireFiniteNumber(
      object.maxRegressionRate,
      "plan.thresholds.maxRegressionRate",
    ),
    maxRuntimeIncreaseMs: requireFiniteNumber(
      object.maxRuntimeIncreaseMs,
      "plan.thresholds.maxRuntimeIncreaseMs",
    ),
    maxMemoryIncreaseBytes: requireFiniteNumber(
      object.maxMemoryIncreaseBytes,
      "plan.thresholds.maxMemoryIncreaseBytes",
    ),
    minHumanAcceptanceRate: requireFiniteNumber(
      object.minHumanAcceptanceRate,
      "plan.thresholds.minHumanAcceptanceRate",
    ),
    minSampleCount: requirePositiveInteger(
      object.minSampleCount,
      "plan.thresholds.minSampleCount",
    ),
  };
}

function parseTaskList(value: unknown, name: string): readonly CalibrationTask[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value.map((item) => parseCalibrationTask(item));
}

function parseExperimentRunOptions(value: unknown): ExperimentRunOptions {
  const object = requireObject(value, "experiment options");
  const humanAcceptance =
    object.humanAcceptance === undefined
      ? undefined
      : parseHumanAcceptance(object.humanAcceptance);
  const taskRunner =
    object.taskRunner === undefined
      ? undefined
      : parseTaskRunnerOptions(object.taskRunner);
  return {
    ...(humanAcceptance === undefined ? {} : { humanAcceptance }),
    ...(taskRunner === undefined ? {} : { taskRunner }),
  };
}

function parseGeneralizationRunOptions(
  value: unknown,
): GeneralizationRunOptions {
  const object = requireObject(value, "options");
  return {
    ...optionalRecordProperty(
      "baselineByTaskId",
      object.baselineByTaskId,
      parseExperimentRunOptions,
    ),
    ...optionalRecordProperty(
      "evolvedByTaskId",
      object.evolvedByTaskId,
      parseExperimentRunOptions,
    ),
  };
}

function parseTaskRunnerOptions(
  value: unknown,
): NonNullable<ExperimentRunOptions["taskRunner"]> {
  const object = requireObject(value, "taskRunner");
  const command =
    object.command === undefined
      ? undefined
      : parseTaskCommand(object.command);
  const inputFiles =
    object.inputFiles === undefined
      ? undefined
      : parseStringRecord(object.inputFiles, "taskRunner.inputFiles");
  const allowedEnvironment =
    object.allowedEnvironment === undefined
      ? undefined
      : parseStringArray(
          object.allowedEnvironment,
          "taskRunner.allowedEnvironment",
        );
  const environment =
    object.environment === undefined
      ? undefined
      : parseStringRecord(object.environment, "taskRunner.environment");
  const timeoutMs = parsePositiveIntegerOption(object.timeoutMs, "timeoutMs");
  const maxOutputBytes = parsePositiveIntegerOption(
    object.maxOutputBytes,
    "maxOutputBytes",
  );
  return {
    ...(command === undefined ? {} : { command }),
    ...(inputFiles === undefined ? {} : { inputFiles }),
    ...(allowedEnvironment === undefined ? {} : { allowedEnvironment }),
    ...(environment === undefined ? {} : { environment }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(maxOutputBytes === undefined ? {} : { maxOutputBytes }),
  };
}

function parseTaskCommand(
  value: unknown,
): NonNullable<ExperimentRunOptions["taskRunner"]>["command"] {
  const object = requireObject(value, "taskRunner.command");
  const args =
    object.args === undefined
      ? undefined
      : parseStringArray(object.args, "taskRunner.command.args");
  return {
    command: requireString(object.command, "taskRunner.command.command"),
    ...(args === undefined ? {} : { args }),
  };
}

function parsePositiveIntegerOption(
  value: unknown,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  return requirePositiveInteger(value, `taskRunner.${name}`);
}

function parseHumanAcceptance(value: unknown): HumanAcceptance {
  if (value === "accept" || value === "reject") return value;
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) {
    return value;
  }
  throw new TypeError("humanAcceptance must be accept, reject, or an integer from 1 to 5");
}

function createRunEvent(
  generationRunId: string,
  run: ExperimentRun,
  generation: number | undefined,
): ExperimentEvent {
  return createEvent(
    generationRunId,
    "EXPERIMENT_RUN_COMPLETED",
    run.agentId,
    {
      run,
    },
    generation,
  );
}

function createEvent(
  runId: string,
  type: string,
  agentId: string | undefined,
  payload: Readonly<Record<string, unknown>>,
  generation?: number,
): ExperimentEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${randomUUID()}`,
    runId,
    timestamp: new Date().toISOString(),
    type,
    ...(agentId === undefined ? {} : { agentId }),
    ...(generation === undefined ? {} : { generation }),
    payload,
  };
}

function countTasks(plan: GenerationPlan): number {
  return plan.mode === "calibration"
    ? 1
    : Object.values(plan.plan.tasks).reduce(
        (count, tasks) => count + tasks.length,
        0,
      );
}

function isSuccessful(execution: GenerationExecution): boolean {
  if (execution.mode === "calibration") return true;
  return (execution.result as GeneralizationReport).passed;
}

function requireObject(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function requireSchemaVersion(value: unknown, name: string): 1 {
  if (value !== 1) throw new TypeError(`${name}.schemaVersion must be 1`);
  return 1;
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function optionalString(
  value: unknown,
  fallback: string,
  name: string,
): string {
  return value === undefined ? fallback : requireString(value, name);
}

function parseStringArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value.map((item, index) => requireString(item, `${name}[${index}]`));
}

function parseStringRecord(
  value: unknown,
  name: string,
): Readonly<Record<string, string>> {
  const object = requireObject(value, name);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(object)) {
    result[key] = requireString(item, `${name}.${key}`);
  }
  return result;
}

function optionalProperty<T>(
  name: string,
  value: unknown,
  parser: (value: unknown) => T,
): Readonly<Record<string, T>> {
  return value === undefined ? {} : { [name]: parser(value) };
}

function optionalRecordProperty<T>(
  name: string,
  value: unknown,
  parser: (value: unknown) => T,
): Readonly<Record<string, Readonly<Record<string, T>>>> {
  if (value === undefined) return {};
  const object = requireObject(value, name);
  const result: Record<string, T> = {};
  for (const [key, item] of Object.entries(object)) {
    result[key] = parser(item);
  }
  return { [name]: result };
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}
