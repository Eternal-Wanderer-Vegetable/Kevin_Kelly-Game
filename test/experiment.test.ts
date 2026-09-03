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
  const config = loadConfig({}, "E:\\experiment");
  assert.equal(config.dataDirectory, "E:\\experiment\\data");
  assert.equal(config.eventLogPath, "E:\\experiment\\data\\runs\\events.jsonl");
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
