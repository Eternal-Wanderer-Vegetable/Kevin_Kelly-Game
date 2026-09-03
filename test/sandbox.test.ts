import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.throws(
    () => resolveSandboxPath("C:\\sandbox\\workspace", "..\\outside"),
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
