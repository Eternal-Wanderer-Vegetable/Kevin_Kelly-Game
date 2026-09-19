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

export interface QueueRequest<T> {
  readonly agentId: string;
  readonly execute: () => Promise<T>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /**
   * Larger values run first; equal priorities keep FIFO order. Defaults to 0.
   * Priority only orders pending requests — a running request is never
   * preempted, so a high-priority request cannot starve one already executing.
   */
  readonly priority?: number;
}

export interface QueueMetrics {
  readonly agentId: string;
  readonly queuedAt: number;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly waitMs: number;
  readonly executionMs: number;
}

export interface QueueResult<T> {
  readonly value: T;
  readonly metrics: QueueMetrics;
}

export interface QueueFailure {
  readonly agentId: string;
  readonly reason: string;
  readonly metrics: QueueMetrics;
}

/**
 * Per-agent scheduling history. Experiment plans require these counters so a
 * harness difference can be told apart from scheduling luck: an agent that
 * lost repeatedly because it queued behind others looks different from one
 * whose cognition was genuinely slower.
 */
export interface AgentQueueStats {
  readonly agentId: string;
  readonly enqueued: number;
  readonly completed: number;
  readonly failed: number;
  readonly totalWaitMs: number;
  readonly totalExecutionMs: number;
}

export class SharedSlmQueue {
  private readonly pending: Array<{
    request: QueueRequest<unknown>;
    queuedAt: number;
    sequence: number;
    resolve: (result: QueueResult<unknown>) => void;
    reject: (error: QueueFailure) => void;
  }> = [];
  private readonly stats = new Map<string, {
    enqueued: number;
    completed: number;
    failed: number;
    totalWaitMs: number;
    totalExecutionMs: number;
  }>();
  private sequence = 0;
  private running = false;

  public enqueue<T>(request: QueueRequest<T>): Promise<QueueResult<T>> {
    return new Promise((resolve, reject) => {
      const priority = request.priority ?? 0;
      if (!Number.isFinite(priority)) {
        reject({
          agentId: request.agentId,
          reason: "queue priority must be a finite number",
          metrics: {
            agentId: request.agentId,
            queuedAt: Date.now(),
            startedAt: Date.now(),
            finishedAt: Date.now(),
            waitMs: 0,
            executionMs: 0,
          },
        });
        return;
      }
      this.statsFor(request.agentId).enqueued += 1;
      this.pending.push({
        request: request as QueueRequest<unknown>,
        queuedAt: Date.now(),
        sequence: this.sequence++,
        resolve: resolve as (result: QueueResult<unknown>) => void,
        reject,
      });
      // Keep pending sorted by priority (desc) then arrival order (asc), so
      // processNext can always shift() the head.
      this.pending.sort(
        (a, b) =>
          (b.request.priority ?? 0) - (a.request.priority ?? 0) ||
          a.sequence - b.sequence,
      );
      void this.processNext();
    });
  }

  public size(): number {
    return this.pending.length + (this.running ? 1 : 0);
  }

  public statsByAgent(): readonly AgentQueueStats[] {
    return [...this.stats.entries()].map(([agentId, entry]) => ({
      agentId,
      ...entry,
    }));
  }

  private async processNext(): Promise<void> {
    if (this.running) return;
    const item = this.pending.shift();
    if (!item) return;
    this.running = true;
    const { queuedAt } = item;
    const { request } = item;
    const startedAt = Date.now();
    const metricsBase = {
      agentId: request.agentId,
      queuedAt,
      startedAt,
      finishedAt: startedAt,
      waitMs: startedAt - queuedAt,
      executionMs: 0,
    };
    const stats = this.statsFor(request.agentId);
    try {
      if (request.signal?.aborted) throw new Error("queue request cancelled");
      const value = await withTimeout(request.execute(), request.timeoutMs);
      const finishedAt = Date.now();
      stats.completed += 1;
      stats.totalWaitMs += startedAt - queuedAt;
      stats.totalExecutionMs += finishedAt - startedAt;
      item.resolve({
        value,
        metrics: {
          ...metricsBase,
          finishedAt,
          executionMs: finishedAt - startedAt,
        },
      });
    } catch (error) {
      const finishedAt = Date.now();
      stats.failed += 1;
      stats.totalWaitMs += startedAt - queuedAt;
      stats.totalExecutionMs += finishedAt - startedAt;
      item.reject({
        agentId: request.agentId,
        reason: error instanceof Error ? error.message : String(error),
        metrics: {
          ...metricsBase,
          finishedAt,
          executionMs: finishedAt - startedAt,
        },
      });
    } finally {
      this.running = false;
      void this.processNext();
    }
  }

  private statsFor(agentId: string): {
    enqueued: number;
    completed: number;
    failed: number;
    totalWaitMs: number;
    totalExecutionMs: number;
  } {
    let entry = this.stats.get(agentId);
    if (entry === undefined) {
      entry = {
        enqueued: 0,
        completed: 0,
        failed: 0,
        totalWaitMs: 0,
        totalExecutionMs: 0,
      };
      this.stats.set(agentId, entry);
    }
    return entry;
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs = 30_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("queue request timed out"));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    // A timed-out request may not be cancellable. Keep the shared resource
    // occupied until it settles so the next queued request remains isolated.
    if (timedOut) await operation.catch(() => {});
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
