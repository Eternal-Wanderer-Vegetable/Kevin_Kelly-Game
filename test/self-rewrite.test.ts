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
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CONTRACT_SCHEMA_VERSION, type GenomeManifest } from "../src/contracts/index.js";
import { SelfRewriteService } from "../src/evolution/self-rewrite.js";
import {
  hashDirectory,
  GenomeRevisionStore,
  writeGenomeManifest,
} from "../src/genome/revision-store.js";

async function createGenome(
  source: string,
  genomeId: string,
  agentId: string,
  parentId: string | null,
  generation: number,
): Promise<GenomeManifest> {
  await mkdir(join(source, "plugins"), { recursive: true });
  const pending: GenomeManifest = {
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
  await writeGenomeManifest(source, pending);
  const genomeHash = await hashDirectory(source);
  const manifest = { ...pending, genomeHash };
  await writeGenomeManifest(source, manifest);
  return manifest;
}

test("successful self-rewrite activates only the validated revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "self-rewrite-"));
  const source = await mkdtemp(join(tmpdir(), "self-rewrite-source-"));
  try {
    const first = await createGenome(source, "genome-001", "agent-001", null, 0);
    const store = new GenomeRevisionStore(join(root, "revisions"));
    await store.create(first, source);
    const service = new SelfRewriteService(
      store,
      join(root, "candidates"),
      async (directory) => {
        assert.equal(await readFile(join(directory, "rewrite.txt"), "utf8"), "ok");
      },
      async (_directory, manifest) => {
        assert.equal(manifest.generation, 1);
      },
    );

    const result = await service.rewrite(
      "agent-001",
      {
        ...first,
        genomeId: "genome-002",
        parentId: first.genomeId,
        generation: 1,
        genomeHash: "sha256:ignored",
      },
      async (directory) => {
        await writeFile(join(directory, "rewrite.txt"), "ok", "utf8");
      },
    );

    assert.equal(result.status, "accepted");
    assert.equal(store.current("agent-001")?.manifest.genomeId, "genome-002");
    assert.equal(service.failures().length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

test("failed self-rewrite preserves the reason and leaves the active genome unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "self-rewrite-"));
  const source = await mkdtemp(join(tmpdir(), "self-rewrite-source-"));
  try {
    const first = await createGenome(source, "genome-001", "agent-001", null, 0);
    const store = new GenomeRevisionStore(join(root, "revisions"));
    await store.create(first, source);
    const service = new SelfRewriteService(
      store,
      join(root, "candidates"),
      async () => {
        throw new Error("plugin boot failed");
      },
    );

    const result = await service.rewrite(
      "agent-001",
      {
        ...first,
        genomeId: "genome-002",
        parentId: first.genomeId,
        generation: 1,
        genomeHash: "sha256:ignored",
      },
      async () => {},
    );

    assert.equal(result.status, "rejected");
    assert.match(result.failure.reason, /plugin boot failed/);
    assert.equal(store.current("agent-001")?.manifest.genomeId, "genome-001");
    assert.deepEqual(service.failures(), [result.failure]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

test("default boot test validates plugin manifests and hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "self-rewrite-"));
  const source = await mkdtemp(join(tmpdir(), "self-rewrite-source-"));
  try {
    const pluginSource = "export const booted = true;\n";
    await writeFile(join(source, "plugin.js"), pluginSource, "utf8");
    const pluginHash = `sha256:${createHash("sha256").update(pluginSource).digest("hex")}`;
    await writeFile(
      join(source, "plugin.json"),
      JSON.stringify({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        pluginId: "plugin.boot",
        name: "Boot Plugin",
        version: "1.0.0",
        entrypoint: "plugin.js",
        dependencies: [],
        pluginHash,
      }),
      "utf8",
    );
    const first = await createGenome(source, "genome-001", "agent-001", null, 0);
    const store = new GenomeRevisionStore(join(root, "revisions"));
    await store.create(first, source);
    const service = new SelfRewriteService(store, join(root, "candidates"));
    const result = await service.rewrite(
      "agent-001",
      {
        ...first,
        genomeId: "genome-002",
        parentId: first.genomeId,
        generation: 1,
        plugins: ["plugin.json"],
        genomeHash: "sha256:ignored",
      },
      async () => {},
    );

    assert.equal(result.status, "accepted");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});
