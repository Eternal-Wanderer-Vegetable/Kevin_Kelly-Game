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

import { readFile } from "node:fs/promises";
import {
  assertTaskSpec,
  type TaskSpec,
} from "../../contracts/index.js";
import type { EnergyPolicy } from "../../energy/ledger.js";
import type { PolicyConfig } from "../../evolution/genome-runtime.js";
import { MutationPlanner } from "../../evolution/mutation-planner.js";
import {
  EvolutionLoop,
  type EvolutionPlan,
  type EvolutionResult,
} from "../../experiment/evolution-loop.js";
import { EventLog } from "../../experiment/event-log.js";
import { MockCognitionProvider } from "../../providers/mock-cognition.js";
import { createProviderFromConfig } from "../../providers/openai-compatible.js";
import { QueuedCognitionProvider } from "../../providers/queued-cognition.js";
import { TieredCognitionProvider } from "../../providers/tiered-cognition.js";
import { SharedSlmQueue } from "../../scheduler/shared-slm-queue.js";
import type { CognitionProvider } from "../../core/agent-core.js";
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
  name: "run-evolution",
  summary: "Run the full evolution loop for N generations.",
  usage:
    "run-evolution --plan <plan.json> [--provider <mock|local>] [--format <json|text>]",
  options: [
    "--plan <path>                Read an evolution plan (schemaVersion 1).",
    "--provider <mock|local>     Cognition provider; mock by default.",
    "--format <json|text>        Choose the output format; text by default.",
    "--event-log <path>          Override the append-only event log path.",
    ...CONFIG_OPTION_HELP.filter((option) => !option.startsWith("--event-log")),
    "--help, -h                   Show this help.",
  ],
};

const options: CliOptionConfig = {
  plan: { type: "string" },
  provider: { type: "string" },
  format: { type: "string" },
  ...CONFIG_OPTIONS,
};

export const runEvolutionCommand: CliCommand = {
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
    const plan = await readEvolutionPlan(
      requireStringOption(definition, values, "plan"),
    );
    const config = resolveConfig(values);
    const eventLogPath = resolveEventLogPath(values, config);
    const providerKind = stringOption(values, "provider") ?? "mock";
    if (providerKind !== "mock" && providerKind !== "local") {
      throw new CliError(
        `--provider must be mock or local; received: ${providerKind}`,
        definition,
      );
    }

    const queue = new SharedSlmQueue();
    const local: CognitionProvider =
      providerKind === "local"
        ? createProviderFromConfig(config, "local")
        : new MockCognitionProvider({ type: "test", input: { command: plan.tasks[0]?.task.baselineTestCommand ?? "" } });
    const external =
      providerKind === "local" && config.externalModelUrl !== undefined
        ? createProviderFromConfig(config, "external")
        : undefined;

    const loop = new EvolutionLoop(plan, {
      eventLog: new EventLog(eventLogPath),
      planner: new MutationPlanner(local),
      cognitionFor: (agentId, policy: PolicyConfig) =>
        new TieredCognitionProvider(
          new QueuedCognitionProvider(local, queue, {
            ...(policy.queuePriority === undefined
              ? {}
              : { priority: policy.queuePriority }),
          }),
          external === undefined
            ? undefined
            : new QueuedCognitionProvider(external, queue),
          policy,
        ),
    });

    const result = await loop.run();
    const format = formatOption(values);
    io.out(
      format === "json"
        ? `${JSON.stringify(result, null, 2)}\n`
        : formatEvolutionText(result),
    );
    return 0;
  },
};

