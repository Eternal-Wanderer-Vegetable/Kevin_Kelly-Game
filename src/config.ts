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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
