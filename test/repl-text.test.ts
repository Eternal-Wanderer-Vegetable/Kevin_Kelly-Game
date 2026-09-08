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
import { PassThrough } from "node:stream";
import test from "node:test";
import { AgentCore } from "../src/core/agent-core.js";
import { SandboxToolEnvironment } from "../src/environment/sandbox-tool-environment.js";
import { runTextRepl } from "../src/cli/commands/repl-text.js";
import {
  ReplSession,
  type ReplSessionRuntime,
} from "../src/cli/tui/session.js";
import { MockCognitionProvider } from "../src/providers/mock-cognition.js";
import { createSandboxWorkspace } from "../src/sandbox/workspace.js";

test("text REPL fallback executes one command without duplicate turn output", async () => {
  const workspace = await createSandboxWorkspace("repl-text-test-");
  const environment = new SandboxToolEnvironment({
    workspace,
    goal: "write a marker",
    allowedCommands: [],
  });
  const provider = new MockCognitionProvider({
    type: "write",
    input: { path: "marker.txt", content: "ok" },
  });
  const runtime: ReplSessionRuntime = {
    agent: new AgentCore("agent-text-test", provider, environment),
    environment,
    dispose: () => workspace.dispose(),
  };
  const session = new ReplSession({ runtime });
  const input = new PassThrough();
  const output: string[] = [];
  const errors: string[] = [];

  try {
    const running = runTextRepl(
      session,
      {
        out: (text) => output.push(text),
        err: (text) => errors.push(text),
      },
      { input },
    );
    input.end("/step\n/quit\n");
    await running;

    const rendered = output.join("");
    assert.equal((rendered.match(/turn #1/g) ?? []).length, 1);
    assert.equal(errors.join(""), "");
    assert.deepEqual(await session.listFiles(), ["marker.txt"]);
  } finally {
    await session.dispose();
  }
});
