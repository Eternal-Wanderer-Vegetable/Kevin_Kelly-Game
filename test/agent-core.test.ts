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
