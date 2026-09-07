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

import { resolve } from "node:path";

export interface HarnessConfig {
  readonly dataDirectory: string;
  readonly eventLogPath: string;
  readonly defaultEnergy: number;
  readonly localModelUrl: string;
  readonly externalModelUrl?: string;
}

export interface ConfigInput {
  readonly dataDirectory?: string;
  readonly eventLogPath?: string;
  readonly defaultEnergy?: number;
  readonly localModelUrl?: string;
  readonly externalModelUrl?: string;
}

/**
 * Environment variables recognised by {@link configInputFromEnvironment}.
 *
 * API keys are deliberately absent. A HarnessConfig is hashed into experiment
 * records, so credentials must never reach it; providers read their own keys.
 */
export interface ConfigEnvironment {
  readonly HARNESS_DATA_DIR?: string;
  readonly HARNESS_EVENT_LOG?: string;
  readonly HARNESS_DEFAULT_ENERGY?: string;
  readonly HARNESS_LOCAL_MODEL_URL?: string;
  readonly HARNESS_EXTERNAL_MODEL_URL?: string;
}

/**
 * Translates environment variables into a ConfigInput.
 *
 * Environment reading is kept out of loadConfig on purpose. Tests assert the
 * documented defaults, and an implicit process.env read would let them drift
 * with whatever the host happens to export. Callers compose explicitly, which
 * also makes the precedence order visible at the call site:
 *
 *     loadConfig({ ...configInputFromEnvironment(), ...cliOverrides })
 *
 * Only defined, non-blank variables produce fields. Validation stays in
 * loadConfig: HARNESS_DEFAULT_ENERGY is converted with Number() and an
 * unparseable value becomes NaN, which loadConfig rejects.
 */
export function configInputFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConfigInput {
  const dataDirectory = readEnvironmentValue(env, "HARNESS_DATA_DIR");
  const eventLogPath = readEnvironmentValue(env, "HARNESS_EVENT_LOG");
  const defaultEnergy = readEnvironmentValue(env, "HARNESS_DEFAULT_ENERGY");
  const localModelUrl = readEnvironmentValue(env, "HARNESS_LOCAL_MODEL_URL");
  const externalModelUrl = readEnvironmentValue(env, "HARNESS_EXTERNAL_MODEL_URL");

  return {
    ...(dataDirectory === undefined ? {} : { dataDirectory }),
    ...(eventLogPath === undefined ? {} : { eventLogPath }),
    ...(defaultEnergy === undefined
      ? {}
      : { defaultEnergy: Number(defaultEnergy) }),
    ...(localModelUrl === undefined ? {} : { localModelUrl }),
    ...(externalModelUrl === undefined ? {} : { externalModelUrl }),
  };
}

export function loadConfig(
  input: ConfigInput = {},
  cwd = process.cwd(),
): HarnessConfig {
  const dataDirectory = resolve(cwd, input.dataDirectory ?? "data");
  const eventLogPath = resolve(
    cwd,
    input.eventLogPath ?? `${input.dataDirectory ?? "data"}/runs/events.jsonl`,
  );
  const defaultEnergy = input.defaultEnergy ?? 100;

  if (!Number.isFinite(defaultEnergy) || defaultEnergy < 0) {
    throw new TypeError("defaultEnergy must be a non-negative finite number");
  }

  // Keep provider details in configuration so the immutable Core does not
  // contain machine-specific endpoints or credentials.
  const localModelUrl = input.localModelUrl ?? "http://127.0.0.1:8000/v1";
  if (!isHttpUrl(localModelUrl)) {
    throw new TypeError("localModelUrl must be an HTTP or HTTPS URL");
  }
  if (input.externalModelUrl !== undefined && !isHttpUrl(input.externalModelUrl)) {
    throw new TypeError("externalModelUrl must be an HTTP or HTTPS URL");
  }

  return {
    dataDirectory,
    eventLogPath,
    defaultEnergy,
    localModelUrl,
    ...(input.externalModelUrl === undefined
      ? {}
      : { externalModelUrl: input.externalModelUrl }),
  };
}

/**
 * Reads one variable, treating a blank value as unset.
 *
 * Container orchestration frequently passes empty strings for unset variables,
 * and an empty string would otherwise override a valid default.
 */
function readEnvironmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: keyof ConfigEnvironment,
): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
