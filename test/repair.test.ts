// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { AgentAction, CognitionProvider } from "../src/core/agent-core.js";
import { assertRepairTask, type RepairTask } from "../src/experiment/repair-task.js";
import { runRepairExperiment } from "../src/experiment/repair.js";
import { DockerRepairEvaluator, resolveRepairImage, type RepairEvaluator } from "../src/experiment/repair-evaluator.js";
import { runSandboxCommand } from "../src/sandbox/runner.js";
import { createSandboxWorkspace, writeSandboxFile } from "../src/sandbox/workspace.js";
import { executeCommand } from "../src/cli/command.js";
import { runRepairCommand } from "../src/cli/commands/run-repair.js";

const task: RepairTask = JSON.parse(await readFile("examples/repair/median.json", "utf8")) as RepairTask;
const repaired = "export function median(values) { if (!values.length) return null; const sorted = [...values].sort((a,b) => a-b); const mid = Math.floor(sorted.length/2); return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid])/2; }\n";
const write: AgentAction = { type: "write", input: { path: "median.mjs", content: repaired } };
const check: AgentAction = { type: "test", input: {} };

// Unit tests run only checked-in, trusted fixtures locally. The public CLI only
// constructs DockerRepairEvaluator; it has no local-execution fallback.
const fixtureEvaluator: RepairEvaluator = {
  identity: { engine: "trusted-test-fixtures" },
  async evaluate(files, tests) {
    const workspace = await createSandboxWorkspace("repair-test-");
    try {
      for (const [path, content] of Object.entries(files)) await writeSandboxFile(workspace.inputRoot, path, content);
      const result = await runSandboxCommand({
        workspaceRoot: workspace.inputRoot, command: process.execPath,
        args: ["--test", "--test-reporter=tap", ...tests], allowedCommands: [process.execPath],
      });
      const count = (label: string) => Number(result.stdout.match(new RegExp(`^# ${label} (\\d+)\\s*$`, "m"))?.[1] ?? 0);
      return {
        passed: result.exitCode === 0 && count("pass") === count("tests") && count("tests") > 0,
        tests: count("tests"), passes: count("pass"), failures: count("fail"),
        exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs,
        stdout: result.stdout, stderr: result.stderr,
      };
    } finally { await workspace.dispose(); }
  },
};

async function run(actions: readonly AgentAction[], evaluator = fixtureEvaluator) {
  const outputRoot = await mkdtemp(join(tmpdir(), "repair-report-test-"));
  let index = 0;
  const observations: string[] = [];
  const provider: CognitionProvider = { think: async (request) => {
    observations.push(JSON.stringify(request));
    const action = actions[index++];
    if (!action) throw new Error("unexpected extra model call");
    return action;
  } };
  try {
    const report = await runRepairExperiment({ task, provider, evaluator, model: "fixture",
      maxTurns: actions.length, outputRoot, sourceCommit: "test" });
    const events = await readFile(join(report.outputDirectory, "events.jsonl"), "utf8");
    const candidate = JSON.parse(await readFile(join(report.outputDirectory, "candidate.json"), "utf8")) as Record<string, string>;
    const checksums = JSON.parse(await readFile(join(report.outputDirectory, "checksums.json"), "utf8")) as Record<string, string>;
    for (const [path, expected] of Object.entries(checksums)) {
      assert.equal(`sha256:${createHash("sha256").update(await readFile(join(report.outputDirectory, path))).digest("hex")}`, expected);
    }
    return { report, observations, events, candidate };
  } finally { await rm(outputRoot, { recursive: true, force: true }); }
}

test("repair reproduces baseline failure, runs agent turns and passes fresh independent tests", async () => {
  const { report, observations, events, candidate } = await run([
    { type: "read", input: { path: "median.mjs" } }, write, check,
  ]);
  assert.equal(report.status, "passed");
  assert.equal(report.baseline?.tests, 8);
  assert.ok((report.baseline?.failures ?? 0) > 0);
  assert.equal(report.candidate?.passes, 8);
  assert.equal(report.modelCalls, 3);
  assert.deepEqual(report.changedFiles, ["median.mjs"]);
  assert.equal(candidate["median.mjs"], repaired);
  assert.ok(observations.every((value) => !value.includes("acceptance.test.mjs")));
  assert.ok(observations[2]?.includes("history"));
  assert.match(events, /REPAIR_BASELINE/);
  assert.match(events, /REPAIR_COMPLETED/);
  const logged = events.trim().split("\n").map((line) => JSON.parse(line) as {
    type: string; payload: { observation?: { content: { history: unknown[] } } };
  }).filter((event) => event.type === "REPAIR_TURN");
  assert.deepEqual(logged.map((event) => event.payload.observation?.content.history.length), [0, 1, 2]);
});

