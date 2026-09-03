import assert from "node:assert/strict";
import test from "node:test";
import { CONTRACT_SCHEMA_VERSION, type TaskSpec } from "../src/contracts/index.js";
import {
  IndependentEvaluator,
  recordHumanAcceptance,
} from "../src/evaluation/evaluator.js";
import {
  freezeBaseHarness,
  readBaseHarness,
  type BaseHarnessSnapshot,
} from "../src/evaluation/base-harness.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTask } from "../src/tasks/task-runner.js";

const task: TaskSpec = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  taskId: "task-evaluation",
  level: 1,
  title: "Evaluate a task",
  repository: { source: "fixture", commit: "fixture" },
  allowedCommands: [process.execPath],
  acceptanceCriteria: ["the command succeeds"],
  baselineTestCommand: `"${process.execPath}" -e "process.exit(0)"`,
};

test("independent evaluator computes a successful task result", async () => {
  const candidate = await runTask(task);
  const result = new IndependentEvaluator().evaluate({
    task,
    agentId: "agent-001",
    candidate,
    evaluationId: "evaluation-001",
  });

  assert.equal(result.evaluationId, "evaluation-001");
  assert.equal(result.taskSuccess, true);
  assert.equal(result.testPassRate, 1);
  assert.equal(result.regressionRate, 0);
  assert.equal(result.stability, 1);
  assert.equal(result.resourceConsumption.agentId, "agent-001");
});

test("independent evaluator marks a candidate regression", async () => {
  const baseline = await runTask(task);
  const candidate = await runTask(task, {
    command: {
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
    },
  });
  const result = new IndependentEvaluator().evaluate({
    task,
    agentId: "agent-002",
    baseline,
    candidate,
  });

  assert.equal(result.taskSuccess, false);
  assert.equal(result.testPassRate, 0);
  assert.equal(result.regressionRate, 1);
  assert.equal(result.stability, 1);
});

test("human acceptance is recorded without changing automatic evaluation metrics", async () => {
  const candidate = await runTask(task);
  const evaluation = new IndependentEvaluator().evaluate({
    task,
    agentId: "agent-003",
    candidate,
    evaluationId: "evaluation-human",
  });

  const annotated = recordHumanAcceptance(evaluation, "accept");

  assert.equal(annotated.humanAcceptance, "accept");
  assert.equal(annotated.taskSuccess, evaluation.taskSuccess);
  assert.equal(annotated.testPassRate, evaluation.testPassRate);
  assert.equal("humanAcceptance" in evaluation, false);
});

test("human acceptance supports numeric ratings and rejects invalid runtime input", async () => {
  const candidate = await runTask(task);
  const evaluation = new IndependentEvaluator().evaluate({
    task,
    agentId: "agent-004",
    candidate,
  });

  assert.equal(recordHumanAcceptance(evaluation, 4).humanAcceptance, 4);
  assert.throws(
    () => recordHumanAcceptance(evaluation, 6 as never),
    /humanAcceptance must be/,
  );
});

test("base harness can be frozen, read back, and never overwritten", async () => {
  const directory = await mkdtemp(join(tmpdir(), "base-harness-"));
  try {
    const candidate = await runTask(task);
    const evaluation = new IndependentEvaluator().evaluate({
      task,
      agentId: "base-agent",
      candidate,
      evaluationId: "base-evaluation",
    });
    const snapshot: BaseHarnessSnapshot = {
      schemaVersion: 1,
      harnessId: "base-harness",
      coreHash: "core-v0",
      task,
      evaluation,
    };
    const filePath = join(directory, "snapshot.json");

    await freezeBaseHarness(filePath, snapshot);
    assert.deepEqual(await readBaseHarness(filePath), snapshot);
    await assert.rejects(
      () => freezeBaseHarness(filePath, snapshot),
      /already exists/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
