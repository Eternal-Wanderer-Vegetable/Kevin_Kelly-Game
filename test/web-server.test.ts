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
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { ExperimentEvent } from "../src/contracts/index.js";
import {
  startWebUiServer,
  type RunningWebUiServer,
} from "../src/web/server.js";

describe("web server", () => {
  let directory: string;
  let logPath: string;
  let artifactsDir: string;
  let sequence = 0;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "harness-web-server-"));
    logPath = join(directory, "events.jsonl");
    artifactsDir = join(directory, "artifacts");
  });

  after(async () => {
    await writeFile(logPath, "").catch(() => {});
  });

  const event = (runId: string, type: string): ExperimentEvent => {
    sequence += 1;
    return {
      schemaVersion: 1,
      eventId: `event-${sequence}`,
      runId,
      timestamp: "2026-09-12T00:00:00.000Z",
      type,
      payload: {},
    };
  };

  const writeLog = async (events: readonly ExperimentEvent[]) => {
    await writeFile(
      logPath,
      events.map((item) => JSON.stringify(item)).join("\n") + "\n",
    );
  };

  const start = (
    extra: {
      artifactsDir?: string;
      staticRoot?: string;
      token?: string;
    } = {},
  ): Promise<{ server: RunningWebUiServer; base: string }> =>
    startWebUiServer({
      host: "127.0.0.1",
      port: 0,
      eventLogPath: logPath,
      defaultEnergy: 100,
      pollIntervalMs: 25,
      ...(extra.artifactsDir === undefined
        ? {}
        : { artifactsDir: extra.artifactsDir }),
      ...(extra.staticRoot === undefined
        ? {}
        : { staticRoot: extra.staticRoot }),
      ...(extra.token === undefined ? {} : { token: extra.token }),
    }).then((server) => ({
      server,
      base: `http://127.0.0.1:${server.port}`,
    }));

  it("serves an empty run list when the log does not exist yet", async () => {
    const { server, base } = await start();
    try {
      const response = await fetch(`${base}/api/runs`);
      assert.equal(response.status, 200);
      assert.deepEqual(((await response.json()) as { runs: unknown[] }).runs, []);
    } finally {
      await server.close();
    }
  });

  it("lists runs and returns a run summary", async () => {
    await writeLog([
      event("run-1", "GENERATION_STARTED"),
      event("run-1", "EXPERIMENT_RUN_COMPLETED"),
    ]);
    const { server, base } = await start();
    try {
      const runs = (await (await fetch(`${base}/api/runs`)).json()) as {
        runs: readonly {
          runId: string;
          status: string;
        }[];
      };
      assert.equal(runs.runs.length, 1);
      assert.equal(runs.runs[0]?.status, "completed");

      const summary = (await (
        await fetch(`${base}/api/runs/run-1/summary`)
      ).json()) as { runId: string; status: string; eventCount: number };
      assert.equal(summary.runId, "run-1");
      assert.equal(summary.status, "completed");
      assert.equal(summary.eventCount, 2);

      const missing = await fetch(`${base}/api/runs/nope/summary`);
      assert.equal(missing.status, 404);
    } finally {
      await server.close();
    }
  });

  it("tails events incrementally and honours the type filter", async () => {
    await writeLog([event("run-1", "GENERATION_STARTED")]);
    const { server, base } = await start();
    try {
      interface EventsResponse {
        readonly events: readonly { runId: string }[];
        readonly nextOffset: number;
        readonly skipped: number;
      }
      const first = (await (
        await fetch(`${base}/api/events`)
      ).json()) as EventsResponse;
      assert.equal(first.events.length, 1);

      await writeLog([
        event("run-1", "GENERATION_STARTED"),
        event("run-1", "GENERATION_COMPLETED"),
        event("run-2", "GENERATION_COMPLETED"),
      ]);
      const second = (await (
        await fetch(`${base}/api/events?after=${first.nextOffset}`)
      ).json()) as EventsResponse;
      assert.equal(second.events.length, 2);

      const filtered = (await (
        await fetch(
          `${base}/api/events?run=run-1&type=GENERATION_COMPLETED&after=0`,
        )
      ).json()) as EventsResponse;
      assert.equal(filtered.events.length, 1);
      assert.equal(filtered.events[0]?.runId, "run-1");
    } finally {
      await server.close();
    }
  });

  it("pushes appended events over SSE", async () => {
    await writeLog([event("run-1", "GENERATION_STARTED")]);
    const { server, base } = await start();
    try {
      const controller = new AbortController();
      const response = await fetch(`${base}/api/stream?after=0`, {
        signal: controller.signal,
        headers: { accept: "text/event-stream" },
      });
      assert.equal(response.status, 200);
      assert.ok(response.body);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let received = "";
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const chunk = await reader.read();
        if (chunk.done) break;
        received += decoder.decode(chunk.value);
        if (received.includes("GENERATION_STARTED")) break;
      }
      controller.abort();
      assert.ok(received.includes("event: batch"), `got: ${received}`);
      assert.ok(received.includes("GENERATION_STARTED"), `got: ${received}`);
      assert.ok(received.includes("id: "), `got: ${received}`);
    } finally {
      await server.close();
    }
  });

  it("keeps the server open when unauthenticated, guarded when a token is set", async () => {
    await writeLog([event("run-1", "GENERATION_STARTED")]);
    const { server, base } = await start({ token: "sekrit" });
    try {
      assert.equal((await fetch(`${base}/api/runs`)).status, 401);
      assert.equal(
        (
          await fetch(`${base}/api/runs`, {
            headers: { authorization: "Bearer wrong" },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await fetch(`${base}/api/runs`, {
            headers: { authorization: "Bearer sekrit" },
          })
        ).status,
        200,
      );
      assert.equal(
        (await fetch(`${base}/api/runs?token=sekrit`)).status,
        200,
      );
    } finally {
      await server.close();
    }
  });

  it("answers 404 for unknown API routes and 405 for writes", async () => {
    const { server, base } = await start();
    try {
      assert.equal((await fetch(`${base}/api/nope`)).status, 404);
      assert.equal(
        (
          await fetch(`${base}/api/runs`, { method: "POST" })
        ).status,
        405,
      );
    } finally {
      await server.close();
    }
  });

  it("serves the built SPA with a fallback route, or 503 when unbuilt", async () => {
    const webRoot = join(directory, "webroot");
    await mkdir(webRoot, { recursive: true });
    await writeFile(join(webRoot, "index.html"), "<html>dashboard</html>");

    const built = await start({ staticRoot: webRoot });
    try {
      const root = await fetch(`${built.base}/`);
      assert.equal(root.status, 200);
      assert.equal(root.headers.get("content-type"), "text/html; charset=utf-8");
      assert.ok((await root.text()).includes("dashboard"));

      const fallback = await fetch(`${built.base}/runs/some-run-id`);
      assert.equal(fallback.status, 200);
      assert.ok((await fallback.text()).includes("dashboard"));
    } finally {
      await built.server.close();
    }

    const unbuilt = await start();
    try {
      assert.equal((await fetch(`${unbuilt.base}/`)).status, 503);
    } finally {
      await unbuilt.server.close();
    }
  });

  it("lists and previews artifacts read-only, refusing escapes", async () => {
    await mkdir(join(artifactsDir, "repair-1"), { recursive: true });
    await writeFile(
      join(artifactsDir, "repair-1", "report.json"),
      '{"ok":true}',
    );

    const { server, base } = await start({ artifactsDir });
    try {
      const listing = (await (
        await fetch(`${base}/api/artifacts`)
      ).json()) as {
        entries: readonly { path: string }[];
      };
      assert.deepEqual(
        listing.entries.map((entry: { path: string }) => entry.path).sort(),
        ["repair-1", "repair-1/report.json"],
      );

      const file = await fetch(`${base}/api/artifacts/repair-1/report.json`);
      assert.equal(file.status, 200);
      assert.equal(
        ((await file.json()) as { content: string }).content,
        '{"ok":true}',
      );

      const escape = await fetch(
        `${base}/api/artifacts/..%2F..%2Fpackage.json`,
      );
      assert.equal(escape.status, 400);
    } finally {
      await server.close();
    }
  });

  it("answers 404 for artifacts when the directory is not configured", async () => {
    const { server, base } = await start();
    try {
      assert.equal((await fetch(`${base}/api/artifacts`)).status, 404);
    } finally {
      await server.close();
    }
  });
});
