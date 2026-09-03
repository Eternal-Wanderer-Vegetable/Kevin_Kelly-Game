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
