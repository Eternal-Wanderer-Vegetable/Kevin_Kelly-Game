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
  assertCandidatePlugin,
  assertIndividualMemory,
  CONTRACT_SCHEMA_VERSION,
  type PluginManifest,
} from "../src/contracts/index.js";
import {
  CandidatePluginRegistry,
  IndividualMemoryStore,
} from "../src/memory/store.js";

const plugin: PluginManifest = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  pluginId: "plugin.memory-derived",
  name: "Memory Derived Plugin",
  version: "1.0.0",
  entrypoint: "index.js",
  dependencies: [],
  pluginHash: "sha256:plugin",
};

test("individual memory records context, outcome, persists, and stays out of child memory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memory-store-"));
  try {
    const store = new IndividualMemoryStore("agent-parent");
    const memory = store.record({
      taskId: "task-001",
      context: { language: "typescript", files: ["src/example.ts"] },
      summary: "The regression was fixed by adding a boundary check.",
      outcome: "success",
      recordedAt: "2026-09-06T00:00:00.000Z",
    });
    assert.doesNotThrow(() => assertIndividualMemory(memory));

    const path = join(directory, "memory.jsonl");
    await store.save(path);
    assert.match(await readFile(path, "utf8"), /boundary check/);

    const child = store.cloneForChild("agent-child");
    assert.deepEqual(child.all(), []);
    assert.equal(child.all().some((item) => item.memoryId === memory.memoryId), false);

    const restored = new IndividualMemoryStore("agent-parent");
    assert.equal((await restored.load(path)).length, 1);
    assert.equal(restored.all()[0]?.taskId, "task-001");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("candidate plugins require distinct successful verification tasks before promotion", () => {
  const registry = new CandidatePluginRegistry("agent-parent");
  const candidate = registry.create({
    plugin,
    sourceMemoryIds: ["memory-001"],
    verificationTaskIds: ["task-verify-1", "task-verify-2"],
  });
  assert.equal(candidate.status, "candidate");
  assert.doesNotThrow(() => assertCandidatePlugin(candidate));

  const afterFirst = registry.recordVerification(
    candidate.candidateId,
    "task-verify-1",
    true,
  );
  assert.equal(afterFirst.status, "candidate");
  assert.equal(afterFirst.successfulVerificationCount, 1);

  const repeated = registry.recordVerification(
    candidate.candidateId,
    "task-verify-1",
    true,
  );
  assert.equal(repeated.status, "candidate");
  assert.equal(repeated.successfulVerificationCount, 1);

  const failed = registry.recordVerification(
    candidate.candidateId,
    "task-verify-2",
    false,
  );
  assert.equal(failed.status, "candidate");
  assert.deepEqual(registry.verifiedPlugins(), []);

  const verified = registry.recordVerification(
    candidate.candidateId,
    "task-verify-2",
    true,
  );
  assert.equal(verified.status, "verified");
  assert.equal(verified.successfulVerificationCount, 2);
  assert.deepEqual(registry.verifiedPlugins(), [plugin]);
});

test("candidate plugin verification rejects unregistered tasks", () => {
  const registry = new CandidatePluginRegistry("agent-parent");
  const candidate = registry.create({
    plugin,
    sourceMemoryIds: [],
    verificationTaskIds: ["task-verify"],
  });
  assert.throws(
    () => registry.recordVerification(candidate.candidateId, "other-task", true),
    /not registered/,
  );
});
