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

import { formatHelp, type CommandDefinition } from "./help.js";

/**
 * Output sink for a command.
 *
 * Commands never touch process.stdout directly: a test can pass a capturing
 * sink and assert the rendered text without spawning a child process, which is
 * the difference between a fast unit test and a build-dependent end-to-end one.
 */
export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export const defaultIo: CliIo = {
  out(text: string): void {
    process.stdout.write(text);
  },
  err(text: string): void {
    process.stderr.write(text);
  },
};

/**
 * An error that is the operator's problem, not a harness bug.
 *
 * executeCommand prints the message alone — no stack trace — because a missing
 * flag or an unreadable file needs a sentence, not a JavaScript backtrace. When
 * a definition is attached, the command's help follows the message.
 */
export class CliError extends Error {
  public readonly definition: CommandDefinition | undefined;
  public readonly exitCode: number;

  public constructor(
    message: string,
    definition?: CommandDefinition,
    exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
    this.definition = definition;
    this.exitCode = exitCode;
  }
}

export interface CliCommand {
  readonly definition: CommandDefinition;
  /**
   * When true, an empty argument list prints help instead of running. The
   * three original scripts behaved this way, and `config` deliberately does
   * not: it must print the resolved configuration when called bare, since that
   * is the whole point of it during deployment triage.
   */
  readonly helpWhenEmpty?: boolean;
  run(args: readonly string[], io: CliIo): Promise<number>;
}

/**
 * Runs one command and returns the process exit code.
 *
 * Help handling lives here rather than in each entry point so that every
 * command answers --help identically, and so the scripts under scripts/ can
 * stay one line long.
 */
export async function executeCommand(
  command: CliCommand,
  args: readonly string[],
  io: CliIo = defaultIo,
): Promise<number> {
  if (
    args.includes("--help") ||
    args.includes("-h") ||
    (args.length === 0 && command.helpWhenEmpty === true)
  ) {
    io.out(formatHelp(command.definition));
    return 0;
  }

  try {
    return await command.run(args, io);
  } catch (error) {
    if (error instanceof CliError) {
      io.err(`${command.definition.name}: ${error.message}\n`);
      if (error.definition !== undefined) {
        io.err(`\n${formatHelp(error.definition)}`);
      }
      return error.exitCode;
    }
    // An unexpected failure keeps its stack: that one is a harness bug and the
    // stack is the useful part of the report.
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    io.err(`${command.definition.name} failed: ${detail}\n`);
    return 1;
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
