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

import { buildRunReport, type RunReport } from "../cli/commands/report.js";
import { countEventTypes } from "../cli/events.js";
import type { ExperimentEvent } from "../contracts/index.js";
import { statEventsFile, tailEvents } from "./tail.js";

export type RunStatus = "running" | "completed" | "error" | "stalled";

export interface RunListItem {
  readonly runId: string;
  readonly firstTimestamp: string | null;
  readonly lastTimestamp: string | null;
  readonly eventCount: number;
  readonly eventsByType: Readonly<Record<string, number>>;
  readonly lastEventType: string | null;
  readonly status: RunStatus;
}

export interface RunSummary extends RunReport {
  readonly status: RunStatus;
}

export interface RunStoreOptions {
  readonly eventLogPath: string;
  readonly defaultEnergy: number;
  /** A run whose newest event is older than this reports as stalled. */
  readonly stalledAfterMs?: number;
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

const DEFAULT_STALLED_AFTER_MS = 10 * 60 * 1000;

/**
 * Groups the append-only event log by run and derives per-run progress.
 *
 * Events are filtered to a single run *before* buildRunReport: replayEvents
 * refuses a log holding several run IDs, so the grouping here is what lets the
 * CLI-shaped report functions work unchanged on the shared log. Results are
 * cached until the file's size or mtime moves, so a polling dashboard does not
 * re-read the log for every request.
 */
export class RunStore {
  private cacheKey: string | null = null;
  private groups: ReadonlyMap<string, readonly ExperimentEvent[]> = new Map();

  public constructor(private readonly options: RunStoreOptions) {}

  public async listRuns(): Promise<readonly RunListItem[]> {
    const groups = await this.loadGroups();
    const now = (this.options.now ?? Date.now)();
    return [...groups.entries()]
      .map(([runId, events]): RunListItem => {
        const first = events[0];
        const last = events.at(-1);
        return {
          runId,
          firstTimestamp: first?.timestamp ?? null,
          lastTimestamp: last?.timestamp ?? null,
          eventCount: events.length,
          eventsByType: countEventTypes(events),
          lastEventType: last?.type ?? null,
          status: deriveStatus(events, now, this.stalledAfterMs()),
        };
      })
      .sort((left, right) =>
        (right.lastTimestamp ?? "").localeCompare(left.lastTimestamp ?? ""),
      );
  }

  public async summarizeRun(runId: string): Promise<RunSummary | null> {
    const groups = await this.loadGroups();
    const events = groups.get(runId);
    if (events === undefined) return null;
    const now = (this.options.now ?? Date.now)();
    const report = buildRunReport({
      eventLog: this.options.eventLogPath,
      events,
      initialEnergy: this.options.defaultEnergy,
    });
    return {
      ...report,
      status: deriveStatus(events, now, this.stalledAfterMs()),
    };
  }

  private stalledAfterMs(): number {
    return this.options.stalledAfterMs ?? DEFAULT_STALLED_AFTER_MS;
  }

  private async loadGroups(): Promise<
    ReadonlyMap<string, readonly ExperimentEvent[]>
  > {
    const fileStatus = await statEventsFile(this.options.eventLogPath);
    if (fileStatus === null) {
      this.cacheKey = null;
      this.groups = new Map();
      return this.groups;
    }
    const key = `${fileStatus.size}:${fileStatus.mtimeMs}`;
    if (this.cacheKey === key) return this.groups;

    const groups = new Map<string, ExperimentEvent[]>();
    const { events } = await tailEvents(
      this.options.eventLogPath,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    for (const event of events) {
      const existing = groups.get(event.runId);
      if (existing === undefined) {
        groups.set(event.runId, [event]);
      } else {
        existing.push(event);
      }
    }
    this.cacheKey = key;
    this.groups = groups;
    return groups;
  }
}

/**
 * Terminal events decide a run's outcome, last one wins: a repair that records
 * REPAIR_ERROR and later finishes with REPAIR_COMPLETED is completed, and a
 * completion followed by an error is an error. Everything else is running
 * until the log goes quiet for longer than the stall window.
 */
function deriveStatus(
  events: readonly ExperimentEvent[],
  now: number,
  stalledAfterMs: number,
): RunStatus {
  let status: RunStatus = "running";
  for (const event of events) {
    if (event.type === "REPAIR_ERROR") {
      status = "error";
    } else if (
      event.type === "EXPERIMENT_RUN_COMPLETED" ||
      event.type === "REPAIR_COMPLETED"
    ) {
      status = "completed";
    }
  }
  if (status !== "running") return status;

  const last = events.at(-1);
  if (last === undefined) return "stalled";
  const elapsed = now - Date.parse(last.timestamp);
  if (Number.isFinite(elapsed) && elapsed > stalledAfterMs) return "stalled";
  return "running";
}
