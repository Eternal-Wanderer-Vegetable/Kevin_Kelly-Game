import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAgentState,
  assertEvaluationResult,
  assertGenomeManifest,
  assertPluginManifest,
  assertTaskSpec,
  assertUsageRecord,
  CONTRACT_SCHEMA_VERSION,
} from "../src/contracts/index.js";

test("accepts a valid Level 1 task contract", () => {
  const task = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    taskId: "task-001",
    level: 1,
    title: "Fix a local bug",
    repository: { source: "fixture", commit: "abc123" },
    allowedCommands: ["test"],
    acceptanceCriteria: ["tests pass"],
    baselineTestCommand: "npm test",
  };

  assert.doesNotThrow(() => assertTaskSpec(task));
});

test("rejects unknown fields to protect control-plane contracts", () => {
  const task = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    taskId: "task-001",
    level: 1,
    title: "Fix a local bug",
    repository: { source: "fixture", commit: "abc123" },
    allowedCommands: ["test"],
    acceptanceCriteria: ["tests pass"],
    baselineTestCommand: "npm test",
    evaluatorOverride: true,
  };

  assert.throws(() => assertTaskSpec(task), /unknown or missing fields/);
});

test("validates genome lineage and lifecycle state", () => {
  assert.doesNotThrow(() =>
    assertGenomeManifest({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      genomeId: "genome-002",
      agentId: "agent-002",
      parentId: "agent-001",
      generation: 1,
      plugins: ["plugin.search"],
      workflows: ["workflow.verify"],
      policies: ["policy.local-first"],
      dependencies: [],
      coreHash: "core-hash",
      genomeHash: "genome-hash",
    }),
  );

  assert.doesNotThrow(() =>
    assertAgentState({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      agentId: "agent-002",
      generation: 1,
      lifecycle: "ACTIVE",
      energy: 10,
      genomeId: "genome-002",
    }),
  );
});

test("validates a plugin manifest", () => {
  assert.doesNotThrow(() =>
    assertPluginManifest({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      pluginId: "plugin.search",
      name: "Search Plugin",
      version: "1.0.0",
      entrypoint: "src/index.ts",
      dependencies: [],
      pluginHash: "sha256:plugin",
    }),
  );

  assert.throws(
    () =>
      assertPluginManifest({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        pluginId: "plugin.search",
        name: "Search Plugin",
        version: "1.0.0",
        entrypoint: "src/index.ts",
        dependencies: [],
        pluginHash: "sha256:plugin",
        mutableCoreDependency: true,
      }),
    /unknown or missing fields/,
  );
});

test("rejects unsupported schema versions and invalid lifecycle values", () => {
  assert.throws(
    () =>
      assertAgentState({
        schemaVersion: 2,
        agentId: "agent-001",
        generation: 0,
        lifecycle: "ACTIVE",
        energy: 10,
        genomeId: "genome-001",
      }),
    /schemaVersion is unsupported/,
  );

  assert.throws(
    () =>
      assertAgentState({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        agentId: "agent-001",
        generation: 0,
        lifecycle: "UNKNOWN",
        energy: 10,
        genomeId: "genome-001",
      }),
    /lifecycle is invalid/,
  );
});

test("validates usage and independent evaluation contracts", () => {
  const usage = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    usageId: "usage-001",
    agentId: "agent-001",
    wallTimeMs: 10,
    cpuTimeMs: 2,
    memoryPeakBytes: 1024,
    localModelCalls: 1,
    externalModelCalls: 0,
  };
  assert.doesNotThrow(() => assertUsageRecord(usage));
  assert.doesNotThrow(() =>
    assertEvaluationResult({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      evaluationId: "evaluation-001",
      taskId: "task-001",
      agentId: "agent-001",
      taskSuccess: true,
      testPassRate: 1,
      regressionRate: 0,
      runtimeMs: 10,
      resourceConsumption: usage,
      stability: 1,
      humanAcceptance: 5,
    }),
  );
});

test("rejects invalid evaluation metrics", () => {
  assert.throws(
    () =>
      assertEvaluationResult({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        evaluationId: "evaluation-001",
        taskId: "task-001",
        agentId: "agent-001",
        taskSuccess: true,
        testPassRate: 1.1,
        regressionRate: 0,
        runtimeMs: 10,
        resourceConsumption: {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          usageId: "usage-001",
          agentId: "agent-001",
          wallTimeMs: 10,
          cpuTimeMs: 2,
          memoryPeakBytes: 1024,
          localModelCalls: 1,
          externalModelCalls: 0,
        },
        stability: 1,
      }),
    /between 0 and 1/,
  );
});
