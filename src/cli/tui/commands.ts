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

import type { ReplSession, ReplTurn } from "./session.js";

export interface ReplCommandContext {
  readonly session: ReplSession;
  readonly write: (text: string) => void;
  readonly onTurn?: (turn: ReplTurn) => void;
  readonly onReset?: () => void;
  readonly loadTask?: (path: string) => Promise<void>;
  readonly isRunning?: () => boolean;
  readonly quit?: () => Promise<void>;
}

export type ReplCommandResult = "continue" | "quit";

export async function executeReplCommand(
  line: string,
  context: ReplCommandContext,
): Promise<ReplCommandResult> {
  const trimmed = line.trim();
  if (trimmed === "") return "continue";

  const [command, ...parts] = trimmed.split(/\s+/);
  const argument = parts.join(" ");

  switch (command) {
    case "/step": {
      const turn = await context.session.step();
      context.onTurn?.(turn);
      context.write(formatTurn(turn));
      return "continue";
    }
    case "/run": {
      const count = parsePositiveInteger(argument || "1", "/run");
      for await (const turn of context.session.run(count)) {
        context.onTurn?.(turn);
        context.write(formatTurn(turn));
      }
      return "continue";
    }
    case "/stop":
      context.session.stop();
      context.write("stop requested; the current turn will finish first\n");
      return "continue";
    case "/task":
      if (context.loadTask === undefined) {
        throw new Error("loading tasks is unavailable in this session");
      }
      if (argument === "") throw new Error("usage: /task <task-spec.json>");
      await context.loadTask(argument);
      context.onReset?.();
      context.write(`loaded task: ${argument}\n`);
      return "continue";
    case "/goal":
      if (argument === "") throw new Error("usage: /goal <text>");
      context.session.setGoal(argument);
      context.write(`goal: ${context.session.getGoal()}\n`);
      return "continue";
    case "/files": {
      const files = await context.session.listFiles();
      context.write(
        files.length === 0
          ? "(workspace is empty)\n"
          : `${files.join("\n")}\n`,
      );
      return "continue";
    }
    case "/cat": {
      if (argument === "") throw new Error("usage: /cat <path>");
      const outcome = await context.session.inspect({
        type: "read",
        input: { path: argument },
      });
      context.write(formatOutcome(outcome));
      return "continue";
    }
    case "/patch":
      context.write(await context.session.getPatch());
      return "continue";
    case "/state":
      context.write(
        [
          `lifecycle: ${context.session.getLifecycle()}`,
          `goal:      ${context.session.getGoal()}`,
          `turns:     ${context.session.turns().length}`,
          "",
        ].join("\n"),
      );
      return "continue";
    case "/provider":
      context.write(`${formatRecord(context.session.describeProvider())}\n`);
      return "continue";
    case "/reset":
      await context.session.reset();
      context.onReset?.();
      context.write("workspace reset\n");
      return "continue";
    case "/help":
      context.write(formatReplHelp());
      return "continue";
    case "/quit":
    case "/exit":
      if (context.isRunning?.() === true) {
        throw new Error("stop the active run before quitting");
      }
      await context.quit?.();
      return "quit";
    default:
      throw new Error(`unknown REPL command: ${command}; use /help`);
  }
}

export function formatTurn(turn: ReplTurn): string {
  return [
    `turn #${turn.index} (${turn.durationMs}ms)`,
    `observe: ${turn.observation.kind} ${formatRecord(turn.observation.content)}`,
    `think:   ${turn.action.type} ${formatRecord(turn.action.input)}`,
    `act:     ${formatRecord(turn.outcome)}`,
    ...(turn.error === undefined ? [] : [`error:   ${turn.error}`]),
    "",
  ].join("\n");
}

export function formatReplHelp(): string {
  return [
    "/step              execute one Observe -> Think -> Act turn",
    "/run [n]           execute up to n turns",
    "/stop              stop a continuous run at the next turn boundary",
    "/task <path>       load a TaskSpec and rebuild the workspace",
    "/goal <text>       change the task goal",
    "/files             list workspace files",
    "/cat <path>        read a workspace file",
    "/patch             show changes from the initial workspace",
    "/state             show lifecycle, goal, and turn count",
    "/provider          show provider details with secrets masked",
    "/reset             discard changes and rebuild the workspace",
    "/help              show this help",
    "/quit              leave the REPL",
    "",
  ].join("\n");
}

function formatOutcome(outcome: Readonly<Record<string, unknown>>): string {
  const content = outcome.content;
  if (typeof content === "string") return `${content}\n`;
  return `${formatRecord(outcome)}\n`;
}

function formatRecord(record: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(record);
}

function parsePositiveInteger(value: string, command: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${command} requires a positive integer`);
  }
  return parsed;
}
