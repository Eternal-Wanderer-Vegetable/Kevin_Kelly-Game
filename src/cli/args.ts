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

import { parseArgs } from "node:util";
import {
  configInputFromEnvironment,
  loadConfig,
  type ConfigInput,
  type HarnessConfig,
} from "../config.js";
import { CliError, describeError } from "./command.js";
import type { CommandDefinition } from "./help.js";

/**
 * Option declarations accepted by {@link parseCommandArgs}.
 *
 * Deliberately narrower than node:util's own option type: no `multiple` and no
 * `default`. A repeated flag or an implicit default would make the difference
 * between "operator asked for this" and "the CLI guessed" invisible, and every
 * default in this harness belongs in loadConfig where it is documented.
 */
export type CliOptionConfig = Readonly<
  Record<string, { readonly type: "string" | "boolean"; readonly short?: string }>
>;

/** Parsed option values, read through the accessors below rather than directly. */
export type CliValues = Readonly<Record<string, unknown>>;

export interface ParsedCommandArgs {
  readonly values: CliValues;
  readonly positionals: readonly string[];
}

/**
 * Wraps node:util parseArgs so an unknown flag becomes a CliError carrying the
 * command's help, rather than a bare stack trace.
 *
 * strict mode is on: a typo like --tsak must fail loudly. Silently ignoring it
 * would run the command with a missing option and blame the operator later.
 */
export function parseCommandArgs(
  definition: CommandDefinition,
  args: readonly string[],
  options: CliOptionConfig,
): ParsedCommandArgs {
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: [...args],
      options,
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    throw new CliError(describeError(error), definition);
  }
  return { values: parsed.values, positionals: parsed.positionals };
}

/**
 * Reads a string option, treating a blank value as absent.
 *
 * Container orchestration and shell quoting both produce empty strings where
 * "unset" was meant, and an empty path is never a useful answer.
 */
export function stringOption(values: CliValues, name: string): string | undefined {
  const value = values[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new CliError(`--${name} requires a value`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function requireStringOption(
  definition: CommandDefinition,
  values: CliValues,
  name: string,
): string {
  const value = stringOption(values, name);
  if (value === undefined) {
    throw new CliError(`--${name} is required`, definition);
  }
  return value;
}

export function booleanOption(values: CliValues, name: string): boolean {
  return values[name] === true;
}

export function numberOption(
  values: CliValues,
  name: string,
): number | undefined {
  const raw = stringOption(values, name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new CliError(`--${name} must be a number, received: ${raw}`);
  }
  return parsed;
}

export type OutputFormat = "json" | "text";

/**
 * Reads --format. Text is the default: this CLI exists for humans debugging
 * experiments, and a script that wants machine output can say so.
 */
export function formatOption(
  values: CliValues,
  fallback: OutputFormat = "text",
): OutputFormat {
  const raw = stringOption(values, "format");
  if (raw === undefined) return fallback;
  if (raw !== "json" && raw !== "text") {
    throw new CliError(`--format must be json or text, received: ${raw}`);
  }
  return raw;
}

/** Option declarations mirroring every field of {@link ConfigInput}. */
export const CONFIG_OPTIONS: CliOptionConfig = {
  "data-dir": { type: "string" },
  "event-log": { type: "string" },
  energy: { type: "string" },
  "local-model-url": { type: "string" },
  "external-model-url": { type: "string" },
};

export const CONFIG_OPTION_HELP: readonly string[] = [
  "--data-dir <path>             Override HARNESS_DATA_DIR.",
  "--event-log <path>            Override HARNESS_EVENT_LOG.",
  "--energy <number>             Override HARNESS_DEFAULT_ENERGY.",
  "--local-model-url <url>       Override HARNESS_LOCAL_MODEL_URL.",
  "--external-model-url <url>    Override HARNESS_EXTERNAL_MODEL_URL.",
];

export function configInputFromArgs(values: CliValues): ConfigInput {
  const dataDirectory = stringOption(values, "data-dir");
  const eventLogPath = stringOption(values, "event-log");
  const defaultEnergy = numberOption(values, "energy");
  const localModelUrl = stringOption(values, "local-model-url");
  const externalModelUrl = stringOption(values, "external-model-url");

  return {
    ...(dataDirectory === undefined ? {} : { dataDirectory }),
    ...(eventLogPath === undefined ? {} : { eventLogPath }),
    ...(defaultEnergy === undefined ? {} : { defaultEnergy }),
    ...(localModelUrl === undefined ? {} : { localModelUrl }),
    ...(externalModelUrl === undefined ? {} : { externalModelUrl }),
  };
}

/**
 * Resolves configuration with command line arguments winning over environment
 * variables, which in turn win over the defaults documented in loadConfig.
 *
 * The precedence is spelled out at this one call site on purpose: loadConfig
 * never reads process.env itself, so the order cannot drift with the host.
 */
export function resolveConfig(
  values: CliValues,
  env: Readonly<Record<string, string | undefined>> = process.env,
): HarnessConfig {
  try {
    return loadConfig({
      ...configInputFromEnvironment(env),
      ...configInputFromArgs(values),
    });
  } catch (error) {
    // A bad URL or a negative energy is operator input, not a harness bug.
    throw new CliError(describeError(error));
  }
}
