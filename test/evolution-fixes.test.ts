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
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CONTRACT_SCHEMA_VERSION,
  type AgentState,
  type GenomeManifest,
  type PolicyDocument,
  type WorkflowManifest,
} from "../src/contracts/index.js";
import { EnergyLedger } from "../src/energy/ledger.js";
import { PopulationController } from "../src/lifecycle/population.js";
import { EcologicalMemoryIndex } from "../src/lifecycle/ecological-memory.js";
import { SharedSlmQueue } from "../src/scheduler/shared-slm-queue.js";
import { TieredCognitionProvider } from "../src/providers/tiered-cognition.js";
import { derivePolicyConfig, workflowGuidance } from "../src/evolution/genome-runtime.js";
import { applyPluginTools } from "../src/evolution/plugin-runtime.js";
import { MutationPlanner } from "../src/evolution/mutation-planner.js";
import { ToolRegistry } from "../src/environment/tool-registry.js";
import { MockCognitionProvider } from "../src/providers/mock-cognition.js";
import { computeFitness } from "../src/evaluation/fitness.js";
import { TaskPool } from "../src/tasks/task-pool.js";
import type { EvaluationResult } from "../src/contracts/index.js";
import type { CognitionProvider } from "../src/core/agent-core.js";

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

function manifest(overrides: Partial<GenomeManifest> = {}): GenomeManifest {
  return {
    schemaVersion: 1,
    genomeId: "genome-1",
    agentId: "agent-1",
    parentId: null,
    generation: 0,
    plugins: ["plugins/a.json"],
    workflows: [],
    policies: [],
    dependencies: [],
    coreHash: "sha256:core",
    genomeHash: "sha256:hash",
    ...overrides,
  };
}

function evaluation(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    schemaVersion: 1,
    evaluationId: "evaluation-1",
    taskId: "task-1",
    agentId: "agent-1",
    taskSuccess: true,
    testPassRate: 1,
    regressionRate: 0,
    runtimeMs: 10,
    resourceConsumption: {
      schemaVersion: 1,
      usageId: "usage-1",
      agentId: "agent-1",
      wallTimeMs: 10,
      cpuTimeMs: 5,
      memoryPeakBytes: 1024,
      localModelCalls: 1,
      externalModelCalls: 0,
    },
    stability: 1,
    ...overrides,
  };
}

// --- ISSUE-09: dormant differential maintenance ---

test("dormant agents pay the dormant maintenance rate, not the active rate", () => {
  const ledger = new EnergyLedger({
    initialEnergy: 10,
    debitByReason: { maintenance: 5, "dormant-maintenance": 1 },
    rewardByReason: {},
  });
  const controller = new PopulationController(ledger, "archive");
  controller.register(agent("agent-d"));
  controller.transition("agent-d", "DORMANT");
  controller.maintain("agent-d");
  assert.equal(ledger.balanceOf("agent-d"), 9);
});

test("an active agent survives by going dormant when it cannot afford upkeep", () => {
  const ledger = new EnergyLedger({
    initialEnergy: 3,
    debitByReason: { maintenance: 5, "dormant-maintenance": 0 },
    rewardByReason: {},
  });
  const controller = new PopulationController(ledger, "archive");
  controller.register(agent("agent-d"));
  controller.transition("agent-d", "DORMANT");
  assert.equal(controller.maintain("agent-d").lifecycle, "DORMANT");
});

// --- ISSUE-08: queue priority + per-agent stats ---

test("shared queue runs higher priority first and aggregates per-agent stats", async () => {
  const queue = new SharedSlmQueue();
  const order: string[] = [];
  const slow = queue.enqueue({
    agentId: "agent-low",
    execute: async () => {
      order.push("low");
      await new Promise((r) => setTimeout(r, 5));
      return "low";
    },
  });
  const high = queue.enqueue({
    agentId: "agent-high",
    priority: 10,
    execute: async () => {
      order.push("high");
      return "high";
    },
  });
  const mid = queue.enqueue({
    agentId: "agent-mid",
    priority: 5,
    execute: async () => {
      order.push("mid");
      return "mid";
    },
  });
  await Promise.all([slow, high, mid]);
  assert.deepEqual(order, ["low", "high", "mid"]); // low was already running; high beats mid
  const stats = queue.statsByAgent();
  const highStats = stats.find((s) => s.agentId === "agent-high");
  assert.equal(highStats?.completed, 1);
  assert.equal(highStats?.enqueued, 1);
  assert.equal(stats.length, 3);
});

