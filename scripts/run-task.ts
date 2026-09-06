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

import {
  formatHelp,
  shouldShowHelp,
} from "../src/cli/help.js";
import { readFile } from "node:fs/promises";
import { assertTaskSpec, type TaskSpec } from "../src/contracts/index.js";
import { runTask } from "../src/tasks/task-runner.js";

const command = {
  name: "run-task",
  summary: "Run one coding task in an isolated workspace.",
  usage: "run-task --task <task-spec.json>",
  options: [
    "--task <task-id>    Select a TaskSpec; a JSON path is accepted.",
    "--agent <agent-id>  Reserved for the upcoming Agent runner.",
    "--help, -h          Show this help.",
  ],
} as const;

const args = process.argv.slice(2);
if (shouldShowHelp(args)) {
  process.stdout.write(formatHelp(command));
} else {
  await main(args);
}

async function main(args: readonly string[]): Promise<void> {
  const taskPath = readOption(args, "--task");
  if (!taskPath) {
    throw new Error("run-task requires --task <task-spec.json>");
  }

  const taskValue: unknown = JSON.parse(await readFile(taskPath, "utf8"));
  assertTaskSpec(taskValue);
  const result = await runTask(taskValue as TaskSpec);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.success) process.exitCode = 1;
}

function readOption(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}
