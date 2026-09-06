import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CONTRACT_SCHEMA_VERSION, type AgentState } from "../src/contracts/index.js";
import { EnergyLedger } from "../src/energy/ledger.js";
import { PopulationController } from "../src/lifecycle/population.js";
import { SharedSlmQueue } from "../src/scheduler/shared-slm-queue.js";

function agent(agentId: string, lifecycle: AgentState["lifecycle"] = "ACTIVE"): AgentState {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentId,
    generation: 0,
    lifecycle,
    energy: 10,
    genomeId: `genome-${agentId}`,
  };
}

test("population controller enforces lifecycle transitions and archives verified plugins", async () => {
  const root = await mkdtemp(join(tmpdir(), "population-"));
  try {
    const controller = new PopulationController(
      new EnergyLedger({
        initialEnergy: 10,
        debitByReason: { maintenance: 1 },
        rewardByReason: {},
      }),
      join(root, "archive"),
    );
    controller.register(agent("agent-001"), []);
    assert.equal(controller.transition("agent-001", "DORMANT").lifecycle, "DORMANT");
    assert.equal(controller.transition("agent-001", "ACTIVE").lifecycle, "ACTIVE");
    assert.throws(
      () => controller.transition("agent-001", "ACTIVE"),
      /invalid lifecycle transition/,
    );
    controller.transition("agent-001", "DEAD");
    const archive = await controller.archiveDead("agent-001");
    assert.match(await readFile(join(archive, "legacy.json"), "utf8"), /agent-001/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("maintenance kills an agent when the debit exceeds its balance", () => {
  const controller = new PopulationController(
    new EnergyLedger({
      initialEnergy: 2,
      debitByReason: { maintenance: 5 },
      rewardByReason: {},
    }),
    "archive",
  );
  controller.register(agent("agent-002"));
  assert.equal(controller.maintain("agent-002").lifecycle, "DEAD");
});

test("shared SLM queue is fair, serial, and reports timeout failures", async () => {
  const queue = new SharedSlmQueue();
  const order: string[] = [];
  const first = queue.enqueue({
    agentId: "agent-001",
    execute: async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("first-end");
      return "one";
    },
  });
  const second = queue.enqueue({
    agentId: "agent-002",
    execute: async () => {
      order.push("second");
      return "two";
    },
  });
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one.value, "one");
  assert.equal(two.value, "two");
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
  await assert.rejects(
    () =>
      queue.enqueue({
        agentId: "agent-003",
        timeoutMs: 1,
        execute: async () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 20)),
      }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "reason" in error &&
      error.reason === "queue request timed out",
  );
});
