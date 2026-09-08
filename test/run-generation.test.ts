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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero
 * General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Evolving Coding Harness. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  executeCommand,
  type CliCommand,
  type CliIo,
} from "../src/cli/command.js";
import {
  runGenerationCommand,
  type CalibrationGenerationResult,
  type GenerationExecution,
} from "../src/cli/commands/run-generation.js";
import { CONTRACT_SCHEMA_VERSION, type TaskSpec } from "../src/contracts/index.js";
import { EventLog } from "../src/experiment/event-log.js";
import type { GeneralizationReport } from "../src/experiment/generalization.js";

const config = {
  energyConfigHash: "sha256:energy-v1",
  timeoutMs: 1000,
  queueConfigHash: "sha256:queue-v1",
  fitnessConfigHash: "sha256:fitness-v1",
};

interface Invocation {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function task(taskId: string): TaskSpec {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    taskId,
    level: 1,
    title: `generation fixture ${taskId}`,
    repository: { source: "fixture", commit: `${taskId}-commit` },
    allowedCommands: [process.execPath],
    acceptanceCriteria: ["command succeeds"],
    baselineTestCommand: `"${process.execPath}" -e "process.exit(0)"`,
  };
}

function calibrationPlan(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    mode: "calibration",
    config,
    baselineAgentId: "agent-base",
    candidateAgentId: "agent-candidate",
    task: {
      task: task("calibration-cli-task"),
      inputFiles: { "input.txt": "stable\n" },
    },
    candidateOptions: { humanAcceptance: 4 },
  };
}

function generalizationPlan(
  evolvedOptions: Record<string, unknown>,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    mode: "generalization",
    config,
    baselineAgentId: "agent-base",
    evolvedAgentId: "agent-evolved",
    plan: {
      schemaVersion: 1,
      planId: "generalization-cli-001",
      evaluatorConfigHash: "sha256:evaluator-v1",
      baseHarnessHash: "sha256:base-v1",
      evolvedGeneration: 2,
      thresholds: {
        minSuccessRateDelta: 0,
        maxRegressionRate: 0,
        maxRuntimeIncreaseMs: 1000,
        maxMemoryIncreaseBytes: 10_000_000,
        minHumanAcceptanceRate: 1,
        minSampleCount: 1,
      },
      tasks: {
        evolution: [{ task: task("evolution-cli-task") }],
        validation: [{ task: task("validation-cli-task") }],
        holdout: [{ task: task("holdout-cli-task") }],
      },
    },
    options: evolvedOptions,
  };
}

function capture(): { readonly io: CliIo; stdout(): string; stderr(): string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      out(text): void {
        stdout.push(text);
      },
      err(text): void {
        stderr.push(text);
      },
    },
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
  };
}

async function invoke(
  command: CliCommand,
  args: readonly string[],
): Promise<Invocation> {
  const captured = capture();
  const code = await executeCommand(command, args, captured.io);
  return {
    code,
    stdout: captured.stdout(),
    stderr: captured.stderr(),
  };
}

async function withDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "harness-generation-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writePlan(
  directory: string,
  name: string,
  plan: Record<string, unknown>,
): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, JSON.stringify(plan), "utf8");
  return path;
}

test("run-generation executes calibration and appends lifecycle events", async () => {
  await withDirectory(async (directory) => {
    const planPath = await writePlan(directory, "calibration.json", calibrationPlan());
    const eventLogPath = join(directory, "events", "calibration.jsonl");
    const result = await invoke(runGenerationCommand, [
      "--plan",
      planPath,
      "--event-log",
      eventLogPath,
      "--format",
      "json",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const execution = JSON.parse(result.stdout) as GenerationExecution;
    assert.equal(execution.mode, "calibration");
    assert.equal(execution.eventCount, 4);
    const calibration = execution.result as CalibrationGenerationResult;
    assert.equal(calibration.comparison.candidate.humanAcceptanceRate, 1);
    assert.equal(calibration.comparison.successRateDelta, 0);

    const events = await new EventLog(eventLogPath).readAll();
    assert.deepEqual(
      events.map((event) => event.type),
      [
        "GENERATION_STARTED",
        "EXPERIMENT_RUN_COMPLETED",
        "EXPERIMENT_RUN_COMPLETED",
        "GENERATION_COMPLETED",
      ],
    );
    assert.equal(events[1]?.generation, 0);
    assert.equal(events[2]?.generation, 0);
  });
});

test("run-generation returns a passing generalization report", async () => {
  await withDirectory(async (directory) => {
    const planPath = await writePlan(
      directory,
      "generalization.json",
      generalizationPlan({
        evolvedByTaskId: {
          "holdout-cli-task": { humanAcceptance: "accept" },
        },
      }),
    );
    const eventLogPath = join(directory, "generalization.jsonl");
    const result = await invoke(runGenerationCommand, [
      "--plan",
      planPath,
      "--event-log",
      eventLogPath,
      "--format",
      "json",
    ]);

    assert.equal(result.code, 0);
    const execution = JSON.parse(result.stdout) as GenerationExecution;
    assert.equal(execution.mode, "generalization");
    assert.equal(execution.eventCount, 8);
    const report = execution.result as GeneralizationReport;
    assert.equal(report.passed, true);
    assert.equal(report.holdout.evolved.taskCount, 1);
    assert.equal((await new EventLog(eventLogPath).readAll()).length, 8);
  });
});

test("run-generation reports a failed generalization with exit code one", async () => {
  await withDirectory(async (directory) => {
    const planPath = await writePlan(
      directory,
      "generalization-failure.json",
      generalizationPlan({
        evolvedByTaskId: {
          "holdout-cli-task": {
            taskRunner: {
              command: {
                command: process.execPath,
                args: ["-e", "process.exit(1)"],
              },
            },
          },
        },
      }),
    );
    const result = await invoke(runGenerationCommand, [
      "--plan",
      planPath,
      "--event-log",
      join(directory, "failure.jsonl"),
      "--format",
      "json",
    ]);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    const execution = JSON.parse(result.stdout) as GenerationExecution;
    const report = execution.result as GeneralizationReport;
    assert.equal(report.passed, false);
    assert.equal(report.checks.maximumRegressionRate, false);
  });
});

test("run-generation names malformed plans before execution", async () => {
  await withDirectory(async (directory) => {
    const planPath = join(directory, "malformed.json");
    await writeFile(
      planPath,
      JSON.stringify({
        schemaVersion: 1,
        mode: "generalization",
        config,
        plan: { schemaVersion: 1 },
      }),
      "utf8",
    );

    const result = await invoke(runGenerationCommand, ["--plan", planPath]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /generation plan .* is invalid/);
    assert.equal(
      await readFile(join(directory, "events.jsonl"), "utf8").catch(() => ""),
      "",
    );
  });
});
