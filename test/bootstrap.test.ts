import test from "node:test";
import assert from "node:assert/strict";
import { createRunId, projectName } from "../src/index.js";

test("project bootstrap exposes a stable project name", () => {
  assert.equal(projectName, "evolving-coding-harness");
});

test("run ids use the harness prefix and timestamp", () => {
  const runId = createRunId(new Date("2026-09-03T00:00:00.000Z"));
  assert.equal(runId, "run-20260903000000");
});
