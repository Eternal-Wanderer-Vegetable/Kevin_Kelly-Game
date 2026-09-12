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
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { ExperimentEvent } from "../src/contracts/index.js";
import { statEventsFile, tailEvents } from "../src/web/tail.js";

describe("tailEvents", () => {
  let directory: string;
  let logPath: string;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "harness-tail-"));
    logPath = join(directory, "events.jsonl");
  });

  after(async () => {
    await writeFile(logPath, "").catch(() => {});
  });

  const event = (suffix: string): ExperimentEvent => ({
    schemaVersion: 1,
    eventId: `event-${suffix}`,
    runId: "run-1",
    timestamp: "2026-09-12T00:00:00.000Z",
    type: "GENERATION_STARTED",
    payload: {},
  });

  const line = (suffix: string): string =>
    `${JSON.stringify(event(suffix))}\n`;

  it("returns every event on a fresh tail and reports the end offset", async () => {
    await writeFile(logPath, line("a") + line("b") + line("c"));
    const result = await tailEvents(logPath, 0);
    assert.equal(result.events.length, 3);
    assert.equal(result.skipped, 0);
    const status = await statEventsFile(logPath);
    assert.ok(status);
    assert.equal(result.nextOffset, status.size);
  });

  it("returns only the events after the last offset", async () => {
    const first = await tailEvents(logPath, 0);
    await appendFile(logPath, line("d") + line("e"));
    const second = await tailEvents(logPath, first.nextOffset);
    assert.deepEqual(
      second.events.map((item) => item.eventId),
      ["event-d", "event-e"],
    );
  });

  it("holds back a partial line until the writer finishes it", async () => {
    const before = await statEventsFile(logPath);
    assert.ok(before);
    await appendFile(logPath, JSON.stringify(event("partial")));
    const incomplete = await tailEvents(logPath, before.size);
    assert.equal(incomplete.events.length, 0);
    assert.equal(incomplete.nextOffset, before.size);

    await appendFile(logPath, "\n");
    const complete = await tailEvents(logPath, before.size);
    assert.deepEqual(
      complete.events.map((item) => item.eventId),
      ["event-partial"],
    );
  });

  it("skips corrupt lines without losing the offset or the neighbours", async () => {
    const before = await statEventsFile(logPath);
    assert.ok(before);
    await appendFile(logPath, "not json\n" + line("after-bad"));
    const result = await tailEvents(logPath, before.size);
    assert.deepEqual(
      result.events.map((item) => item.eventId),
      ["event-after-bad"],
    );
    assert.equal(result.skipped, 1);
    const status = await statEventsFile(logPath);
    assert.ok(status);
    assert.equal(result.nextOffset, status.size);
  });

  it("skips a line that parses but violates the event contract", async () => {
    const before = await statEventsFile(logPath);
    assert.ok(before);
    await appendFile(logPath, '{"schemaVersion":2,"oops":true}\n');
    const result = await tailEvents(logPath, before.size);
    assert.equal(result.events.length, 0);
    assert.equal(result.skipped, 1);
  });

  it("advances past blank lines silently", async () => {
    const before = await statEventsFile(logPath);
    assert.ok(before);
    await appendFile(logPath, "\n" + line("after-blank"));
    const result = await tailEvents(logPath, before.size);
    assert.deepEqual(
      result.events.map((item) => item.eventId),
      ["event-after-blank"],
    );
    assert.equal(result.skipped, 0);
  });

  it("stops at the limit and resumes from the reported offset", async () => {
    const before = await statEventsFile(logPath);
    assert.ok(before);
    await appendFile(logPath, line("l1") + line("l2") + line("l3"));
    const first = await tailEvents(logPath, before.size, 2);
    assert.deepEqual(
      first.events.map((item) => item.eventId),
      ["event-l1", "event-l2"],
    );
    const second = await tailEvents(logPath, first.nextOffset);
    assert.deepEqual(
      second.events.map((item) => item.eventId),
      ["event-l3"],
    );
  });

  it("treats a missing file as an empty tail and reports null status", async () => {
    const missing = join(directory, "absent.jsonl");
    const result = await tailEvents(missing, 128);
    assert.equal(result.events.length, 0);
    assert.equal(result.nextOffset, 128);
    assert.equal(await statEventsFile(missing), null);
  });

  it("resyncs to end of file when the offset is past it", async () => {
    const status = await statEventsFile(logPath);
    assert.ok(status);
    const result = await tailEvents(logPath, status.size + 4096);
    assert.equal(result.events.length, 0);
    assert.equal(result.nextOffset, status.size);
  });
});
