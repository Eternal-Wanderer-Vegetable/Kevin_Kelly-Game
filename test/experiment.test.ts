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

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import {
  CONTRACT_SCHEMA_VERSION,
  type ExperimentEvent,
} from "../src/contracts/index.js";
import { EventLog } from "../src/experiment/event-log.js";
import { replayEvents } from "../src/experiment/replay.js";

function stateEvent(
  eventId: string,
  agentId: string,
  lifecycle: "ACTIVE" | "DORMANT" | "DEAD",
): ExperimentEvent {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    eventId,
    runId: "run-001",
    timestamp: "2026-09-03T00:00:00.000Z",
    type: "AGENT_STATE_CHANGED",
    agentId,
    generation: 0,
    payload: { lifecycle },
  };
}

test("loadConfig resolves defaults relative to the working directory", () => {
  const cwd = join(tmpdir(), "experiment");
  const config = loadConfig({}, cwd);
  assert.equal(config.dataDirectory, join(cwd, "data"));
  assert.equal(config.eventLogPath, join(cwd, "data", "runs", "events.jsonl"));
  assert.equal(config.defaultEnergy, 100);
});

test("loadConfig rejects invalid energy and provider URLs", () => {
  assert.throws(
    () => loadConfig({ defaultEnergy: -1 }),
    /defaultEnergy must be a non-negative/,
  );
  assert.throws(
    () => loadConfig({ localModelUrl: "file:///model" }),
    /localModelUrl must be an HTTP/,
  );
});

test("EventLog appends validated JSONL and reads it back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-events-"));
  const path = join(directory, "events.jsonl");
  const log = new EventLog(path);
  const event = stateEvent("event-001", "agent-001", "ACTIVE");

  await log.append(event);

  assert.deepEqual(await log.readAll(), [event]);
  assert.equal((await readFile(path, "utf8")).endsWith("\n"), true);
});

test("replayEvents rebuilds lifecycle state and rejects mixed runs", () => {
  const events = [
    stateEvent("event-001", "agent-001", "ACTIVE"),
    stateEvent("event-002", "agent-001", "DORMANT"),
  ];
  const state = replayEvents(events);

  assert.equal(state.runId, "run-001");
  assert.equal(state.eventCount, 2);
  assert.equal(state.agents.get("agent-001"), "DORMANT");

  assert.throws(
    () =>
      replayEvents([
        ...events,
        { ...stateEvent("event-003", "agent-002", "ACTIVE"), runId: "run-002" },
      ]),
    /multiple run IDs/,
  );
});
