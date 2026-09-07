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

import type { HarnessConfig } from "../config.js";
import type {
  AgentAction,
  CognitionProvider,
  CognitionRequest,
} from "../core/agent-core.js";
import { TOOL_NAMES } from "../environment/tool-registry.js";

export type ModelTier = "local" | "external";

export interface OpenAiCompatibleOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly tier: ModelTier;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly maxOutputTokens?: number;
  readonly systemPrompt?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface ModelCallCount {
  readonly localModelCalls: number;
  readonly externalModelCalls: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 512;
const ERROR_BODY_LIMIT = 500;

/**
 * The tool list is generated from TOOL_NAMES rather than copied into a string
 * so a new tool cannot silently go unmentioned to the model.
 */
export function buildSystemPrompt(): string {
  const tools = TOOL_NAMES.join(", ");
  return [
    "You are an agent inside an Evolving Coding Harness sandbox.",
    `Exactly one action per turn, using one of these tools: ${tools}.`,
    'Reply with a single JSON object and nothing else: {"type": "<tool>", "input": {...}}',
    "No prose, no explanation, no markdown fences.",
    "All file paths are relative to the workspace root. Never use absolute paths.",
  ].join("\n");
}

export class OpenAiCompatibleProvider implements CognitionProvider {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly systemPrompt: string;
  private readonly fetchImpl: typeof fetch;
  private localModelCalls = 0;
  private externalModelCalls = 0;

  public constructor(private readonly options: OpenAiCompatibleOptions) {
    if (options.baseUrl.trim() === "") {
      throw new TypeError("baseUrl must not be empty");
    }
    if (options.model.trim() === "") {
      throw new TypeError("model must not be empty");
    }
    this.endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.systemPrompt = options.systemPrompt ?? buildSystemPrompt();
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  public async think(request: CognitionRequest): Promise<AgentAction> {
    this.recordCall();
    const content = await this.requestCompletion(request);
    return parseAgentAction(content);
  }

  /**
   * ResourceMeter takes call counts as constructor arguments, so callers read
   * this after the run and construct the meter or UsageRecord afterwards.
   */
  public callCount(): ModelCallCount {
    return {
      localModelCalls: this.localModelCalls,
      externalModelCalls: this.externalModelCalls,
    };
  }

  public describe(): {
    readonly baseUrl: string;
    readonly model: string;
    readonly tier: ModelTier;
    readonly apiKeySet: boolean;
  } {
    // Never expose the key itself: this feeds debugging output and logs.
    return {
      baseUrl: this.options.baseUrl,
      model: this.options.model,
      tier: this.options.tier,
      apiKeySet:
        this.options.apiKey !== undefined && this.options.apiKey !== "",
    };
  }

  private recordCall(): void {
    if (this.options.tier === "local") {
      this.localModelCalls += 1;
    } else {
      this.externalModelCalls += 1;
    }
  }

  private async requestCompletion(request: CognitionRequest): Promise<string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.options.apiKey !== undefined && this.options.apiKey !== "") {
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }

    const body = JSON.stringify({
      model: this.options.model,
      max_tokens: this.options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      temperature: 0,
      messages: [
        { role: "system", content: this.systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            agentId: request.agentId,
            observation: request.observation,
          }),
        },
      ],
    });

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(
          `provider request timed out after ${this.timeoutMs}ms`,
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`provider request failed: ${reason}`);
    }

    if (!response.ok) {
      const detail = await readErrorBody(response);
      throw new Error(
        `provider responded with status ${response.status}: ${detail}`,
      );
    }

    return extractMessageContent(await response.json());
  }
}

/**
 * Parses the model's reply into an AgentAction.
 *
 * A malformed reply throws rather than degrading to NOOP. During debugging a
 * silent NOOP is indistinguishable from an agent that legitimately decided to
 * do nothing, which hides exactly the failure worth seeing.
 */
export function parseAgentAction(content: string): AgentAction {
  const payload = stripCodeFence(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error(
      `provider returned unparseable JSON: ${truncate(content, 200)}`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error(
      `provider action must be a JSON object: ${truncate(content, 200)}`,
    );
  }

  const type = parsed.type;
  if (typeof type !== "string" || !isToolName(type)) {
    throw new Error(
      `provider action type must be one of ${TOOL_NAMES.join(", ")}, received ${String(type)}`,
    );
  }

  const rawInput = parsed.input;
  const input = rawInput === undefined ? {} : rawInput;
  if (!isPlainObject(input)) {
    throw new Error("provider action input must be a JSON object");
  }

  return { type, input };
}

export function createProviderFromConfig(
  config: HarnessConfig,
  tier: ModelTier,
  env: Readonly<Record<string, string | undefined>> = process.env,
): OpenAiCompatibleProvider {
  if (tier === "external") {
    const baseUrl = config.externalModelUrl;
    if (baseUrl === undefined) {
      throw new Error(
        "externalModelUrl is not configured; set HARNESS_EXTERNAL_MODEL_URL to use the external tier",
      );
    }
    const apiKey = readKey(env, "HARNESS_EXTERNAL_MODEL_KEY");
    const model = readKey(env, "HARNESS_EXTERNAL_MODEL_NAME") ?? "gpt-4o-mini";
    return new OpenAiCompatibleProvider({
      baseUrl,
      model,
      tier,
      ...(apiKey === undefined ? {} : { apiKey }),
    });
  }

  const apiKey = readKey(env, "HARNESS_LOCAL_MODEL_KEY");
  const model = readKey(env, "HARNESS_LOCAL_MODEL_NAME") ?? "local-model";
  return new OpenAiCompatibleProvider({
    baseUrl: config.localModelUrl,
    model,
    tier,
    ...(apiKey === undefined ? {} : { apiKey }),
  });
}

function readKey(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function extractMessageContent(payload: unknown): string {
  if (!isPlainObject(payload)) {
    throw new Error("provider response body must be a JSON object");
  }
  const choices = payload.choices;
  if (!Array.isArray(choices)) {
    throw new Error("provider response is missing a choices array");
  }
  // noUncheckedIndexedAccess: an empty array yields undefined here.
  const first = choices[0];
  if (!isPlainObject(first)) {
    throw new Error("provider response contained no usable choice");
  }
  const message = first.message;
  if (!isPlainObject(message)) {
    throw new Error("provider choice is missing a message object");
  }
  const content = message.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("provider message content is empty");
  }
  return content;
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpening = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "");
  return withoutOpening.replace(/\n?```\s*$/, "").trim();
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return truncate((await response.text()).trim(), ERROR_BODY_LIMIT);
  } catch {
    return "<unreadable response body>";
  }
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.name === "TimeoutError";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

function isToolName(value: string): value is (typeof TOOL_NAMES)[number] {
  return (TOOL_NAMES as readonly string[]).includes(value);
}
