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
import test from "node:test";
import { loadConfig } from "../src/config.js";
import type { CognitionRequest } from "../src/core/agent-core.js";
import { MockCognitionProvider } from "../src/providers/mock-cognition.js";
import {
  createProviderFromConfig,
  OpenAiCompatibleProvider,
} from "../src/providers/openai-compatible.js";
import { QueuedCognitionProvider } from "../src/providers/queued-cognition.js";
import { SharedSlmQueue } from "../src/scheduler/shared-slm-queue.js";

const request: CognitionRequest = {
  agentId: "agent-001",
  observation: { kind: "task-start", content: { goal: "add a test" } },
};

interface CapturedCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function jsonResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function recordingFetch(response: () => Response): {
  readonly fetchImpl: typeof fetch;
  readonly calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      (init?.headers ?? {}) as Record<string, string>,
    )) {
      headers[key] = value;
    }
    calls.push({
      url: String(input),
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return response();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function provider(
  fetchImpl: typeof fetch,
  overrides: { readonly tier?: "local" | "external"; readonly apiKey?: string } = {},
): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    baseUrl: "http://model:8000/v1",
    model: "test-model",
    tier: overrides.tier ?? "local",
    fetchImpl,
    ...(overrides.apiKey === undefined ? {} : { apiKey: overrides.apiKey }),
  });
}

test("think maps a well formed response onto an AgentAction", async () => {
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse('{"type":"read","input":{"path":"src/index.ts"}}'),
  );

  const action = await provider(fetchImpl).think(request);

  assert.deepEqual(action, { type: "read", input: { path: "src/index.ts" } });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, "http://model:8000/v1/chat/completions");
});

test("the request carries a system prompt listing every tool", async () => {
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse('{"type":"test","input":{}}'),
  );

  await provider(fetchImpl).think(request);

  const call = calls[0];
  assert.ok(call);
  const body = call.body as {
    readonly model: string;
    readonly messages: readonly { readonly role: string; readonly content: string }[];
  };
  assert.equal(body.model, "test-model");
  const system = body.messages[0];
  const user = body.messages[1];
  assert.ok(system);
  assert.ok(user);
  assert.equal(system.role, "system");
  for (const name of ["read", "search", "write", "exec", "test"]) {
    assert.match(system.content, new RegExp(name));
  }
  assert.equal(user.role, "user");
  assert.match(user.content, /task-start/);
});

test("a trailing slash on the base URL does not double up", async () => {
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse('{"type":"test","input":{}}'),
  );

  const withSlash = new OpenAiCompatibleProvider({
    baseUrl: "http://model:8000/v1/",
    model: "test-model",
    tier: "local",
    fetchImpl,
  });
  await withSlash.think(request);

  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, "http://model:8000/v1/chat/completions");
});

test("a fenced JSON reply is still parsed", async () => {
  const { fetchImpl } = recordingFetch(() =>
    jsonResponse('```json\n{"type":"write","input":{"path":"a.txt","content":"hi"}}\n```'),
  );

  const action = await provider(fetchImpl).think(request);

  assert.deepEqual(action, {
    type: "write",
    input: { path: "a.txt", content: "hi" },
  });
});

test("a missing input object defaults to empty", async () => {
  const { fetchImpl } = recordingFetch(() => jsonResponse('{"type":"test"}'));

  const action = await provider(fetchImpl).think(request);

  assert.deepEqual(action, { type: "test", input: {} });
});

test("an unknown tool name is rejected rather than degraded to NOOP", async () => {
  const { fetchImpl } = recordingFetch(() =>
    jsonResponse('{"type":"rm-rf","input":{}}'),
  );

  await assert.rejects(
    () => provider(fetchImpl).think(request),
    /action type must be one of read, search, write, exec, test/,
  );
});

test("unparseable output reports the original text", async () => {
  const { fetchImpl } = recordingFetch(() =>
    jsonResponse("I think I should read the file first."),
  );

  await assert.rejects(
    () => provider(fetchImpl).think(request),
    /unparseable JSON: I think I should read the file first\./,
  );
});

test("a non-object reply is rejected", async () => {
  const { fetchImpl } = recordingFetch(() => jsonResponse('["read"]'));

  await assert.rejects(
    () => provider(fetchImpl).think(request),
    /must be a JSON object/,
  );
});

test("a non-2xx response preserves the status code", async () => {
  const fetchImpl = (async () =>
    new Response("model overloaded", { status: 503 })) as unknown as typeof fetch;

  await assert.rejects(
    () => provider(fetchImpl).think(request),
    /status 503: model overloaded/,
  );
});

test("an empty choices array is reported clearly", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  await assert.rejects(
    () => provider(fetchImpl).think(request),
    /no usable choice/,
  );
});

test("an aborted request becomes an explicit timeout error", async () => {
  const fetchImpl = (async () => {
    const error = new Error("aborted");
    error.name = "TimeoutError";
    throw error;
  }) as unknown as typeof fetch;

  const timedOut = new OpenAiCompatibleProvider({
    baseUrl: "http://model:8000/v1",
    model: "test-model",
    tier: "local",
    timeoutMs: 25,
    fetchImpl,
  });

  await assert.rejects(() => timedOut.think(request), /timed out after 25ms/);
});

