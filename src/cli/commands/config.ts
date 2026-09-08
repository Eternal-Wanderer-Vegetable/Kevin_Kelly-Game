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

import type { HarnessConfig } from "../../config.js";
import {
  CONFIG_OPTIONS,
  CONFIG_OPTION_HELP,
  formatOption,
  parseCommandArgs,
  resolveConfig,
  type CliOptionConfig,
} from "../args.js";
import type { CliCommand } from "../command.js";
import type { CommandDefinition } from "../help.js";

export const definition: CommandDefinition = {
  name: "config",
  summary: "Print the resolved harness configuration.",
  usage: "config [--format <json|text>]",
  options: [
    "--format <json|text>          Choose the output format; text by default.",
    ...CONFIG_OPTION_HELP,
    "--help, -h                    Show this help.",
  ],
};

const options: CliOptionConfig = {
  format: { type: "string" },
  ...CONFIG_OPTIONS,
};

/** Names of the credential variables, reported as set or unset and never read out. */
export const SECRET_VARIABLES: readonly string[] = [
  "HARNESS_LOCAL_MODEL_KEY",
  "HARNESS_EXTERNAL_MODEL_KEY",
];

export interface ConfigReport {
  readonly dataDirectory: string;
  readonly eventLogPath: string;
  readonly defaultEnergy: number;
  readonly externalModelUrl: string | null;
  readonly localModelUrl: string;
  readonly localModelName: string | null;
  readonly externalModelName: string | null;
  readonly secrets: Readonly<Record<string, string>>;
}

export const configCommand: CliCommand = {
  // No helpWhenEmpty: a bare `harness config` must print the configuration.
  // Answering "what did this container actually resolve?" is the whole purpose
  // of the command, and it is the first stop when a deployment misbehaves.
  definition,
  async run(args, io) {
    const { values } = parseCommandArgs(definition, args, options);
    const format = formatOption(values);
    const report = buildConfigReport(resolveConfig(values));

    io.out(
      format === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatConfigText(report),
    );
    return 0;
  },
};

/**
 * Renders configuration for human eyes, with credentials reduced to set/unset.
 *
 * Two reasons the values never appear: a HarnessConfig is hashed into experiment
 * records, so keys must never reach it in the first place, and this command's
 * output is exactly what an operator pastes into a bug report.
 */
export function buildConfigReport(
  config: HarnessConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConfigReport {
  const secrets: Record<string, string> = {};
  for (const name of SECRET_VARIABLES) {
    secrets[name] = readEnv(env, name) === null ? "unset" : "set";
  }

  return {
    dataDirectory: config.dataDirectory,
    eventLogPath: config.eventLogPath,
    defaultEnergy: config.defaultEnergy,
    localModelUrl: config.localModelUrl,
    externalModelUrl: config.externalModelUrl ?? null,
    localModelName: readEnv(env, "HARNESS_LOCAL_MODEL_NAME"),
    externalModelName: readEnv(env, "HARNESS_EXTERNAL_MODEL_NAME"),
    secrets,
  };
}

export function formatConfigText(report: ConfigReport): string {
  const secrets = Object.entries(report.secrets);
  const secretWidth = secrets.reduce(
    (width, [name]) => Math.max(width, name.length),
    0,
  );

  return [
    `dataDirectory:      ${report.dataDirectory}`,
    `eventLogPath:       ${report.eventLogPath}`,
    `defaultEnergy:      ${report.defaultEnergy}`,
    `localModelUrl:      ${report.localModelUrl}`,
    `externalModelUrl:   ${report.externalModelUrl ?? "(unset)"}`,
    `localModelName:     ${report.localModelName ?? "(provider default)"}`,
    `externalModelName:  ${report.externalModelName ?? "(provider default)"}`,
    "",
    "secrets (values are never printed):",
    ...secrets.map(([name, state]) => `  ${name.padEnd(secretWidth)}  ${state}`),
    "",
  ].join("\n");
}

/** Reads one variable, treating a blank value as unset, as loadConfig does. */
function readEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | null {
  const value = env[name];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
