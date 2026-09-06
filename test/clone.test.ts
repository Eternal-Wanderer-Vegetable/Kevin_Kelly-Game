import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyMutations,
  CloneEmbryoService,
  type GenomeMutation,
} from "../src/evolution/clone.js";
import { CONTRACT_SCHEMA_VERSION, type GenomeManifest } from "../src/contracts/index.js";
import { EnergyLedger } from "../src/energy/ledger.js";
import { hashDirectory, GenomeRevisionStore, writeGenomeManifest } from "../src/genome/revision-store.js";

async function makeGenome(
  directory: string,
  genomeId: string,
  agentId: string,
  parentId: string | null,
  generation: number,
): Promise<GenomeManifest> {
  await mkdir(join(directory, "plugins"), { recursive: true });
  const manifest: GenomeManifest = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    genomeId,
    agentId,
    parentId,
    generation,
    plugins: [],
    workflows: [],
    policies: [],
    dependencies: [],
    coreHash: "core-v1",
    genomeHash: "sha256:pending",
  };
  await writeGenomeManifest(directory, manifest);
  const genomeHash = await hashDirectory(directory);
  const completed = { ...manifest, genomeHash };
  await writeGenomeManifest(directory, completed);
  return completed;
}

test("mutations retain lineage and do not modify the parent manifest", () => {
  const parent: GenomeManifest = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    genomeId: "genome-parent",
    agentId: "agent-parent",
    parentId: null,
    generation: 0,
    plugins: ["plugins/base.json"],
    workflows: [],
    policies: [],
    dependencies: [],
    coreHash: "core-v1",
    genomeHash: "sha256:parent",
  };
  const mutations: GenomeMutation[] = [
    { kind: "add-plugin", plugin: "plugins/new.json" },
    { kind: "create-tool", tool: "search-code" },
  ];
  const records: import("../src/evolution/clone.js").MutationRecord[] = [];
  const child = applyMutations(
    { ...parent, genomeId: "genome-child", agentId: "agent-child", parentId: parent.genomeId },
    parent.genomeId,
    mutations,
    records,
  );

  assert.deepEqual(parent.plugins, ["plugins/base.json"]);
  assert.deepEqual(child.plugins, ["plugins/base.json", "plugins/new.json"]);
  assert.deepEqual(child.dependencies, ["tool:search-code"]);
  assert.equal(records.length, 2);
  assert.equal(records[0]?.parentGenomeId, "genome-parent");
  assert.equal(records[0]?.childGenomeId, "genome-child");
});

test("successful clone qualifies an embryo and activates the child only after checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "clone-"));
  const source = await mkdtemp(join(tmpdir(), "clone-source-"));
  try {
    const parentManifest = await makeGenome(
      source,
      "genome-parent",
      "agent-parent",
      null,
      0,
    );
    const revisions = new GenomeRevisionStore(join(root, "revisions"));
    await revisions.create(parentManifest, source);
    const energy = new EnergyLedger({
      initialEnergy: 10,
      debitByReason: { clone: 3 },
      rewardByReason: {},
    });
    const service = new CloneEmbryoService(
      revisions,
      energy,
      join(root, "candidates"),
      join(root, "archive"),
      async (_directory, manifest) => assert.equal(manifest.generation, 1),
      async () => {},
      async () => {},
      async () => {},
    );
    const result = await service.clone(
      "agent-parent",
      "agent-child",
      {
        ...parentManifest,
        genomeId: "genome-child",
        agentId: "agent-child",
        parentId: parentManifest.genomeId,
        generation: 1,
      },
      [{ kind: "create-tool", tool: "search-code" }],
    );

    assert.equal(result.status, "born");
    assert.equal(energy.balanceOf("agent-parent"), 7);
    assert.equal(revisions.current("agent-parent")?.manifest.genomeId, "genome-parent");
    assert.equal(revisions.current("agent-child")?.manifest.genomeId, "genome-child");
    assert.deepEqual(revisions.current("agent-child")?.manifest.dependencies, ["tool:search-code"]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

test("failed embryo is archived and never enters the active revisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "clone-"));
  const source = await mkdtemp(join(tmpdir(), "clone-source-"));
  try {
    const parentManifest = await makeGenome(
      source,
      "genome-parent",
      "agent-parent",
      null,
      0,
    );
    const revisions = new GenomeRevisionStore(join(root, "revisions"));
    await revisions.create(parentManifest, source);
    const service = new CloneEmbryoService(
      revisions,
      new EnergyLedger({
        initialEnergy: 10,
        debitByReason: { clone: 1 },
        rewardByReason: {},
      }),
      join(root, "candidates"),
      join(root, "archive"),
      async () => {
        throw new Error("coding test failed");
      },
    );
    const result = await service.clone(
      "agent-parent",
      "agent-child",
      {
        ...parentManifest,
        genomeId: "genome-child",
        agentId: "agent-child",
        parentId: parentManifest.genomeId,
        generation: 1,
      },
      [],
    );

    assert.equal(result.status, "dead");
    assert.match(result.failure.reason, /coding test failed/);
    assert.equal(revisions.current("agent-child"), null);
    assert.match(await readFile(join(result.failure.archiveDirectory, "failure.json"), "utf8"), /coding test failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});
