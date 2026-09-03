import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CONTRACT_SCHEMA_VERSION, type TaskSpec } from "../src/contracts/index.js";
import { runTask } from "../src/tasks/task-runner.js";

test("task runner copies a fixture, runs the allowed command, and cleans up", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "task-fixture-"));
  try {
    await mkdir(join(fixtureRoot, "src"));
    await writeFile(join(fixtureRoot, "src", "input.txt"), "fixture-input", "utf8");
    const task: TaskSpec = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      taskId: "task-fixture",
      level: 1,
      title: "Run fixture",
      repository: { source: fixtureRoot, commit: "fixture" },
      allowedCommands: [process.execPath],
      acceptanceCriteria: ["command exits successfully"],
      baselineTestCommand: `"${process.execPath}" -e "process.stdout.write(require('node:fs').readFileSync('src/input.txt', 'utf8'))"`,
    };

    const result = await runTask(task);

    assert.equal(result.success, true);
    assert.equal(result.commandResult?.stdout, "fixture-input");
    assert.deepEqual(result.patch, { added: {}, modified: {}, deleted: {} });
    assert.deepEqual(result.workspace.metadata, {
      source: fixtureRoot,
      commit: "fixture",
      inputFileCount: 0,
    });
    assert.equal(result.workspace.cleaned, true);
    await assert.rejects(access(result.workspace.root));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("task runner writes task inputs through the sandbox path boundary", async () => {
  const task: TaskSpec = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    taskId: "task-input",
    level: 1,
    title: "Reject escaped input",
    repository: { source: "fixture", commit: "fixture" },
    allowedCommands: [process.execPath],
    acceptanceCriteria: [],
    baselineTestCommand: `${process.execPath} -e "process.exit(0)"`,
  };

  const result = await runTask(task, {
    inputFiles: { "../outside.txt": "must not write" },
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /escapes workspace/);
});

test("task runner preserves file modifications as a structured patch", async () => {
  const task: TaskSpec = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    taskId: "task-patch",
    level: 1,
    title: "Capture patch",
    repository: { source: "fixture", commit: "fixture" },
    allowedCommands: [process.execPath],
    acceptanceCriteria: [],
    baselineTestCommand: `"${process.execPath}" -e "require('node:fs').writeFileSync('src/value.txt', 'after')"`,
  };

  const result = await runTask(task, {
    inputFiles: { "src/value.txt": "before" },
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.patch.modified, {
    "src/value.txt": { before: "before", after: "after" },
  });
});
