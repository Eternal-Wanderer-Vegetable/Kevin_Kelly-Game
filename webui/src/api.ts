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

/**
 * Typed client for the read-only dashboard API.
 *
 * When the server runs with a token, the SPA itself is only reachable with
 * ?token=…, so the same token is replayed on every API call — EventSource
 * cannot set headers, which is why the server accepts query tokens at all.
 */

export interface RunListItem {
  readonly runId: string;
  readonly firstTimestamp: string | null;
  readonly lastTimestamp: string | null;
  readonly eventCount: number;
  readonly eventsByType: Readonly<Record<string, number>>;
  readonly lastEventType: string | null;
  readonly status: string;
}

export interface AgentSummary {
  readonly agentId: string;
  readonly lifecycle: string | null;
  readonly energy: number | null;
}

export interface RunSummary {
  readonly eventLog: string;
  readonly runId: string | null;
  readonly eventCount: number;
  readonly eventsByType: Readonly<Record<string, number>>;
  readonly initialEnergy: number;
  readonly agents: readonly AgentSummary[];
  readonly warnings: readonly string[];
  readonly status: string;
}

export interface DashboardEvent {
  readonly schemaVersion: number;
  readonly eventId: string;
  readonly runId: string;
  readonly timestamp: string;
  readonly type: string;
  readonly agentId?: string;
  readonly generation?: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EventsPage {
  readonly events: readonly DashboardEvent[];
  readonly nextOffset: number;
  readonly skipped: number;
}

export interface ArtifactEntry {
  readonly path: string;
  readonly type: "file" | "directory";
  readonly size: number | null;
  readonly mtimeMs: number | null;
}

const token = (): string | null =>
  new URLSearchParams(window.location.search).get("token");

function withToken(path: string): string {
  const value = token();
  if (value === null || value === "") return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}token=${encodeURIComponent(value)}`;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(withToken(path));
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export const fetchRuns = (): Promise<{
  runs: readonly RunListItem[];
  generatedAt: string;
}> => getJson<{ runs: readonly RunListItem[]; generatedAt: string }>("/api/runs");

export const fetchSummary = (runId: string): Promise<RunSummary> =>
  getJson<RunSummary>(
    `/api/runs/${encodeURIComponent(runId)}/summary`,
  );

export const fetchArtifacts = (): Promise<{
  entries: readonly ArtifactEntry[];
}> => getJson<{ entries: readonly ArtifactEntry[] }>("/api/artifacts");

export const fetchArtifact = (path: string): Promise<{
  path: string;
  content: string;
}> =>
  getJson<{ path: string; content: string }>(
    `/api/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`,
  );

/**
 * Subscribes to server-pushed event batches starting from the beginning of
 * the log; the server filters by run, so a full-history offset stays valid.
 */
export function openEventStream(
  runId: string | undefined,
  onBatch: (page: EventsPage) => void,
): EventSource {
  const params = new URLSearchParams({ after: "0" });
  if (runId !== undefined) params.set("run", runId);
  const value = token();
  if (value !== null && value !== "") params.set("token", value);

  const source = new EventSource(`/api/stream?${params.toString()}`);
  source.addEventListener("batch", (event) => {
    onBatch(
      JSON.parse((event as MessageEvent<string>).data) as EventsPage,
    );
  });
  return source;
}
