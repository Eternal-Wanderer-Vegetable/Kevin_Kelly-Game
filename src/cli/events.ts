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

import { access } from "node:fs/promises";
import type { HarnessConfig } from "../config.js";
import type { ExperimentEvent } from "../contracts/index.js";
import { EventLog } from "../experiment/event-log.js";
import { stringOption, type CliValues } from "./args.js";
import { CliError, describeError } from "./command.js";
import type { CommandDefinition } from "./help.js";

/** --input wins over the configured event log path, which is env-driven. */
export function resolveEventLogPath(
  values: CliValues,
  config: HarnessConfig,
): string {
  return stringOption(values, "input") ?? config.eventLogPath;
}

/**
 * Reads an append-only event log, refusing a path that does not exist.
 *
 * EventLog.readAll treats a missing file as an empty log, which is right for a
 * writer starting fresh but wrong for a reader: "no events yet" and "you pointed
 * at the wrong path" would print identically, and a mistyped HARNESS_EVENT_LOG is
 * the most common deployment mistake this CLI has to diagnose.
 */
export async function readEventLog(
  path: string,
): Promise<readonly ExperimentEvent[]> {
  try {
    await access(path);
  } catch {
    throw new CliError(`event log not found: ${path}`);
  }
  try {
    return await new EventLog(path).readAll();
  } catch (error) {
    throw new CliError(`cannot read event log ${path}: ${describeError(error)}`);
  }
}

export function listRunIds(
  events: readonly ExperimentEvent[],
): readonly string[] {
  return [...new Set(events.map((event) => event.runId))].sort();
}

/**
 * Narrows a log to a single run.
 *
 * replayEvents refuses a log holding more than one run ID, so the choice has to
 * be made here. When the log is mixed and no run was named, the CLI asks instead
 * of picking the first one: silently reporting on one of several runs would be
 * worse than an error, because the numbers would look plausible.
 */
export function selectRun(
  definition: CommandDefinition,
  events: readonly ExperimentEvent[],
  runId: string | undefined,
): readonly ExperimentEvent[] {
  if (runId !== undefined) {
    const selected = events.filter((event) => event.runId === runId);
    if (selected.length === 0) {
      const known = listRunIds(events);
      const suffix = known.length === 0 ? "" : ` known runs: ${known.join(", ")}`;
      throw new CliError(`no events found for run ${runId}.${suffix}`);
    }
    return selected;
  }

  const runIds = listRunIds(events);
  if (runIds.length > 1) {
    throw new CliError(
      `event log holds ${runIds.length} runs; select one with --run <run-id>. ` +
        `Runs: ${runIds.join(", ")}`,
      definition,
    );
  }
  return events;
}

/** Agent IDs seen anywhere in the selected events, sorted for stable output. */
export function listAgentIds(
  events: readonly ExperimentEvent[],
): readonly string[] {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.agentId !== undefined && event.agentId !== "") {
      ids.add(event.agentId);
    }
  }
  return [...ids].sort();
}

export function countEventTypes(
  events: readonly ExperimentEvent[],
): Readonly<Record<string, number>> {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])),
  );
}
