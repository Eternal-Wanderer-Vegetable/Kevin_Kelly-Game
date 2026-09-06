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
import test from "node:test";
import { AgentCore, type Observation } from "../src/core/agent-core.js";
import { MemoryToolEnvironment } from "../src/environment/memory-tool-environment.js";
import { createMemoryToolEnvironment } from "../src/environment/memory-tools.js";
import { ToolRegistry } from "../src/environment/tool-registry.js";
import { MockCognitionProvider } from "../src/providers/mock-cognition.js";

const observation: Observation = {
  kind: "TASK",
  content: { taskId: "task-002" },
};

test("registry invokes the five structured tool names", async () => {
  const tools = createMemoryToolEnvironment(
    { "src/main.ts": "export const answer = 42;" },
    { "npm test": true },
  );

  assert.equal(tools.registry.has("read"), true);
  assert.equal(tools.registry.has("search"), true);
  assert.equal(tools.registry.has("write"), true);
  assert.equal(tools.registry.has("exec"), true);
  assert.equal(tools.registry.has("test"), true);

  assert.deepEqual(
    await tools.registry.invoke({
      name: "read",
      input: { path: "src/main.ts" },
    }),
    {
      ok: true,
      output: { path: "src/main.ts", content: "export const answer = 42;" },
    },
  );
  assert.deepEqual(
    await tools.registry.invoke({
      name: "search",
      input: { query: "answer" },
    }),
    { ok: true, output: { query: "answer", matches: ["src/main.ts"] } },
  );
  await tools.registry.invoke({
    name: "write",
    input: { path: "src/main.ts", content: "export const answer = 43;" },
  });
  assert.equal(tools.files.get("src/main.ts"), "export const answer = 43;");
  assert.equal(
    (await tools.registry.invoke({ name: "exec", input: { command: "npm test" } }))
      .output.exitCode,
    0,
  );
  assert.equal(
    (await tools.registry.invoke({ name: "test", input: { command: "npm test" } }))
      .output.passed,
    true,
  );
});

test("registry rejects duplicate and unregistered tools", async () => {
  const registry = new ToolRegistry();
  await registry.register("read", async () => ({ ok: true, output: {} }));
  assert.throws(
    () => registry.register("read", async () => ({ ok: true, output: {} })),
    /already registered/,
  );
  await assert.rejects(
    () => registry.invoke({ name: "search", input: {} }),
    /not registered/,
  );
});

test("AgentCore sends tool actions through the environment boundary", async () => {
  const tools = createMemoryToolEnvironment({ "README.md": "hello" });
  const environment = new MemoryToolEnvironment(tools.registry, {
    observations: [observation],
  });
  const cognition = new MockCognitionProvider({
    type: "read",
    input: { path: "README.md" },
  });
  const agent = new AgentCore("agent-001", cognition, environment);

  const result = await agent.runTurn();

  assert.equal(result.outcome.ok, true);
  assert.equal(result.outcome.content, "hello");
});

test("tool inputs are validated before a handler can run", async () => {
  const tools = createMemoryToolEnvironment();
  await assert.rejects(
    () => tools.registry.invoke({ name: "read", input: { path: "" } }),
    /read.path must be a non-empty string/,
  );
});
