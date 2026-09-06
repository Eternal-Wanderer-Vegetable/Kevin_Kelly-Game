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

export interface CommandDefinition {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  readonly options: readonly string[];
}

export function formatHelp(command: CommandDefinition): string {
  return [
    `${command.name} - ${command.summary}`,
    "",
    "Usage:",
    `  ${command.usage}`,
    "",
    "Options:",
    ...command.options.map((option) => `  ${option}`),
    "",
  ].join("\n");
}

export function shouldShowHelp(args: readonly string[]): boolean {
  return args.length === 0 || args.includes("--help") || args.includes("-h");
}

export function reportNotImplemented(
  command: CommandDefinition,
  args: readonly string[],
): never {
  const received = args.length > 0 ? ` Received: ${args.join(" ")}` : "";
  throw new Error(
    `${command.name} execution is not implemented yet.${received}`,
  );
}
