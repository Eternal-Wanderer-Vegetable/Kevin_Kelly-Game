import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  hashDirectory,
  hashGenomeManifest,
  GenomeRevisionStore,
  writeGenomeManifest,
} from "../src/genome/revision-store.js";
import {
  loadPlugin,
  loadPolicy,
  loadWorkflow,
  validateDependencyGraph,
} from "../src/genome/loader.js";
import { CONTRACT_SCHEMA_VERSION } from "../src/contracts/index.js";

test("loaders validate and load plugin, workflow, and policy assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "genome-loader-"));
  try {
    const pluginPath = join(root, "plugin.js");
    const pluginSource = "export const name = 'fixture-plugin';\n";
    await writeFile(pluginPath, pluginSource, "utf8");
    const pluginHash = `sha256:${createHash("sha256").update(pluginSource).digest("hex")}`;
    await writeFile(
      join(root, "plugin.json"),
      JSON.stringify({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        pluginId: "plugin.fixture",
        name: "Fixture Plugin",
        version: "1.0.0",
        entrypoint: "plugin.js",
        dependencies: [],
        pluginHash,
      }),
      "utf8",
    );
    await writeFile(
      join(root, "workflow.json"),
      JSON.stringify({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        workflowId: "workflow.fixture",
        name: "Fixture Workflow",
        version: "1.0.0",
        steps: ["plugin.fixture"],
        dependencies: ["plugin.fixture"],
      }),
      "utf8",
    );
    await writeFile(
      join(root, "policy.json"),
      JSON.stringify({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
      policyId: "policy.fixture",
        name: "Fixture Policy",
        version: "1.0.0",
        rules: { verification: "always" },
      }),
      "utf8",
    );

    const plugin = await loadPlugin(root, "plugin.json");
    const workflow = await loadWorkflow(root, "workflow.json");
    const policy = await loadPolicy(root, "policy.json");
    assert.equal(plugin.module.name, "fixture-plugin");
    assert.equal(workflow.steps[0], "plugin.fixture");
    assert.equal(policy.rules.verification, "always");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loaders reject hash mismatch, forbidden dependencies, and unsafe paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "genome-loader-"));
  try {
    await writeFile(join(root, "plugin.js"), "export const ok = true;\n", "utf8");
    await writeFile(
      join(root, "plugin.json"),
      JSON.stringify({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        pluginId: "plugin.fixture",
        name: "Fixture Plugin",
        version: "1.0.0",
        entrypoint: "plugin.js",
        dependencies: ["core/agent-core"],
        pluginHash: "sha256:wrong",
      }),
      "utf8",
    );
    await assert.rejects(
      () => loadPlugin(root, "plugin.json"),
      /forbidden genome dependency/,
    );

    await writeFile(
      join(root, "workflow.json"),
      JSON.stringify({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        workflowId: "workflow.fixture",
        name: "Fixture Workflow",
        version: "1.0.0",
        steps: [],
        dependencies: ["sandbox/runner"],
      }),
      "utf8",
    );
    await assert.rejects(
      () => loadWorkflow(root, "workflow.json"),
      /forbidden genome dependency/,
    );
    await writeFile(
      join(root, "plugin.json"),
      JSON.stringify({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        pluginId: "plugin.fixture",
        name: "Fixture Plugin",
        version: "1.0.0",
        entrypoint: "../plugin.js",
        dependencies: [],
        pluginHash: "sha256:wrong",
      }),
      "utf8",
    );
    await assert.rejects(
      () => loadPlugin(root, "plugin.json"),
      /escapes genome root/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dependency graph rejects missing nodes and cycles", () => {
  assert.throws(
    () => validateDependencyGraph({ a: ["missing"] }),
    /missing genome dependency/,
  );
  assert.throws(
    () => validateDependencyGraph({ a: ["b"], b: ["a"] }),
    /cyclic genome dependency/,
  );
});

test("genome revisions can be cloned, hash-checked, and rolled back", async () => {
  const root = await mkdtemp(join(tmpdir(), "genome-store-"));
  const source = await mkdtemp(join(tmpdir(), "genome-source-"));
  try {
    await mkdir(join(source, "plugins"), { recursive: true });
    const base = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      agentId: "agent-001",
      parentId: null,
      generation: 0,
      plugins: [],
      workflows: [],
      policies: [],
      dependencies: [],
      coreHash: "core-v1",
    } as const;
    const first = {
      ...base,
      genomeId: "genome-001",
      genomeHash: "sha256:pending",
    };
    await writeGenomeManifest(source, first);
    const sourceHash = await hashDirectory(source);
    const firstManifest = { ...first, genomeHash: sourceHash };
    await writeGenomeManifest(source, firstManifest);

    const store = new GenomeRevisionStore(root);
    const revision1 = await store.create(firstManifest, source);
    const second = {
      ...firstManifest,
      genomeId: "genome-002",
      generation: 1,
    };
    const revision2 = await store.clone("genome-001", second);

    assert.notEqual(revision1.revisionId, revision2.revisionId);
    assert.equal(
      (await store.rollback("agent-001", revision1.revisionId)).manifest.genomeId,
      "genome-001",
    );
    await assert.rejects(
      () => store.create({ ...firstManifest, genomeHash: "sha256:wrong" }, source),
      /genome hash mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});
