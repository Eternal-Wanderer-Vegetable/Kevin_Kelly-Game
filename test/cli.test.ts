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
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { ExperimentEvent } from "../src/contracts/index.js";

const execFileAsync = promisify(execFile);

async function runHelp(command: string): Promise<string> {
  const result = await execFileAsync(process.execPath, [`dist/scripts/${command}.js`, "--help"]);
  return result.stdout;
}

interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/**
 * Runs a built entry point and reports a non-zero exit as data.
 *
 * execFile rejects on a non-zero exit, but an exit code is exactly what several
 * of these tests are asserting, so the rejection is unwrapped rather than raised.
 */
async function runScript(
  script: string,
  args: readonly string[],
): Promise<CliResult> {
  try {
    const result = await execFileAsync(process.execPath, [
      `dist/scripts/${script}.js`,
      ...args,
    ]);
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    const failure = error as {
      readonly stdout?: string;
      readonly stderr?: string;
      readonly code?: number;
    };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      code: failure.code ?? 1,
    };
  }
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

async function withEventLog(
  events: readonly ExperimentEvent[],
  run: (logPath: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "harness-cli-test-"));
  try {
    const logPath = join(directory, "events.jsonl");
    const lines = events.map((event) => JSON.stringify(event)).join("\n");
    await writeFile(logPath, events.length === 0 ? "" : `${lines}\n`, "utf8");
    await run(logPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("run-task exposes task and agent help", async () => {
  const output = await runHelp("run-task");
  assert.match(output, /Run one coding task/);
  assert.match(output, /--task <task-id>/);
  assert.match(output, /--agent <agent-id>/);
});

test("replay-run exposes event log help", async () => {
  const output = await runHelp("replay-run");
  assert.match(output, /Replay an experiment event log/);
  assert.match(output, /--input <path>/);
});

test("report exposes run and format help", async () => {
  const output = await runHelp("report");
  assert.match(output, /Generate a summary/);
  assert.match(output, /--format <json\|text>/);
});

test("harness lists every subcommand", async () => {
  const output = await runHelp("harness");
  assert.match(output, /harness <command> \[options\]/);
  for (const name of ["run-task", "replay-run", "report", "config"]) {
    assert.match(output, new RegExp(name));
  }
});

test("harness dispatches to the same help as the standalone scripts", async () => {
  const viaRoot = await runScript("harness", ["report", "--help"]);
  const viaScript = await runHelp("report");

  // The two entry points must be the same code reached two ways, not two
  // definitions that happen to agree today.
  assert.equal(viaRoot.code, 0);
  assert.equal(viaRoot.stdout, viaScript);
});

test("an unknown subcommand fails with usage", async () => {
  const result = await runScript("harness", ["frobnicate"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown command: frobnicate/);
  assert.match(result.stderr, /Commands:/);
});

test("replay-run summarises a written event log", async () => {
  const events = [
    stateEvent("run-alpha", "agent-a", "ACTIVE", 1),
    stateEvent("run-alpha", "agent-b", "ACTIVE", 2),
    stateEvent("run-alpha", "agent-b", "DEAD", 3),
  ];

  await withEventLog(events, async (logPath) => {
    const json = await runScript("replay-run", [
      "--input",
      logPath,
      "--format",
      "json",
    ]);
    assert.equal(json.code, 0);
    const report: unknown = JSON.parse(json.stdout);
    assert.deepEqual(report, {
      eventLog: logPath,
      runId: "run-alpha",
      eventCount: 3,
      // The last state per agent wins, which is what a replay is for.
      agents: { "agent-a": "ACTIVE", "agent-b": "DEAD" },
    });

    const text = await runScript("replay-run", ["--input", logPath]);
    assert.equal(text.code, 0);
    assert.match(text.stdout, /run: {7}run-alpha/);
    assert.match(text.stdout, /events: {4}3/);
    assert.match(text.stdout, /agent-b {2}DEAD/);
  });
});

test("replay-run refuses a mixed log until a run is named", async () => {
  const events = [
    stateEvent("run-alpha", "agent-a", "ACTIVE", 1),
    stateEvent("run-beta", "agent-b", "DEAD", 2),
  ];

  await withEventLog(events, async (logPath) => {
    const refused = await runScript("replay-run", ["--input", logPath]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /select one with --run/);

    const selected = await runScript("replay-run", [
      "--input",
      logPath,
      "--run",
      "run-beta",
      "--format",
      "json",
    ]);
    assert.equal(selected.code, 0);
    const report = JSON.parse(selected.stdout) as Record<string, unknown>;
    assert.equal(report.runId, "run-beta");
    assert.equal(report.eventCount, 1);
  });
});

test("a missing event log is named rather than reported as empty", async () => {
  const result = await runScript("report", [
    "--input",
    join(tmpdir(), "harness-cli-test-absent", "events.jsonl"),
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /event log not found/);
});

test("config prints resolved values and masks credentials", async () => {
  const result = await execFileAsync(
    process.execPath,
    ["dist/scripts/harness.js", "config", "--format", "json"],
    {
      env: {
        ...process.env,
        HARNESS_LOCAL_MODEL_URL: "http://model.internal:8000/v1",
        HARNESS_LOCAL_MODEL_KEY: "super-secret-value",
      },
    },
  );

  const report = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(report.localModelUrl, "http://model.internal:8000/v1");
  assert.deepEqual(report.secrets, {
    HARNESS_LOCAL_MODEL_KEY: "set",
    HARNESS_EXTERNAL_MODEL_KEY: "unset",
  });
  // The point of the masking is that this output can be pasted into a bug report.
  assert.equal(result.stdout.includes("super-secret-value"), false);
});
