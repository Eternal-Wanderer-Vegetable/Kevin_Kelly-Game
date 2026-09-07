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

import type {
  AgentAction,
  CognitionProvider,
  CognitionRequest,
} from "../core/agent-core.js";
import type {
  QueueMetrics,
  SharedSlmQueue,
} from "../scheduler/shared-slm-queue.js";

export interface QueuedCognitionOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Serialises cognition calls through a SharedSlmQueue.
 *
 * The queue stays outside the provider so a bare provider remains usable for
 * single-agent debugging, and scheduling semantics are composed in at the CLI
 * layer rather than baked into every provider.
 */
export class QueuedCognitionProvider implements CognitionProvider {
  private lastMetrics: QueueMetrics | undefined;

  public constructor(
    private readonly inner: CognitionProvider,
    private readonly queue: SharedSlmQueue,
    private readonly options: QueuedCognitionOptions = {},
  ) {}

  public async think(request: CognitionRequest): Promise<AgentAction> {
    try {
      const result = await this.queue.enqueue<AgentAction>({
        agentId: request.agentId,
        execute: () => this.inner.think(request),
        ...(this.options.timeoutMs === undefined
          ? {}
          : { timeoutMs: this.options.timeoutMs }),
        ...(this.options.signal === undefined
          ? {}
          : { signal: this.options.signal }),
      });
      this.lastMetrics = result.metrics;
      return result.value;
    } catch (error) {
      // SharedSlmQueue rejects with a QueueFailure object, not an Error, so
      // `error instanceof Error` upstream would otherwise stringify an object.
      throw toError(error, request.agentId);
    }
  }

  public metrics(): QueueMetrics | undefined {
    return this.lastMetrics;
  }
}

function toError(error: unknown, agentId: string): Error {
  if (error instanceof Error) return error;
  if (isQueueFailure(error)) {
    return new Error(
      `cognition queue rejected agent ${error.agentId}: ${error.reason}`,
    );
  }
  return new Error(
    `cognition queue rejected agent ${agentId}: ${String(error)}`,
  );
}

function isQueueFailure(
  value: unknown,
): value is { readonly agentId: string; readonly reason: string } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.agentId === "string" && typeof candidate.reason === "string"
  );
}