test("test tampering and arbitrary execution cannot turn a broken program into success", async () => {
  const { report, events } = await run([
    { type: "write", input: { path: "acceptance.test.mjs", content: "process.exit(0)" } },
    { type: "write", input: { path: "visible.test.mjs", content: "process.exit(0)" } },
    { type: "test", input: { command: process.execPath, args: ["-e", "process.exit(0)"] } },
    { type: "exec", input: { command: process.execPath, args: ["-e", "process.exit(0)"] } },
  ]);
  assert.equal(report.status, "failed");
  assert.deepEqual(report.changedFiles, []);
  assert.ok((report.candidate?.failures ?? 0) > 0);
  assert.match(events, /tests are immutable/);
  assert.match(events, /command is fixed/);
});

test("passing visible tests is not sufficient for private acceptance", async () => {
  const partial = "export function median(values) { values.sort(); const m = Math.floor(values.length/2); return values.length%2 ? values[m] : (values[m-1]+values[m])/2; }";
  const { report } = await run([{ type: "write", input: { path: "median.mjs", content: partial } }, check]);
  assert.equal(report.stopReason, "visible-tests-passed");
  assert.equal(report.status, "failed");
  assert.ok((report.candidate?.failures ?? 0) > 0);
});

test("turn budget is enforced even when the agent makes no useful change", async () => {
  const { report } = await run([{ type: "search", input: { query: "median" } }]);
  assert.equal(report.modelCalls, 1);
  assert.equal(report.stopReason, "turn-budget-exhausted");
  assert.equal(report.status, "failed");
});

test("provider failure preserves partial report and does not persist remote error bodies", async () => {
  const root = await mkdtemp(join(tmpdir(), "repair-error-test-"));
  try {
    const report = await runRepairExperiment({ task, evaluator: fixtureEvaluator,
      provider: { think: async () => { throw new Error("remote-body-secret-123"); } },
      model: "failure-fixture", outputRoot: root, sourceCommit: "test" });
    assert.equal(report.status, "error");
    assert.equal(report.modelCalls, 1);
    assert.ok(report.baseline);
    assert.doesNotMatch(await readFile(join(report.outputDirectory, "events.jsonl"), "utf8"), /remote-body-secret/);
    assert.ok(await readFile(join(report.outputDirectory, "checksums.json"), "utf8"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects an already passing baseline before spending model calls", async () => {
  const root = await mkdtemp(join(tmpdir(), "repair-baseline-test-"));
  try {
    const report = await runRepairExperiment({ task: { ...task, files: { "median.mjs": repaired } }, evaluator: fixtureEvaluator,
      provider: { think: async () => { assert.fail("must not call model"); } },
      model: "fixture", outputRoot: root, sourceCommit: "test" });
    assert.equal(report.status, "error");
    assert.equal(report.modelCalls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("task validation rejects traversal, platform aliases, test/source collisions and undeclared writes", () => {
  assertRepairTask(task);
  for (const path of ["../escape.mjs", "C:/escape.mjs", "dir\\escape.mjs", "NUL.mjs", "median.mjs:stream"]) {
    assert.throws(() => assertRepairTask({ ...task, files: { [path]: "" }, editableFiles: [path] }));
  }
  assert.throws(() => assertRepairTask({ ...task, editableFiles: ["acceptance.test.mjs"] }));
  assert.throws(() => assertRepairTask({ ...task, visibleTests: { "median.mjs": "" } }));
});

test("repair CLI exposes its command and validates bad task input without model calls", async () => {
  let help = "";
  assert.equal(await executeCommand(runRepairCommand, ["--help"], { out: (s) => { help += s; }, err: () => {} }), 0);
  assert.match(help, /run-repair/);
  assert.match(help, /HARNESS_EXTERNAL_MODEL_URL/);
  assert.equal(await executeCommand(runRepairCommand, ["--task", "examples/repair/median.json", "--max-turns", "0"], { out: () => {}, err: () => {} }), 1);
});

test("Docker isolation executes a repair and fixed acceptance end to end", { skip: process.env.HARNESS_TEST_DOCKER !== "1" }, async () => {
  const evaluator = new DockerRepairEvaluator(await resolveRepairImage("node:24-alpine"));
  const { report } = await run([write, check], evaluator);
  assert.equal(report.status, "passed");
  assert.equal(report.candidate?.passes, 8);
});

test("Docker evaluator fails closed on timeout", { skip: process.env.HARNESS_TEST_DOCKER !== "1" }, async () => {
  const evaluator = new DockerRepairEvaluator(await resolveRepairImage("node:24-alpine"), 3000);
  const result = await evaluator.evaluate({ "hang.test.mjs": "while (true) {}" }, ["hang.test.mjs"]);
  assert.equal(result.passed, false);
  assert.equal(result.timedOut, true);
});
