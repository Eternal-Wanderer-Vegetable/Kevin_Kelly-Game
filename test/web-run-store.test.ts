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
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildRunReport } from "../src/cli/commands/report.js";
import type { ExperimentEvent } from "../src/contracts/index.js";
import { EventLog } from "../src/experiment/event-log.js";
import { RunStore } from "../src/web/run-store.js";

describe("RunStore", () => {
  let directory: string;
  let logPath: string;
  let sequence = 0;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "harness-run-store-"));
    logPath = join(directory, "events.jsonl");
  });

  after(async () => {
    await writeFile(logPath, "").catch(() => {});
  });

  const event = (
    runId: string,
    type: string,
    extra: Partial<ExperimentEvent> = {},
  ): ExperimentEvent => {
    sequence += 1;
    return {
      schemaVersion: 1,
      eventId: `event-${sequence}`,
      runId,
      timestamp: "2026-09-12T00:00:00.000Z",
      type,
      payload: {},
      ...extra,
    };
  };

  const energyDebit = (
    balanceBefore: number,
    balanceAfter: number,
  ): ExperimentEvent => ({
    ...event("energy-run", "ENERGY_DEBITED", {
      agentId: "agent-1",
      payload: {
        transaction: {
          schemaVersion: 1,
          transactionId: `tx-${sequence}`,
          agentId: "agent-1",
          kind: "DEBIT",
          amount: 10,
          reason: "task",
          balanceBefore,
          balanceAfter,
        },
      },
    }),
  });

  it("groups a mixed log into per-run list items", async () => {
    await writeFile(
      logPath,
      [
        JSON.stringify(event("run-1", "GENERATION_STARTED")),
        JSON.stringify(event("run-2", "REPAIR_STARTED")),
        JSON.stringify(
          event("run-1", "GENERATION_COMPLETED", {
            generation: 1,
            timestamp: "2026-09-12T00:05:00.000Z",
          }),
        ),
        JSON.stringify(
          event("run-2", "REPAIR_TURN", {
            timestamp: "2026-09-12T00:01:00.000Z",
          }),
        ),
      ].join("\n") + "\n",
    );

    // Fixed clock: the fixtures' timestamps must sit inside the stall window.
    const store = new RunStore({
      eventLogPath: logPath,
      defaultEnergy: 100,
      now: () => Date.parse("2026-09-12T00:06:00.000Z"),
      stalledAfterMs: 10 * 60_000,
    });
    const runs = await store.listRuns();

    assert.deepEqual(
      runs.map((run) => run.runId),
      // run-1 holds the newest event (00:05 vs run-2's 00:01), so it sorts first.
      ["run-1", "run-2"],
    );
    const byId = new Map(runs.map((run) => [run.runId, run]));
    assert.equal(byId.get("run-1")?.eventCount, 2);
    assert.equal(byId.get("run-2")?.eventCount, 2);
    assert.equal(byId.get("run-1")?.eventsByType.GENERATION_COMPLETED, 1);
    assert.equal(byId.get("run-2")?.status, "running");
  });

  it("summarizes one run identically to buildRunReport on the filtered slice", async () => {
    const store = new RunStore({ eventLogPath: logPath, defaultEnergy: 100 });
    const summary = await store.summarizeRun("run-1");
    assert.ok(summary);

    const events = await new EventLog(logPath).readAll();
    const expected = buildRunReport({
      eventLog: logPath,
      events: events.filter((item) => item.runId === "run-1"),
      initialEnergy: 100,
    });

    assert.deepEqual(summary, { ...expected, status: summary.status });
    assert.equal(summary.eventCount, expected.eventCount);
    assert.deepEqual(summary.agents, expected.agents);
  });

  it("derives completed status from EXPERIMENT_RUN_COMPLETED", async () => {
    await writeFile(
      logPath,
      [
        JSON.stringify(event("done-run", "GENERATION_STARTED")),
        JSON.stringify(event("done-run", "EXPERIMENT_RUN_COMPLETED")),
      ].join("\n") + "\n",
    );
    const store = new RunStore({ eventLogPath: logPath, defaultEnergy: 100 });
    const runs = await store.listRuns();
    assert.equal(runs[0]?.status, "completed");
  });

  it("derives error status from REPAIR_ERROR even after a completion", async () => {
    await writeFile(
      logPath,
      [
        JSON.stringify(event("err-run", "REPAIR_COMPLETED")),
        JSON.stringify(event("err-run", "REPAIR_ERROR")),
      ].join("\n") + "\n",
    );
    const store = new RunStore({ eventLogPath: logPath, defaultEnergy: 100 });
    const runs = await store.listRuns();
    assert.equal(runs[0]?.status, "error");
  });

  it("reports a quiet run as stalled and a fresh one as running", async () => {
    await writeFile(
      logPath,
      JSON.stringify(
        event("stall-run", "GENERATION_STARTED", {
          timestamp: "2026-09-12T00:00:00.000Z",
        }),
      ) + "\n",
    );
    const fixedNow = Date.parse("2026-09-12T01:00:00.000Z");
    const stalled = new RunStore({
      eventLogPath: logPath,
      defaultEnergy: 100,
      now: () => fixedNow,
      stalledAfterMs: 60_000,
    });
    assert.equal((await stalled.listRuns())[0]?.status, "stalled");

    const fresh = new RunStore({
      eventLogPath: logPath,
      defaultEnergy: 100,
      now: () => Date.parse("2026-09-12T00:00:30.000Z"),
      stalledAfterMs: 60_000,
    });
    assert.equal((await fresh.listRuns())[0]?.status, "running");
  });

  it("flags a ledger replay mismatch as a warning instead of failing", async () => {
    await writeFile(
      logPath,
      [energyDebit(50, 40)]
        .map((item) => JSON.stringify(item))
        .join("\n") + "\n",
    );
    const store = new RunStore({ eventLogPath: logPath, defaultEnergy: 100 });
    const summary = await store.summarizeRun("energy-run");
    assert.ok(summary);
    assert.equal(summary.agents.length, 1);
    assert.equal(summary.agents[0]?.energy, null);
    assert.ok(
      summary.warnings.some((warning) => warning.includes("energy ledger")),
    );
  });

  it("returns null for an unknown run and empty list without a log", async () => {
    const store = new RunStore({ eventLogPath: logPath, defaultEnergy: 100 });
    assert.equal(await store.summarizeRun("no-such-run"), null);

    const missing = new RunStore({
      eventLogPath: join(directory, "absent.jsonl"),
      defaultEnergy: 100,
    });
    assert.deepEqual(await missing.listRuns(), []);
  });
});
