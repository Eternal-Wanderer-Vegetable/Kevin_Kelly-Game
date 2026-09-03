import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAgentState,
  assertGenomeManifest,
  assertTaskSpec,
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
