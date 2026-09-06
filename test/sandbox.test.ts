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
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { createSandboxWorkspace, resolveSandboxPath, writeSandboxFile } from "../src/sandbox/workspace.js";
import { runSandboxCommand } from "../src/sandbox/runner.js";

test("sandbox workspace creates isolated input and output roots", async () => {
  const workspace = await createSandboxWorkspace("harness-test-");
  try {
    assert.notEqual(workspace.inputRoot, workspace.outputRoot);
    const path = await writeSandboxFile(workspace.inputRoot, "src/main.ts", "export const ok = true;");
    assert.equal(await readFile(path, "utf8"), "export const ok = true;");
  } finally {
    await workspace.dispose();
  }
});

test("sandbox path resolution rejects traversal outside the workspace", () => {
  const workspaceRoot = join(tmpdir(), "sandbox", "workspace");
  assert.throws(
    () => resolveSandboxPath(workspaceRoot, join("..", "outside")),
    /escapes workspace/,
  );
});

test("sandbox runner enforces command allowlist and captures output", async () => {
  const workspace = await createSandboxWorkspace("harness-test-");
  try {
    const result = await runSandboxCommand({
      workspaceRoot: workspace.root,
      command: process.execPath,
      args: ["-e", "process.stdout.write('sandbox-ok')"],
      allowedCommands: [process.execPath],
      maxOutputBytes: 1024,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "sandbox-ok");
    assert.equal(result.resourceUsage.scope, "controller-process");
    assert.ok(result.resourceUsage.cpuTimeMs >= 0);
    assert.ok(result.resourceUsage.memoryPeakBytes > 0);
    await assert.rejects(
      () =>
        runSandboxCommand({
          workspaceRoot: workspace.root,
          command: "not-allowed",
          allowedCommands: [],
        }),
      /not allowed/,
    );
  } finally {
    await workspace.dispose();
  }
});

test("sandbox runner terminates a timed-out process", async () => {
  const workspace = await createSandboxWorkspace("harness-test-");
  try {
    const result = await runSandboxCommand({
      workspaceRoot: workspace.root,
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 1000)"],
      allowedCommands: [process.execPath],
      timeoutMs: 20,
    });
    assert.equal(result.timedOut, true);
  } finally {
    await workspace.dispose();
  }
});

test("sandbox runner only exposes explicitly allowed environment variables", async () => {
  const workspace = await createSandboxWorkspace("harness-test-");
  try {
    const result = await runSandboxCommand({
      workspaceRoot: workspace.root,
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write(`${process.env.SANDBOX_ALLOWED ?? ''}|${process.env.SANDBOX_SECRET ?? ''}`)",
      ],
      allowedCommands: [process.execPath],
      environment: {
        SANDBOX_ALLOWED: "visible",
        SANDBOX_SECRET: "hidden",
      },
      allowedEnvironment: ["SANDBOX_ALLOWED"],
    });
    assert.equal(result.stdout, "visible|");
  } finally {
    await workspace.dispose();
  }
});
