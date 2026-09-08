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

import { readFile } from "node:fs/promises";
import { assertTaskSpec, type TaskSpec } from "../../contracts/index.js";
import { runTask } from "../../tasks/task-runner.js";
import {
  booleanOption,
  parseCommandArgs,
  requireStringOption,
  type CliOptionConfig,
} from "../args.js";
import { CliError, describeError, type CliCommand } from "../command.js";
import type { CommandDefinition } from "../help.js";

export const definition: CommandDefinition = {
  name: "run-task",
  summary: "Run one coding task in an isolated workspace.",
  usage: "run-task --task <task-spec.json>",
  options: [
    "--task <task-id>    Select a TaskSpec; a JSON path is accepted.",
    "--agent <agent-id>  Reserved for the upcoming Agent runner.",
    "--json              Print the result as one compact JSON line.",
    "--help, -h          Show this help.",
  ],
};

const options: CliOptionConfig = {
  task: { type: "string" },
  agent: { type: "string" },
  json: { type: "boolean" },
};

export const runTaskCommand: CliCommand = {
  definition,
  helpWhenEmpty: true,
  async run(args, io) {
    const { values } = parseCommandArgs(definition, args, options);

    // --agent remains a reserved, accepted option for compatibility with the
    // original script. The task runner still executes the TaskSpec baseline
    // command until an agent runner is introduced.
    const taskPath = requireStringOption(definition, values, "task");
    const spec = await readTaskSpec(taskPath);
    const result = await runTask(spec);

    io.out(
      `${
        booleanOption(values, "json")
          ? JSON.stringify(result)
          : JSON.stringify(result, null, 2)
      }\n`,
    );
    return result.success ? 0 : 1;
  },
};

/**
 * Loads and validates a TaskSpec, naming which of the three ways it failed.
 *
 * "cannot read", "not valid JSON" and "invalid" call for different fixes, so
 * they are reported separately rather than as one opaque parse error.
 */
async function readTaskSpec(path: string): Promise<TaskSpec> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new CliError(`cannot read task spec ${path}: ${describeError(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliError(
      `task spec ${path} is not valid JSON: ${describeError(error)}`,
    );
  }

  try {
    assertTaskSpec(parsed);
    return parsed;
  } catch (error) {
    throw new CliError(`task spec ${path} is invalid: ${describeError(error)}`);
  }
}
