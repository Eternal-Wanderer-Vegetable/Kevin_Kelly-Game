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

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  assertExperimentEvent,
  type ExperimentEvent,
} from "../contracts/index.js";

export class EventLog {
  public constructor(private readonly filePath: string) {}

  public async append(event: ExperimentEvent): Promise<void> {
    assertExperimentEvent(event);
    await mkdir(dirname(this.filePath), { recursive: true });
    // JSONL keeps the event history append-only and inspectable while allowing
    // replay to rebuild derived runtime state later.
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }

  public async readAll(): Promise<ExperimentEvent[]> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }

    const events: ExperimentEvent[] = [];
    for (const [index, line] of contents.split(/\r?\n/).entries()) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`event log line ${index + 1} is not valid JSON`);
      }
      assertExperimentEvent(parsed);
      events.push(parsed);
    }
    return events;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
