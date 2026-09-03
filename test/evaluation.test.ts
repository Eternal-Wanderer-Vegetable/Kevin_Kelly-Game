import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEnergyTransaction,
  CONTRACT_SCHEMA_VERSION,
  type EnergyTransaction,
  type TaskSpec,
} from "../src/contracts/index.js";
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
import { assertUsageRecord } from "../src/contracts/index.js";
import { ResourceMeter } from "../src/resources/resource-meter.js";
import {
  EnergyLedger,
  energyTransactionEvent,
  replayEnergyEvents,
} from "../src/energy/ledger.js";
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

test("resource meter records wall time, controller resources, and model counts", async () => {
  const meter = new ResourceMeter({
    agentId: "agent-meter",
    usageId: "usage-meter",
    localModelCalls: 2,
    externalModelCalls: 1,
  });
  const usage = meter.finish();

  assert.doesNotThrow(() => assertUsageRecord(usage));
  assert.equal(usage.usageId, "usage-meter");
  assert.equal(usage.localModelCalls, 2);
  assert.equal(usage.externalModelCalls, 1);
  assert.ok(usage.wallTimeMs >= 0);
  assert.ok(usage.memoryPeakBytes > 0);
  assert.throws(
    () => new ResourceMeter({ agentId: "agent-meter", localModelCalls: -1 }),
    /localModelCalls must be/,
  );
});

test("energy ledger applies policy transactions and replays their events", () => {
  const policy = {
    initialEnergy: 10,
    debitByReason: { tool: 3 },
    rewardByReason: { success: 5 },
  };
  const ledger = new EnergyLedger(policy);
  assert.equal(ledger.initialize("agent-energy"), 10);
  const debit = ledger.debit("agent-energy", "tool");
  const reward = ledger.reward("agent-energy", "success");
  assert.equal(debit.balanceAfter, 7);
  assert.equal(reward.balanceAfter, 12);

  const replayed = replayEnergyEvents(
    [
      energyTransactionEvent("run-energy", debit),
      energyTransactionEvent("run-energy", reward),
    ],
    policy,
  );
  assert.equal(replayed.balanceOf("agent-energy"), 12);
});

test("energy transactions reject invalid values and inconsistent transitions", () => {
  const transaction: EnergyTransaction = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    transactionId: "energy-invalid",
    agentId: "agent-energy",
    kind: "DEBIT",
    amount: 3,
    reason: "tool",
    balanceBefore: 10,
    balanceAfter: 7,
  };
  assert.doesNotThrow(() => assertEnergyTransaction(transaction));
  assert.throws(
    () => assertEnergyTransaction({ ...transaction, kind: "INVALID" }),
    /kind is invalid/,
  );
  assert.throws(
    () => assertEnergyTransaction({ ...transaction, amount: -1 }),
    /amount must be non-negative/,
  );
  assert.throws(
    () => assertEnergyTransaction({ ...transaction, balanceBefore: -1 }),
    /balanceBefore must be non-negative/,
  );

  const ledger = new EnergyLedger({
    initialEnergy: 10,
    debitByReason: { tool: 3 },
    rewardByReason: {},
  });
  assert.throws(
    () =>
      ledger.applyTransaction({
        ...transaction,
        balanceAfter: 99,
      }),
    /transition is invalid/,
  );
});

test("energy debit is bounded at zero and unknown reasons are free", () => {
  const ledger = new EnergyLedger({
    initialEnergy: 2,
    debitByReason: { expensive: 10 },
    rewardByReason: {},
  });
  const debit = ledger.debit("agent-bounded", "expensive");
  const free = ledger.debit("agent-bounded", "unknown");

  assert.equal(debit.balanceAfter, 0);
  assert.equal(free.amount, 0);
  assert.equal(free.balanceAfter, 0);
});
