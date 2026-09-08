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

import { defaultIo, executeCommand, type CliCommand } from "../src/cli/command.js";
import { configCommand } from "../src/cli/commands/config.js";
import { replayRunCommand } from "../src/cli/commands/replay-run.js";
import { reportCommand } from "../src/cli/commands/report.js";
import { replCommand } from "../src/cli/commands/repl.js";
import { runTaskCommand } from "../src/cli/commands/run-task.js";

/**
 * Root command. Each subcommand keeps its own entry point under scripts/ as
 * well, so `node dist/scripts/report.js` and `harness report` are the same code
 * reached two ways.
 */
const COMMANDS: readonly CliCommand[] = [
  runTaskCommand,
  replayRunCommand,
  reportCommand,
  configCommand,
  replCommand,
];

const NAME_WIDTH = 12;

function formatRootHelp(): string {
  return [
    "harness - Evolving Coding Harness command line interface.",
    "",
    "Usage:",
    "  harness <command> [options]",
    "",
    "Commands:",
    ...COMMANDS.map(
      (command) =>
        `  ${command.definition.name.padEnd(NAME_WIDTH)}${command.definition.summary}`,
    ),
    "",
    "Run 'harness <command> --help' for that command's options.",
    "",
  ].join("\n");
}

const argv = process.argv.slice(2);
const requested = argv[0];

if (requested === undefined || requested === "--help" || requested === "-h") {
  process.stdout.write(formatRootHelp());
} else if (requested.startsWith("-")) {
  // A root-level flag is almost always a subcommand the operator forgot to name.
  process.stderr.write(`harness: unknown option: ${requested}\n\n${formatRootHelp()}`);
  process.exitCode = 1;
} else {
  const command = COMMANDS.find(
    (candidate) => candidate.definition.name === requested,
  );
  if (command === undefined) {
    process.stderr.write(
      `harness: unknown command: ${requested}\n\n${formatRootHelp()}`,
    );
    process.exitCode = 1;
  } else {
    process.exitCode = await executeCommand(command, argv.slice(1), defaultIo);
  }
}
