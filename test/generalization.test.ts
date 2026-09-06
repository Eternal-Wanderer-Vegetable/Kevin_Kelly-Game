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

import assert from "node:assert/strict";
import test from "node:test";
import {
  GeneralizationRunner,
  type GeneralizationPlan,
} from "../src/experiment/generalization.js";
import {
  CONTRACT_SCHEMA_VERSION,
  type TaskSpec,
} from "../src/contracts/index.js";
import type { CalibrationTask, ExperimentConfig } from "../src/experiment/calibration.js";

const config: ExperimentConfig = {
  energyConfigHash: "sha256:energy-v1",
  timeoutMs: 1000,
  queueConfigHash: "sha256:queue-v1",
  fitnessConfigHash: "sha256:fitness-v1",
};

function task(taskId: string, commit: string): CalibrationTask {
  const specification: TaskSpec = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    taskId,
    level: 1,
    title: `holdout ${taskId}`,
    repository: { source: "fixture", commit },
    allowedCommands: [process.execPath],
    acceptanceCriteria: ["command succeeds"],
    baselineTestCommand: `"${process.execPath}" -e "process.exit(0)"`,
  };
  return { task: specification, inputFiles: { "input.txt": `${taskId}\n` } };
}

function plan(): GeneralizationPlan {
  return {
    schemaVersion: 1,
    planId: "generalization-001",
    evaluatorConfigHash: "sha256:evaluator-v1",
    baseHarnessHash: "sha256:base-v1",
    evolvedGeneration: 1,
    thresholds: {
      minSuccessRateDelta: 0,
      maxRegressionRate: 0,
      maxRuntimeIncreaseMs: 1000,
      maxMemoryIncreaseBytes: 10_000_000,
      minHumanAcceptanceRate: 1,
      minSampleCount: 1,
    },
    tasks: {
      evolution: [task("evolution-task", "evolution-commit")],
      validation: [task("validation-task", "validation-commit")],
      holdout: [task("holdout-task", "unseen-project-commit")],
    },
  };
}

test("generalization runner compares the frozen base against an unseen holdout", async () => {
  const report = await new GeneralizationRunner(plan()).run(
    "agent-base",
    "agent-evolved",
    config,
    {
      baselineByTaskId: {
        "holdout-task": { humanAcceptance: "accept" },
      },
      evolvedByTaskId: {
        "holdout-task": { humanAcceptance: "accept" },
      },
    },
  );

  assert.equal(report.planId, "generalization-001");
  assert.equal(report.holdout.partition, "holdout");
  assert.equal(report.holdout.baseline.taskCount, 1);
  assert.equal(report.holdout.evolved.taskCount, 1);
  assert.equal(report.passed, true);
  assert.equal(report.checks.minimumSampleCount, true);
  assert.equal(report.runs.length, 6);
});

test("holdout failure is reported against precommitted thresholds", async () => {
  const report = await new GeneralizationRunner(plan()).run(
    "agent-base",
    "agent-evolved",
    config,
    {
      evolvedByTaskId: {
        "holdout-task": {
          taskRunner: {
            command: {
              command: process.execPath,
              args: ["-e", "process.exit(1)"],
            },
          },
        },
      },
    },
  );

  assert.equal(report.passed, false);
  assert.equal(report.checks.minimumSuccessRateImprovement, false);
  assert.equal(report.checks.maximumRegressionRate, false);
});

test("generalization plans reject overlapping partitions and empty partitions", () => {
  const evolutionTask = plan().tasks.evolution[0];
  if (evolutionTask === undefined) throw new Error("missing evolution fixture");
  assert.throws(
    () =>
      new GeneralizationRunner({
        ...plan(),
        tasks: {
          ...plan().tasks,
          holdout: [evolutionTask],
        },
      }),
    /multiple partitions/,
  );
  assert.throws(
    () =>
      new GeneralizationRunner({
        ...plan(),
        tasks: { ...plan().tasks, validation: [] },
      }),
    /validation partition must not be empty/,
  );
});
