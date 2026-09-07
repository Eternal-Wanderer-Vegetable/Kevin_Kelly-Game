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
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { SandboxToolEnvironment } from "../src/environment/sandbox-tool-environment.js";
import { listWorkspaceFiles } from "../src/environment/sandbox-tools.js";
import {
  createSandboxWorkspace,
  writeSandboxFile,
  type SandboxWorkspace,
} from "../src/sandbox/workspace.js";

async function withEnvironment(
  run: (
    environment: SandboxToolEnvironment,
    workspace: SandboxWorkspace,
  ) => Promise<void>,
  options: { readonly goal?: string; readonly allowedCommands?: readonly string[] } = {},
): Promise<void> {
  const workspace = await createSandboxWorkspace("sandbox-env-test-");
  try {
    const environment = new SandboxToolEnvironment({
      workspace,
      goal: options.goal ?? "improve the harness",
      allowedCommands: options.allowedCommands ?? [process.execPath],
      timeoutMs: 10_000,
    });
    await run(environment, workspace);
  } finally {
    await workspace.dispose();
  }
}

test("write then read returns the stored content", async () => {
  await withEnvironment(async (environment, workspace) => {
    const written = await environment.act({
      type: "write",
      input: { path: "src/answer.txt", content: "42" },
    });
    assert.equal(written.ok, true);
    assert.equal(written.bytesWritten, 2);

    const read = await environment.act({
      type: "read",
      input: { path: "src/answer.txt" },
    });
    assert.equal(read.ok, true);
    assert.equal(read.content, "42");

    // The bytes really landed inside the workspace.
    assert.equal(
      await readFile(join(workspace.inputRoot, "src", "answer.txt"), "utf8"),
      "42",
    );
  });
});

test("reading a missing file fails without throwing", async () => {
  await withEnvironment(async (environment) => {
    const result = await environment.act({
      type: "read",
      input: { path: "nope.txt" },
    });
    assert.equal(result.ok, false);
    assert.match(String(result.error), /ENOENT|no such file/i);
  });
});

test("writing outside the workspace is refused", async () => {
  await withEnvironment(async (environment, workspace) => {
    const result = await environment.act({
      type: "write",
      input: { path: "../outside.txt", content: "must not write" },
    });

    assert.equal(result.ok, false);
    assert.match(String(result.error), /escapes workspace/);
    await assert.rejects(access(join(workspace.root, "outside.txt")));
  });
});

test("reading outside the workspace is refused", async () => {
  await withEnvironment(async (environment) => {
    const result = await environment.act({
      type: "read",
      input: { path: "../../etc/passwd" },
    });
    assert.equal(result.ok, false);
    assert.match(String(result.error), /escapes workspace/);
  });
});

test("search matches both paths and contents", async () => {
  await withEnvironment(async (environment) => {
    await environment.act({
      type: "write",
      input: { path: "src/alpha.ts", content: "export const value = 1;" },
    });
    await environment.act({
      type: "write",
      input: { path: "docs/notes.md", content: "mentions alpha in prose" },
    });
    await environment.act({
      type: "write",
      input: { path: "docs/other.md", content: "unrelated" },
    });

    const byPath = await environment.act({
      type: "search",
      input: { query: "alpha" },
    });
    assert.equal(byPath.ok, true);
    assert.deepEqual(byPath.matches, ["docs/notes.md", "src/alpha.ts"]);

    const byContent = await environment.act({
      type: "search",
      input: { query: "export const" },
    });
    assert.deepEqual(byContent.matches, ["src/alpha.ts"]);
  });
});

test("search respects the result cap", async () => {
  const workspace = await createSandboxWorkspace("sandbox-env-cap-");
  try {
    const environment = new SandboxToolEnvironment({
      workspace,
      goal: "cap search",
      allowedCommands: [],
      maxSearchResults: 2,
    });
    for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"]) {
      await writeSandboxFile(workspace.inputRoot, name, "needle");
    }

    const result = await environment.act({
      type: "search",
      input: { query: "needle" },
    });

    assert.equal(result.ok, true);
    assert.equal((result.matches as readonly string[]).length, 2);
    assert.equal(result.truncated, true);
  } finally {
    await workspace.dispose();
  }
});

test("exec refuses a command outside the allowlist", async () => {
  await withEnvironment(
    async (environment) => {
      const result = await environment.act({
        type: "exec",
        input: { command: "rm", args: ["-rf", "/"] },
      });
      assert.equal(result.ok, false);
      assert.match(String(result.error), /command is not allowed in sandbox: rm/);
    },
    { allowedCommands: [process.execPath] },
  );
});

