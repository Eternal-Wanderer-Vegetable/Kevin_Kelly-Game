import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runHelp(command: string): Promise<string> {
  const result = await execFileAsync(process.execPath, [`dist/scripts/${command}.js`, "--help"]);
  return result.stdout;
}

test("run-task exposes task and agent help", async () => {
  const output = await runHelp("run-task");
  assert.match(output, /Run one coding task/);
  assert.match(output, /--task <task-id>/);
  assert.match(output, /--agent <agent-id>/);
});

test("replay-run exposes event log help", async () => {
  const output = await runHelp("replay-run");
  assert.match(output, /Replay an experiment event log/);
  assert.match(output, /--input <path>/);
});

test("report exposes run and format help", async () => {
  const output = await runHelp("report");
  assert.match(output, /Generate a summary/);
  assert.match(output, /--format <json\|text>/);
});
