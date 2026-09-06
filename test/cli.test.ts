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
