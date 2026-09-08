/*
 * Copyright (C) 2026 Vegetable
 *
 * This file is part of Evolving Coding Harness.
 *
 * Evolving Coding Harness is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3, or later.
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
import { access } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { AgentCore } from "../src/core/agent-core.js";
import { SandboxToolEnvironment } from "../src/environment/sandbox-tool-environment.js";
import { MockCognitionProvider } from "../src/providers/mock-cognition.js";
import {
  createSandboxWorkspace,
  type SandboxWorkspace,
} from "../src/sandbox/workspace.js";
import {
  ReplSession,
  type ReplSessionRuntime,
} from "../src/cli/tui/session.js";

interface Fixture {
  readonly runtime: ReplSessionRuntime;
  readonly workspace: SandboxWorkspace;
}

async function createFixture(goal: string): Promise<Fixture> {
  const workspace = await createSandboxWorkspace("repl-session-test-");
  const environment = new SandboxToolEnvironment({
    workspace,
    goal,
    allowedCommands: [],
  });
  const cognition = new MockCognitionProvider({
    type: "write",
    input: { path: "answer.txt", content: "42" },
  });
  const agent = new AgentCore("agent-repl-test", cognition, environment);
  return {
    workspace,
    runtime: {
      agent,
      environment,
      dispose: () => workspace.dispose(),
      describeProvider: () => ({ provider: "mock" }),
    },
  };
}

test("ReplSession records one Observe-Think-Act turn", async () => {
  const fixture = await createFixture("write the answer");
  try {
    const session = new ReplSession({ runtime: fixture.runtime });
    const turn = await session.step();

    assert.equal(turn.index, 1);
    assert.equal(turn.observation.kind, "task-start");
    assert.equal(turn.action.type, "write");
    assert.equal(turn.outcome.ok, true);
    assert.equal(turn.error, undefined);
    assert.deepEqual(await session.listFiles(), ["answer.txt"]);
    assert.equal(session.turns().length, 1);
  } finally {
    await fixture.workspace.dispose();
  }
});

test("ReplSession runs multiple turns and stops at a turn boundary", async () => {
  const fixture = await createFixture("repeat the write");
  try {
    const session = new ReplSession({ runtime: fixture.runtime });
    const iterator = session.run(10);
    const first = await iterator.next();

    assert.equal(first.done, false);
    assert.equal(first.value?.index, 1);

    session.stop();
    const end = await iterator.next();

    assert.equal(end.done, true);
    assert.equal(session.turns().length, 1);
  } finally {
    await fixture.workspace.dispose();
  }
});

test("reset replaces and disposes the workspace runtime", async () => {
  const fixtures: Fixture[] = [];
  const initial = await createFixture("initial goal");
  fixtures.push(initial);
  const session = new ReplSession({
    runtime: initial.runtime,
    createRuntime: async (goal) => {
      const next = await createFixture(goal);
      fixtures.push(next);
      return next.runtime;
    },
  });

  try {
    await session.step();
    assert.deepEqual(await session.listFiles(), ["answer.txt"]);

    await session.reset();

    assert.equal(session.getGoal(), "initial goal");
    assert.equal(session.turns().length, 0);
    assert.deepEqual(await session.listFiles(), []);
    await assert.rejects(access(join(initial.workspace.root, "input")));
  } finally {
    await Promise.all(fixtures.map((fixture) => fixture.workspace.dispose()));
  }
});

test("an aborted step is rejected before it touches the agent", async () => {
  const fixture = await createFixture("aborted");
  try {
    const session = new ReplSession({ runtime: fixture.runtime });
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => session.step(controller.signal),
      /REPL operation was aborted/,
    );
    assert.equal(session.turns().length, 0);
  } finally {
    await fixture.workspace.dispose();
  }
});
