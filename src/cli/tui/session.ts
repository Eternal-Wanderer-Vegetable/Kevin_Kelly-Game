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
  AgentCore,
  AgentTurnResult,
  EnvironmentInterface,
  Observation,
} from "../../core/agent-core.js";

export interface ReplTurn {
  readonly index: number;
  readonly observation: Observation;
  readonly action: AgentAction;
  readonly outcome: Readonly<Record<string, unknown>>;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly error?: string;
}

export interface ReplEnvironment extends EnvironmentInterface {
  setGoal(goal: string): void;
  getGoal(): string;
  listFiles(): Promise<readonly string[]>;
}

export interface ReplSessionRuntime {
  readonly agent: AgentCore;
  readonly environment: ReplEnvironment;
  dispose(): Promise<void>;
  describeProvider?(): Readonly<Record<string, unknown>>;
  getPatch?(): Promise<string>;
}

export interface ReplSessionOptions {
  readonly runtime: ReplSessionRuntime;
  readonly createRuntime?: (goal: string) => Promise<ReplSessionRuntime>;
  readonly now?: () => number;
}

export class ReplSession {
  private readonly now: () => number;
  private readonly history: ReplTurn[] = [];
  private runtime: ReplSessionRuntime;
  private activeStep: Promise<ReplTurn> | undefined;
  private runningController: AbortController | undefined;
  private disposed = false;

  public constructor(private readonly options: ReplSessionOptions) {
    this.runtime = options.runtime;
    this.now = options.now ?? Date.now;
  }

  public async step(signal?: AbortSignal): Promise<ReplTurn> {
    return this.stepInternal(signal, false);
  }

  private async stepInternal(
    signal: AbortSignal | undefined,
    fromRun: boolean,
  ): Promise<ReplTurn> {
    this.ensureUsable();
    throwIfAborted(signal);
    if (this.activeStep !== undefined || (this.runningController !== undefined && !fromRun)) {
      throw new Error("a REPL turn is already in progress");
    }

    const index = this.history.length + 1;
    const startedAt = this.now();
    const operation = this.executeStep(index, startedAt);
    this.activeStep = operation;

    try {
      return await operation;
    } finally {
      if (this.activeStep === operation) this.activeStep = undefined;
    }
  }

  public async *run(
    maxTurns: number,
    signal?: AbortSignal,
  ): AsyncGenerator<ReplTurn, void, undefined> {
    this.ensureUsable();
    if (!Number.isInteger(maxTurns) || maxTurns < 1) {
      throw new RangeError("maxTurns must be a positive integer");
    }
    if (this.runningController !== undefined) {
      throw new Error("a REPL run is already in progress");
    }

    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    this.runningController = controller;

    try {
      for (let index = 0; index < maxTurns; index += 1) {
        if (controller.signal.aborted) break;
        const turn = await this.stepInternal(controller.signal, true);
        yield turn;
        if (turn.error !== undefined) break;
      }
    } finally {
      signal?.removeEventListener("abort", forwardAbort);
      if (this.runningController === controller) {
        this.runningController = undefined;
      }
    }
  }

  /**
   * Stops a continuous run at the next turn boundary.
   *
   * AgentCore and CognitionProvider do not currently accept an AbortSignal.
   * Waiting for the in-flight turn to finish keeps reset and workspace
   * disposal from racing with an environment action.
   */
  public stop(): void {
    this.runningController?.abort();
  }

  public turns(): readonly ReplTurn[] {
    return [...this.history];
  }

  public setGoal(goal: string): void {
    this.ensureUsable();
    this.ensureIdle();
    this.runtime.environment.setGoal(goal);
  }

  public getGoal(): string {
    this.ensureUsable();
    return this.runtime.environment.getGoal();
  }

  public getLifecycle(): string {
    this.ensureUsable();
    return this.runtime.agent.getLifecycle();
  }

  public async listFiles(): Promise<readonly string[]> {
    this.ensureUsable();
    return this.runtime.environment.listFiles();
  }

  public async inspect(
    action: AgentAction,
  ): Promise<Readonly<Record<string, unknown>>> {
    this.ensureUsable();
    this.ensureIdle();
    return this.runtime.environment.act(action);
  }

  public describeProvider(): Readonly<Record<string, unknown>> {
    this.ensureUsable();
    return this.runtime.describeProvider?.() ?? { provider: "unknown" };
  }

  public async getPatch(): Promise<string> {
    this.ensureUsable();
    return (
      (await this.runtime.getPatch?.()) ??
      "patch information is unavailable for this runtime\n"
    );
  }

  public async reset(): Promise<void> {
    this.ensureUsable();
    this.ensureIdle();
    if (this.options.createRuntime === undefined) {
      throw new Error("this REPL session cannot reset without a runtime factory");
    }

    const next = await this.options.createRuntime(
      this.runtime.environment.getGoal(),
    );
    await this.replaceRuntime(next);
  }

  public async replaceRuntime(
    runtime: ReplSessionRuntime,
    goal?: string,
  ): Promise<void> {
    this.ensureUsable();
    this.ensureIdle();

    if (goal !== undefined) runtime.environment.setGoal(goal);

    const previous = this.runtime;
    try {
      await previous.dispose();
    } catch (error) {
      await runtime.dispose().catch(() => undefined);
      throw error;
    }

    this.runtime = runtime;
    this.history.length = 0;
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.ensureIdle();
    this.disposed = true;
    await this.runtime.dispose();
  }

  private async executeStep(index: number, startedAt: number): Promise<ReplTurn> {
    let result: AgentTurnResult;
    try {
      result = await this.runtime.agent.runTurn();
    } catch (error) {
      const message = describeError(error);
      const turn: ReplTurn = {
        index,
        observation: {
          kind: "error",
          content: { error: message },
        },
        action: {
          type: "error",
          input: {},
        },
        outcome: { ok: false, error: message },
        startedAt,
        durationMs: elapsedMs(this.now(), startedAt),
        error: message,
      };
      this.history.push(turn);
      return turn;
    }

    const turn: ReplTurn = {
      index,
      observation: result.observation,
      action: result.action,
      outcome: result.outcome,
      startedAt,
      durationMs: elapsedMs(this.now(), startedAt),
    };
    this.history.push(turn);
    return turn;
  }

  private ensureUsable(): void {
    if (this.disposed) throw new Error("REPL session is disposed");
  }

  private ensureIdle(): void {
    if (this.activeStep !== undefined || this.runningController !== undefined) {
      throw new Error("cannot change REPL state while a turn is in progress");
    }
  }
}

function elapsedMs(now: number, startedAt: number): number {
  return Math.max(0, now - startedAt);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw createAbortError();
}

function createAbortError(): Error {
  const error = new Error("REPL operation was aborted");
  error.name = "AbortError";
  return error;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