// --- ISSUE-02: policy/workflow runtime ---

test("derivePolicyConfig recognises known rules and preserves unknown ones", () => {
  const policy: PolicyDocument = {
    schemaVersion: 1,
    policyId: "p1",
    name: "p",
    version: "0.1.0",
    rules: {
      "cognition.escalateToExternal": true,
      "cognition.externalAfterFailures": 2,
      "lifecycle.dormantBelowEnergy": 5,
      "reproduction.cloneAboveEnergy": 100,
      "resource.queuePriority": 3,
      "custom.futureRule": "kept",
    },
  };
  const config = derivePolicyConfig([policy]);
  assert.equal(config.escalateToExternal, true);
  assert.equal(config.externalAfterFailures, 2);
  assert.equal(config.dormantBelowEnergy, 5);
  assert.equal(config.cloneAboveEnergy, 100);
  assert.equal(config.queuePriority, 3);
  assert.deepEqual(config.rules, { "custom.futureRule": "kept" });
});

test("workflowGuidance flattens steps from all workflows", () => {
  const workflows: WorkflowManifest[] = [
    {
      schemaVersion: 1,
      workflowId: "w1",
      name: "a",
      version: "0.1.0",
      steps: ["read", "write"],
      dependencies: [],
    },
    {
      schemaVersion: 1,
      workflowId: "w2",
      name: "b",
      version: "0.1.0",
      steps: ["test"],
      dependencies: [],
    },
  ];
  assert.deepEqual(workflowGuidance(workflows), ["read", "write", "test"]);
});

// --- ISSUE-03: plugin tools register into the registry ---

test("applyPluginTools registers plugin tools and rejects empty plugins", async () => {
  const registry = new ToolRegistry();
  registry.register("read", async () => ({ ok: true, output: {} }));
  const registered = applyPluginTools(registry, {
    manifest: {
      schemaVersion: 1,
      pluginId: "p1",
      name: "p",
      version: "0.1.0",
      entrypoint: "x.mjs",
      dependencies: [],
      pluginHash: "sha256:x",
    },
    module: {
      tools: {
        "word-count": async () => ({ ok: true, output: { words: 3 } }),
      },
    },
  });
  assert.deepEqual(registered, ["word-count"]);
  const result = await registry.invoke({ name: "word-count", input: {} });
  assert.equal(result.ok, true);
  assert.throws(() =>
    applyPluginTools(registry, {
      manifest: {
        schemaVersion: 1,
        pluginId: "p2",
        name: "p",
        version: "0.1.0",
        entrypoint: "x.mjs",
        dependencies: [],
        pluginHash: "sha256:x",
      },
      module: {},
    }),
    /exposes no register\(\) or tools/,
  );
});

// --- ISSUE-04: tiered cognition ---

test("tiered provider escalates after the configured number of local failures", async () => {
  const failing: CognitionProvider = {
    think: async () => {
      throw new Error("local down");
    },
  };
  const external = new MockCognitionProvider({ type: "read", input: {} });
  const tiered = new TieredCognitionProvider(failing, external, {
    externalAfterFailures: 2,
    rules: {},
  });
  const request = {
    agentId: "a",
    observation: { kind: "k", content: {} },
  };
  await assert.rejects(() => tiered.think(request));
  const action = await tiered.think(request); // second failure escalates
  assert.equal(action.type, "read");
  assert.deepEqual(tiered.stats(), {
    localCalls: 2,
    externalCalls: 1,
    escalations: 1,
  });
});