test("exec runs an allowlisted command and reports its exit code", async () => {
  await withEnvironment(async (environment) => {
    const result = await environment.act({
      type: "exec",
      input: {
        command: process.execPath,
        args: ["-e", "process.stdout.write('hello')"],
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "hello");
    assert.equal(result.timedOut, false);
  });
});

test("exec reports a non-zero exit code as a successful tool call", async () => {
  await withEnvironment(async (environment) => {
    const result = await environment.act({
      type: "exec",
      input: { command: process.execPath, args: ["-e", "process.exit(3)"] },
    });

    // The tool ran; the command failed. Those are different facts.
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 3);
  });
});

test("test returns a boolean verdict derived from the exit code", async () => {
  await withEnvironment(async (environment) => {
    const passing = await environment.act({
      type: "test",
      input: { command: process.execPath, args: ["-e", "process.exit(0)"] },
    });
    assert.equal(passing.ok, true);
    assert.equal(passing.passed, true);

    const failing = await environment.act({
      type: "test",
      input: { command: process.execPath, args: ["-e", "process.exit(1)"] },
    });
    assert.equal(failing.passed, false);
  });
});

test("an unknown action type is rejected", async () => {
  await withEnvironment(async (environment) => {
    await assert.rejects(
      () => environment.act({ type: "deploy", input: {} }),
      /unknown tool action: deploy/,
    );
  });
});

test("the first observation describes the task and never leaks absolute paths", async () => {
  await withEnvironment(
    async (environment, workspace) => {
      await writeSandboxFile(workspace.inputRoot, "src/index.ts", "// start");

      const observation = await environment.observe();

      assert.equal(observation.kind, "task-start");
      assert.equal(observation.content.goal, "improve the harness");
      assert.equal(observation.content.workspaceRoot, ".");
      assert.deepEqual(observation.content.files, ["src/index.ts"]);
      assert.deepEqual(observation.content.tools, [
        "read",
        "search",
        "write",
        "exec",
        "test",
      ]);

      // An absolute temp path in an observation would teach the model to
      // concatenate its way outside the workspace.
      const serialised = JSON.stringify(observation);
      assert.equal(serialised.includes(workspace.root), false);
      assert.equal(serialised.includes(workspace.inputRoot), false);
    },
    { goal: "improve the harness" },
  );
});

test("observe is idempotent and never exhausts", async () => {
  await withEnvironment(async (environment) => {
    const first = await environment.observe();
    const second = await environment.observe();
    assert.deepEqual(first, second);
    assert.equal(first.kind, "task-start");
  });
});

test("later observations carry the previous action and outcome", async () => {
  await withEnvironment(async (environment) => {
    await environment.act({
      type: "write",
      input: { path: "notes.txt", content: "written" },
    });

    const observation = await environment.observe();

    assert.equal(observation.kind, "tool-outcome");
    assert.equal(observation.content.turn, 1);
    assert.deepEqual(observation.content.lastAction, {
      type: "write",
      input: { path: "notes.txt", content: "written" },
    });
    const outcome = observation.content.lastOutcome as Record<string, unknown>;
    assert.equal(outcome.ok, true);
    assert.equal(outcome.path, "notes.txt");
    assert.deepEqual(observation.content.files, ["notes.txt"]);

    // Still idempotent after acting.
    assert.deepEqual(await environment.observe(), observation);
  });
});

test("a refused action is still observable by the agent", async () => {
  await withEnvironment(async (environment) => {
    await environment.act({
      type: "write",
      input: { path: "../escape.txt", content: "nope" },
    });

    const observation = await environment.observe();
    const outcome = observation.content.lastOutcome as Record<string, unknown>;
    assert.equal(outcome.ok, false);
    assert.match(String(outcome.error), /escapes workspace/);
  });
});

test("the environment tracks turns, history, and goal changes", async () => {
  await withEnvironment(async (environment) => {
    assert.equal(environment.turnCount(), 0);

    await environment.act({ type: "write", input: { path: "a.txt", content: "1" } });
    await environment.act({ type: "read", input: { path: "a.txt" } });

    assert.equal(environment.turnCount(), 2);
    assert.equal(environment.getHistory().length, 2);
    assert.deepEqual(await environment.listFiles(), ["a.txt"]);

    environment.setGoal("a different goal");
    assert.equal(environment.getGoal(), "a different goal");
    const observation = await environment.observe();
    assert.equal(observation.content.goal, "a different goal");
    assert.throws(() => environment.setGoal("  "), /goal must not be empty/);
  });
});

test("listWorkspaceFiles sorts, uses forward slashes, and honours the limit", async () => {
  const workspace = await createSandboxWorkspace("sandbox-env-list-");
  try {
    await writeSandboxFile(workspace.inputRoot, "z.txt", "z");
    await writeSandboxFile(workspace.inputRoot, "deep/nested/a.txt", "a");
    await writeSandboxFile(workspace.inputRoot, "m.txt", "m");

    const all = await listWorkspaceFiles(workspace.inputRoot);
    assert.deepEqual(all, ["deep/nested/a.txt", "m.txt", "z.txt"]);

    const limited = await listWorkspaceFiles(workspace.inputRoot, 2);
    assert.equal(limited.length, 2);
  } finally {
    await workspace.dispose();
  }
});

test("invalid tool input is reported as a thrown type error", async () => {
  await withEnvironment(async (environment) => {
    await assert.rejects(
      () => environment.act({ type: "read", input: {} }),
      /read\.path must be a non-empty string/,
    );
    await assert.rejects(
      () =>
        environment.act({
          type: "exec",
          input: { command: process.execPath, args: ["-e", 7] },
        }),
      /exec\.args must be an array of strings/,
    );
  });
});
