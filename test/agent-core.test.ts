import assert from "node:assert/strict";
import test from "node:test";
import { AgentCore, type Observation } from "../src/core/agent-core.js";
import { MemoryEnvironment } from "../src/environment/memory-environment.js";
import { MockCognitionProvider } from "../src/providers/mock-cognition.js";

const observation: Observation = {
  kind: "TASK",
  content: { taskId: "task-001" },
};

test("AgentCore executes Observe, Think, Act in order", async () => {
  const cognition = new MockCognitionProvider({
    type: "READ",
    input: { path: "README.md" },
  });
  const environment = new MemoryEnvironment([observation]);
  const agent = new AgentCore("agent-001", cognition, environment);

  const result = await agent.runTurn();

  assert.deepEqual(result.observation, observation);
  assert.equal(result.action.type, "READ");
  assert.deepEqual(environment.getActions(), [result.action]);
  assert.equal(cognition.getRequests()[0]?.agentId, "agent-001");
});

test("AgentCore refuses turns outside ACTIVE state", async () => {
  const agent = new AgentCore(
    "agent-001",
    new MockCognitionProvider(),
    new MemoryEnvironment([observation]),
  );

  agent.enterDormant();
  await assert.rejects(() => agent.runTurn(), /not active/);
  agent.revive();
  agent.die();
  await assert.rejects(() => agent.runTurn(), /not active/);
});

test("AgentCore enforces valid lifecycle transitions", () => {
  const agent = new AgentCore(
    "agent-001",
    new MockCognitionProvider(),
    new MemoryEnvironment([]),
  );

  assert.throws(() => agent.revive(), /must be DORMANT/);
  agent.enterDormant();
  assert.throws(() => agent.enterDormant(), /must be ACTIVE/);
  agent.revive();
  agent.die();
  assert.throws(() => agent.die(), /already dead/);
});