test("tiered provider honours an escalate action from local", async () => {
  const local = new MockCognitionProvider({ type: "escalate", input: {} });
  const external = new MockCognitionProvider({ type: "write", input: {} });
  const tiered = new TieredCognitionProvider(local, external, { rules: {} });
  const action = await tiered.think({
    agentId: "a",
    observation: { kind: "k", content: {} },
  });
  assert.equal(action.type, "write");
  assert.equal(tiered.stats().escalations, 1);
});

// --- ISSUE-06: ecological memory ---

test("ecological memory index records deaths and exposes inheritable plugins", async () => {
  const root = await mkdtemp(join(tmpdir(), "ecology-"));
  try {
    const index = new EcologicalMemoryIndex(join(root, "ecology-index.jsonl"));
    const controller = new PopulationController(
      new EnergyLedger({
        initialEnergy: 10,
        debitByReason: {},
        rewardByReason: {},
      }),
      join(root, "archive"),
      index,
    );
    const plugin = {
      schemaVersion: 1 as const,
      pluginId: "plugin-legacy",
      name: "legacy",
      version: "0.1.0",
      entrypoint: "x.mjs",
      dependencies: [],
      pluginHash: "sha256:x",
    };
    controller.register(agent("agent-dead"), [plugin]);
    controller.transition("agent-dead", "DEAD");
    await controller.archiveDead("agent-dead");
    assert.equal(index.all().length, 1);
    assert.equal(index.inheritablePlugins()[0]?.pluginId, "plugin-legacy");
    const line = await readFile(join(root, "ecology-index.jsonl"), "utf8");
    assert.match(line, /agent-dead/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- ISSUE-07: task pool ---

test("task pool enforces single claim and releases a dead agent's work", () => {
  const pool = new TaskPool();
  const task = {
    schemaVersion: 1 as const,
    taskId: "t1",
    level: 1 as const,
    title: "t",
    repository: { source: "s", commit: "c" },
    allowedCommands: ["node"],
    acceptanceCriteria: [],
    baselineTestCommand: "node test.mjs",
  };
  pool.register(task);
  pool.claim("agent-a", "t1");
  assert.throws(() => pool.claim("agent-b", "t1"), /claimed by another agent/);
  assert.deepEqual(pool.releaseAgent("agent-a"), ["t1"]);
  pool.claim("agent-b", "t1");
  pool.complete("t1");
  assert.throws(() => pool.claim("agent-a", "t1"), /already completed/);
});

// --- ISSUE-11: mutation planner ---

test("mutation planner validates model output against the whitelist", async () => {
  const planner = new MutationPlanner(
    new MockCognitionProvider({
      type: "mutations",
      input: {
        mutations: [
          { kind: "add-plugin", plugin: "plugins/new.json" },
          { kind: "delete-plugin", plugin: "plugins/a.json" },
          { kind: "delete-plugin", plugin: "plugins/missing.json" }, // filtered
          { kind: "hack-the-judge" }, // filtered
        ],
      },
    }),
  );
  const plan = await planner.planMutations({
    agentId: "a",
    manifest: manifest(),
    recentFailures: [],
    recentSuccesses: [],
    energyBalance: 100,
  });
  assert.deepEqual(plan, [
    { kind: "add-plugin", plugin: "plugins/new.json" },
    { kind: "delete-plugin", plugin: "plugins/a.json" },
  ]);
});

test("mutation planner returns an empty plan on garbage output", async () => {
  const planner = new MutationPlanner(
    new MockCognitionProvider({ type: "read", input: {} }),
  );
  const plan = await planner.planMutations({
    agentId: "a",
    manifest: manifest(),
    recentFailures: [],
    recentSuccesses: [],
    energyBalance: 0,
  });
  assert.deepEqual(plan, []);
});

// --- ISSUE-12: composite fitness ---

test("computeFitness weights success, stability and human acceptance", () => {
  const good = computeFitness(evaluation({ humanAcceptance: "accept" }));
  const bad = computeFitness(
    evaluation({ taskSuccess: false, testPassRate: 0, regressionRate: 1, stability: 0 }),
  );
  assert.ok(good.value > bad.value);
  assert.equal(bad.value, 0);
  assert.ok(good.value <= 1);
});
