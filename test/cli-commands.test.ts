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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeCommand, type CliCommand, type CliIo } from "../src/cli/command.js";
import { configCommand } from "../src/cli/commands/config.js";
import { replayRunCommand } from "../src/cli/commands/replay-run.js";
import { reportCommand } from "../src/cli/commands/report.js";
import { runTaskCommand } from "../src/cli/commands/run-task.js";
import {
  CONTRACT_SCHEMA_VERSION,
  type ExperimentEvent,
  type TaskSpec,
} from "../src/contracts/index.js";
import { EnergyLedger, energyTransactionEvent } from "../src/energy/ledger.js";

/**
 * Drives a command through its own IO sink.
 *
 * These tests import the commands directly instead of spawning dist/: the
 * behaviour lives in src/cli/commands, so testing it there needs no build step
 * and reports a TypeScript stack when it breaks. test/cli.test.ts covers the
 * built entry points.
 */
interface Capture {
  readonly io: CliIo;
  stdout(): string;
  stderr(): string;
}

function capture(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out(text: string): void {
        out.push(text);
      },
      err(text: string): void {
        err.push(text);
      },
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

interface Invocation {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function invoke(
  command: CliCommand,
  args: readonly string[],
): Promise<Invocation> {
  const captured = capture();
  const code = await executeCommand(command, args, captured.io);
  return { code, stdout: captured.stdout(), stderr: captured.stderr() };
}

function stateEvent(
  runId: string,
  agentId: string,
  lifecycle: string,
  index: number,
): ExperimentEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${runId}-${index}`,
    runId,
    timestamp: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
    type: "AGENT_STATE_CHANGED",
    agentId,
    payload: { lifecycle },
  };
}

async function withTempDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "harness-cli-unit-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeEventLog(
  directory: string,
  events: readonly ExperimentEvent[],
): Promise<string> {
  const logPath = join(directory, "events.jsonl");
  const lines = events.map((event) => JSON.stringify(event)).join("\n");
  await writeFile(logPath, events.length === 0 ? "" : `${lines}\n`, "utf8");
  return logPath;
}

/** One run with a state change and a recorded debit, replayable end to end. */
function energyRun(): readonly ExperimentEvent[] {
  const ledger = new EnergyLedger({
    initialEnergy: 100,
    debitByReason: { "tool-call": 6 },
    rewardByReason: { "task-passed": 20 },
  });
  const debit = ledger.debit("agent-a", "tool-call");
  const reward = ledger.reward("agent-a", "task-passed");
  return [
    stateEvent("run-energy", "agent-a", "ACTIVE", 1),
    energyTransactionEvent("run-energy", debit),
    energyTransactionEvent("run-energy", reward),
  ];
}

test("help is printed for --help and for a bare invocation", async () => {
  const explicit = await invoke(reportCommand, ["--help"]);
  assert.equal(explicit.code, 0);
  assert.match(explicit.stdout, /Generate a summary/);

  const bare = await invoke(reportCommand, []);
  assert.equal(bare.code, 0);
  assert.equal(bare.stdout, explicit.stdout);
});

test("config runs bare instead of printing help", async () => {
  const result = await invoke(configCommand, []);

  // A deployment asking "what did this container resolve?" must get an answer,
  // not a usage screen.
  assert.equal(result.code, 0);
  assert.match(result.stdout, /dataDirectory:/);
  assert.match(result.stdout, /secrets \(values are never printed\):/);
  assert.equal(result.stdout.includes("Usage:"), false);
});

test("an unknown option fails with the command's usage", async () => {
  const result = await invoke(replayRunCommand, ["--frobnicate"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /frobnicate/);
  assert.match(result.stderr, /Usage:/);
});

test("an unsupported format is rejected before any work happens", async () => {
  const result = await invoke(reportCommand, ["--format", "yaml"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--format must be json or text/);
});

test("report rebuilds energy balances from recorded transactions", async () => {
  await withTempDirectory(async (directory) => {
    const logPath = await writeEventLog(directory, energyRun());
    const result = await invoke(reportCommand, [
      "--input",
      logPath,
      "--energy",
      "100",
      "--format",
      "json",
    ]);

    assert.equal(result.code, 0);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(report.runId, "run-energy");
    assert.equal(report.eventCount, 3);
    assert.deepEqual(report.eventsByType, {
      AGENT_STATE_CHANGED: 1,
      ENERGY_DEBITED: 1,
      ENERGY_REWARDED: 1,
    });
    assert.deepEqual(report.agents, [
      { agentId: "agent-a", lifecycle: "ACTIVE", energy: 114 },
    ]);
    assert.deepEqual(report.warnings, []);
  });
});

test("report warns instead of failing when the initial energy disagrees", async () => {
  await withTempDirectory(async (directory) => {
    const logPath = await writeEventLog(directory, energyRun());
    const result = await invoke(reportCommand, [
      "--input",
      logPath,
      "--energy",
      "5",
      "--format",
      "json",
    ]);

    // Everything except the balances is still true, so the report is still worth
    // printing; the operator gets told which flag to fix.
    assert.equal(result.code, 0);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(report.eventCount, 3);
    assert.deepEqual(report.agents, [
      { agentId: "agent-a", lifecycle: "ACTIVE", energy: null },
    ]);
    const warnings = report.warnings as readonly string[];
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]), /energy history is inconsistent/);
    assert.match(String(warnings[0]), /HARNESS_DEFAULT_ENERGY/);
  });
});

test("report text output aligns event types and agents", async () => {
  await withTempDirectory(async (directory) => {
    const logPath = await writeEventLog(directory, energyRun());
    const result = await invoke(reportCommand, [
      "--input",
      logPath,
      "--energy",
      "100",
    ]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /run: {12}run-energy/);
    assert.match(result.stdout, /events by type \(3\):/);
    assert.match(result.stdout, /agent-a {2}lifecycle=ACTIVE {2}energy=114/);
  });
});

test("naming a run that is not in the log fails clearly", async () => {
  await withTempDirectory(async (directory) => {
    const logPath = await writeEventLog(directory, [
      stateEvent("run-alpha", "agent-a", "ACTIVE", 1),
    ]);
    const result = await invoke(replayRunCommand, [
      "--input",
      logPath,
      "--run",
      "run-missing",
    ]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /no events found for run run-missing/);
    assert.match(result.stderr, /known runs: run-alpha/);
  });
});

test("an empty but present log replays as zero events", async () => {
  await withTempDirectory(async (directory) => {
    const logPath = await writeEventLog(directory, []);
    const result = await invoke(replayRunCommand, [
      "--input",
      logPath,
      "--format",
      "json",
    ]);

    assert.equal(result.code, 0);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(report.runId, null);
    assert.equal(report.eventCount, 0);
    assert.deepEqual(report.agents, {});
  });
});

test("run-task refuses to guess a task spec", async () => {
  const missing = await invoke(runTaskCommand, ["--format", "json"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /Unknown option|--format/);

  const noTask = await invoke(runTaskCommand, ["--json"]);
  assert.equal(noTask.code, 1);
  assert.match(noTask.stderr, /--task is required/);
  assert.match(noTask.stderr, /run-task --task <task-spec.json>/);
});

test("run-task keeps the reserved --agent option compatible", async () => {
  await withTempDirectory(async (directory) => {
    const task: TaskSpec = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      taskId: "cli-agent-option",
      level: 1,
      title: "Reserved agent option",
      repository: { source: directory, commit: "fixture" },
      allowedCommands: [process.execPath],
      acceptanceCriteria: [],
      baselineTestCommand: `"${process.execPath}" -e "process.exit(0)"`,
    };
    const taskPath = join(directory, "task.json");
    await writeFile(taskPath, JSON.stringify(task), "utf8");

    const result = await invoke(runTaskCommand, [
      "--task",
      taskPath,
      "--agent",
      "agent-a",
    ]);

    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout).success, true);
    assert.equal(result.stderr, "");
  });
});

test("run-task names which way a task spec is unusable", async () => {
  await withTempDirectory(async (directory) => {
    const absent = join(directory, "absent.json");
    const unreadable = await invoke(runTaskCommand, ["--task", absent]);
    assert.equal(unreadable.code, 1);
    assert.match(unreadable.stderr, /cannot read task spec/);

    const malformed = join(directory, "malformed.json");
    await writeFile(malformed, "{ not json", "utf8");
    const parsed = await invoke(runTaskCommand, ["--task", malformed]);
    assert.equal(parsed.code, 1);
    assert.match(parsed.stderr, /is not valid JSON/);

    const incomplete = join(directory, "incomplete.json");
    await writeFile(incomplete, JSON.stringify({ schemaVersion: 1 }), "utf8");
    const invalid = await invoke(runTaskCommand, ["--task", incomplete]);
    assert.equal(invalid.code, 1);
    assert.match(invalid.stderr, /is invalid/);
  });
});
