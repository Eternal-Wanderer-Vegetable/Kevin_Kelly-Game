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

import type { TaskSpec } from "../contracts/index.js";
import { assertTaskSpec } from "../contracts/index.js";

export type TaskClaimStatus = "available" | "claimed" | "completed";

export interface PooledTask {
  readonly task: TaskSpec;
  readonly status: TaskClaimStatus;
  readonly claimedBy: string | null;
}

/**
 * A shared task pool — the minimal form of "resource discovery": tasks live
 * in the environment and agents claim them, instead of every task being
 * assigned top-down. A task can only be claimed by one living agent at a
 * time, and a dead agent's claim is released so work is not lost with it.
 */
export class TaskPool {
  private readonly tasks = new Map<string, PooledTask>();

  public register(task: TaskSpec): void {
    assertTaskSpec(task);
    if (this.tasks.has(task.taskId)) {
      throw new Error(`task is already registered: ${task.taskId}`);
    }
    this.tasks.set(task.taskId, {
      task,
      status: "available",
      claimedBy: null,
    });
  }

  public available(agentId: string): readonly TaskSpec[] {
    return [...this.tasks.values()]
      .filter(
        (entry) =>
          entry.status === "available" ||
          (entry.status === "claimed" && entry.claimedBy === agentId),
      )
      .map((entry) => entry.task);
  }

  public claim(agentId: string, taskId: string): TaskSpec {
    const entry = this.tasks.get(taskId);
    if (entry === undefined) throw new Error(`unknown task: ${taskId}`);
    if (entry.status === "completed") {
      throw new Error(`task is already completed: ${taskId}`);
    }
    if (entry.status === "claimed" && entry.claimedBy !== agentId) {
      throw new Error(`task is claimed by another agent: ${taskId}`);
    }
    this.tasks.set(taskId, { ...entry, status: "claimed", claimedBy: agentId });
    return entry.task;
  }

  public complete(taskId: string): void {
    const entry = this.tasks.get(taskId);
    if (entry === undefined) throw new Error(`unknown task: ${taskId}`);
    this.tasks.set(taskId, { ...entry, status: "completed" });
  }

  /** Releases claims held by an agent that died or went dormant. */
  public releaseAgent(agentId: string): readonly string[] {
    const released: string[] = [];
    for (const [taskId, entry] of this.tasks) {
      if (entry.status === "claimed" && entry.claimedBy === agentId) {
        this.tasks.set(taskId, { ...entry, status: "available", claimedBy: null });
        released.push(taskId);
      }
    }
    return released;
  }

  public get(taskId: string): PooledTask {
    const entry = this.tasks.get(taskId);
    if (entry === undefined) throw new Error(`unknown task: ${taskId}`);
    return entry;
  }
}