test("callCount increments the tier that was used", async () => {
  const { fetchImpl } = recordingFetch(() =>
    jsonResponse('{"type":"test","input":{}}'),
  );

  const local = provider(fetchImpl, { tier: "local" });
  await local.think(request);
  await local.think(request);
  assert.deepEqual(local.callCount(), {
    localModelCalls: 2,
    externalModelCalls: 0,
  });

  const external = provider(fetchImpl, { tier: "external" });
  await external.think(request);
  assert.deepEqual(external.callCount(), {
    localModelCalls: 0,
    externalModelCalls: 1,
  });
});

test("a failed call is still counted", async () => {
  const { fetchImpl } = recordingFetch(() => jsonResponse("not json"));
  const failing = provider(fetchImpl);

  await assert.rejects(() => failing.think(request));

  assert.equal(failing.callCount().localModelCalls, 1);
});

test("an API key travels in the authorization header and never in describe", async () => {
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse('{"type":"test","input":{}}'),
  );

  const keyed = provider(fetchImpl, { apiKey: "secret-token" });
  await keyed.think(request);

  const call = calls[0];
  assert.ok(call);
  assert.equal(call.headers.authorization, "Bearer secret-token");
  const described = keyed.describe();
  assert.equal(described.apiKeySet, true);
  assert.equal(JSON.stringify(described).includes("secret-token"), false);
});

test("no authorization header is sent without a key", async () => {
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse('{"type":"test","input":{}}'),
  );

  await provider(fetchImpl).think(request);

  const call = calls[0];
  assert.ok(call);
  assert.equal(call.headers.authorization, undefined);
  assert.equal(provider(fetchImpl).describe().apiKeySet, false);
});

test("the constructor rejects an empty base URL or model", () => {
  assert.throws(
    () =>
      new OpenAiCompatibleProvider({ baseUrl: "", model: "m", tier: "local" }),
    /baseUrl must not be empty/,
  );
  assert.throws(
    () =>
      new OpenAiCompatibleProvider({
        baseUrl: "http://model:8000/v1",
        model: "  ",
        tier: "local",
      }),
    /model must not be empty/,
  );
});

test("createProviderFromConfig reads the local tier from configuration", () => {
  const config = loadConfig({ localModelUrl: "http://model:8000/v1" });
  const created = createProviderFromConfig(config, "local", {
    HARNESS_LOCAL_MODEL_NAME: "qwen-coder",
    HARNESS_LOCAL_MODEL_KEY: "local-secret",
  });

  const described = created.describe();
  assert.equal(described.baseUrl, "http://model:8000/v1");
  assert.equal(described.model, "qwen-coder");
  assert.equal(described.tier, "local");
  assert.equal(described.apiKeySet, true);
});

test("createProviderFromConfig refuses the external tier without a URL", () => {
  const config = loadConfig({});
  assert.throws(
    () => createProviderFromConfig(config, "external", {}),
    /HARNESS_EXTERNAL_MODEL_URL/,
  );
});

test("createProviderFromConfig uses the configured external URL", () => {
  const config = loadConfig({
    externalModelUrl: "https://api.example.com/v1",
  });
  const created = createProviderFromConfig(config, "external", {
    HARNESS_EXTERNAL_MODEL_NAME: "big-model",
  });

  const described = created.describe();
  assert.equal(described.baseUrl, "https://api.example.com/v1");
  assert.equal(described.model, "big-model");
  assert.equal(described.tier, "external");
  assert.equal(described.apiKeySet, false);
});

test("QueuedCognitionProvider forwards the inner action and records metrics", async () => {
  const inner = new MockCognitionProvider({ type: "read", input: { path: "a" } });
  const queued = new QueuedCognitionProvider(inner, new SharedSlmQueue());

  const action = await queued.think(request);

  assert.deepEqual(action, { type: "read", input: { path: "a" } });
  assert.equal(inner.getRequests().length, 1);
  const metrics = queued.metrics();
  assert.ok(metrics);
  assert.equal(metrics.agentId, "agent-001");
});

test("QueuedCognitionProvider serialises concurrent calls", async () => {
  let active = 0;
  let maxActive = 0;
  const inner = {
    async think() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { type: "test", input: {} };
    },
  };
  const queued = new QueuedCognitionProvider(inner, new SharedSlmQueue());

  await Promise.all([
    queued.think(request),
    queued.think(request),
    queued.think(request),
  ]);

  assert.equal(maxActive, 1);
});

test("QueuedCognitionProvider converts a QueueFailure into an Error", async () => {
  const inner = {
    async think(): Promise<never> {
      throw new Error("model exploded");
    },
  };
  const queued = new QueuedCognitionProvider(inner, new SharedSlmQueue());

  // The queue rejects with a plain QueueFailure object; upstream code relies on
  // `error instanceof Error`, so the wrapper must convert it.
  await assert.rejects(
    () => queued.think(request),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /agent-001/);
      assert.match(error.message, /model exploded/);
      return true;
    },
  );
});
