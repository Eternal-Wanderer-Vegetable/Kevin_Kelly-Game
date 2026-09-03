import assert from "node:assert/strict";
import test from "node:test";
import { CONTRACT_SCHEMA_VERSION, type TaskSpec } from "../src/contracts/index.js";
import { IndependentEvaluator } from "../src/evaluation/evaluator.js";
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
