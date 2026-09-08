/*
 * Copyright (C) 2026 Vegetable
 *
 * This file is part of Evolving Coding Harness.
 *
 * Evolving Coding Harness is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3, or later.
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

import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { CliIo } from "../command.js";
import {
  executeReplCommand,
  formatReplHelp,
} from "../tui/commands.js";
import type { ReplSession } from "../tui/session.js";

export interface TextReplOptions {
  readonly input?: Readable;
  readonly loadTask?: (path: string) => Promise<void>;
}

export async function runTextRepl(
  session: ReplSession,
  io: CliIo,
  options: TextReplOptions = {},
): Promise<void> {
  const input = options.input ?? process.stdin;
  const readline = createInterface({
    input,
    crlfDelay: Infinity,
  });
  let running = false;
  let quit = false;
  const stop = (): void => session.stop();
  process.once("SIGINT", stop);

  const write = (text: string): void => io.out(text);

  try {
    io.out("REPL text mode (no TTY); type /help for commands.\n");
    for await (const line of readline) {
      try {
        const command = line.trim();
        running = command.startsWith("/run");
        const context = {
          session,
          isRunning: () => running,
          write,
          quit: async () => {
            quit = true;
          },
          ...(options.loadTask === undefined
            ? {}
            : { loadTask: options.loadTask }),
        };
        const result = await executeReplCommand(line, context);
        if (result === "quit" || quit) break;
      } catch (error) {
        io.err(`repl: ${error instanceof Error ? error.message : String(error)}\n`);
      } finally {
        running = false;
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    readline.close();
  }
}

export function textReplHelp(): string {
  return formatReplHelp();
}