export async function readEvolutionPlan(path: string): Promise<EvolutionPlan> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new CliError(`cannot read evolution plan ${path}: ${describeError(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliError(`evolution plan ${path} is not valid JSON: ${describeError(error)}`);
  }
  try {
    return parseEvolutionPlan(parsed);
  } catch (error) {
    throw new CliError(`evolution plan ${path} is invalid: ${describeError(error)}`, definition);
  }
}

function parseEvolutionPlan(value: unknown): EvolutionPlan {
  const object = requireObject(value, "plan");
  if (object.schemaVersion !== 1) throw new TypeError("schemaVersion must be 1");
  const generations = requirePositiveInteger(object.generations, "generations");
  const maxTurnsPerTask =
    object.maxTurnsPerTask === undefined
      ? 8
      : requirePositiveInteger(object.maxTurnsPerTask, "maxTurnsPerTask");
  const agents = requireArray(object.agents, "agents").map((item, index) => {
    const agent = requireObject(item, `agents[${index}]`);
    return {
      agentId: requireString(agent.agentId, `agents[${index}].agentId`),
      genomeDir: requireString(agent.genomeDir, `agents[${index}].genomeDir`),
    };
  });
  if (agents.length === 0) throw new TypeError("agents must not be empty");
  const tasks = requireArray(object.tasks, "tasks").map((item, index) => {
    const entry = requireObject(item, `tasks[${index}]`);
    const task = entry.task;
    assertTaskSpec(task);
    const inputFiles = entry.inputFiles;
    if (inputFiles === undefined) return { task: task as TaskSpec };
    const files = requireObject(inputFiles, `tasks[${index}].inputFiles`);
    const parsed: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      if (typeof content !== "string") {
        throw new TypeError(`tasks[${index}].inputFiles.${path} must be a string`);
      }
      parsed[path] = content;
    }
    return { task: task as TaskSpec, inputFiles: parsed };
  });
  if (tasks.length === 0) throw new TypeError("tasks must not be empty");

  const policy = requireObject(object.energyPolicy, "energyPolicy");
  const energyPolicy: EnergyPolicy = {
    initialEnergy: requireNonNegativeNumber(policy.initialEnergy, "energyPolicy.initialEnergy"),
    debitByReason: requireNumberRecord(policy.debitByReason, "energyPolicy.debitByReason"),
    rewardByReason: requireNumberRecord(policy.rewardByReason, "energyPolicy.rewardByReason"),
  };
  const directories = requireObject(object.directories, "directories");
  return {
    schemaVersion: 1,
    generations,
    maxTurnsPerTask,
    agents,
    tasks,
    energyPolicy,
    cloneAboveEnergy: requireNonNegativeNumber(object.cloneAboveEnergy, "cloneAboveEnergy"),
    dormantBelowEnergy: requireNonNegativeNumber(object.dormantBelowEnergy, "dormantBelowEnergy"),
    rewriteAfterFailures: requirePositiveInteger(object.rewriteAfterFailures, "rewriteAfterFailures"),
    ...(object.taskTimeoutMs === undefined
      ? {}
      : { taskTimeoutMs: requirePositiveInteger(object.taskTimeoutMs, "taskTimeoutMs") }),
    directories: {
      genomeRoot: requireString(directories.genomeRoot, "directories.genomeRoot"),
      candidateRoot: requireString(directories.candidateRoot, "directories.candidateRoot"),
      archiveRoot: requireString(directories.archiveRoot, "directories.archiveRoot"),
      snapshotRoot: requireString(directories.snapshotRoot, "directories.snapshotRoot"),
    },
  };
}

function formatEvolutionText(result: EvolutionResult): string {
  const lines = [
    `evolution run:  ${result.runId}`,
    `generations:    ${result.generations.length}`,
  ];
  for (const generation of result.generations) {
    const alive = generation.agents.filter((a) => a.lifecycle !== "DEAD").length;
    const succeeded = generation.evaluations.filter((e) => e.taskSuccess).length;
    lines.push(
      `generation ${generation.generation}: agents=${generation.agents.length} alive=${alive} tasks succeeded=${succeeded}/${generation.evaluations.length}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function requireNonNegativeNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative number`);
  }
  return value;
}

function requireNumberRecord(value: unknown, name: string): Record<string, number> {
  const object = requireObject(value, name);
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(object)) {
    if (typeof item !== "number" || !Number.isFinite(item) || item < 0) {
      throw new TypeError(`${name}.${key} must be a non-negative number`);
    }
    result[key] = item;
  }
  return result;
}
