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
  EnvironmentInterface,
  Observation,
} from "../core/agent-core.js";
import type { SandboxWorkspace } from "../sandbox/workspace.js";
import {
  createSandboxTools,
  listWorkspaceFiles,
  DEFAULT_MAX_LISTED_FILES,
} from "./sandbox-tools.js";
import {
  type ToolRegistry,
} from "./tool-registry.js";

/**
 * Genome assets the environment should express. Plugins add tools, workflow
 * steps and policy hints are surfaced in observations so the model can see
 * the strategy its genome encodes — that is how heritable assets acquire a
 * phenotype instead of staying inert metadata.
 */
export interface GenomeRuntimeAssets {
  /** Called once with the tool registry after built-ins are registered. */
  readonly registerTools?: (registry: ToolRegistry) => void;
  /** Ordered workflow steps shown in the task-start observation. */
  readonly workflowSteps?: readonly string[];
  /** Policy-derived hints shown in the task-start observation. */
  readonly policyHints?: Readonly<Record<string, unknown>>;
}

export interface SandboxToolEnvironmentOptions {
  readonly workspace: SandboxWorkspace;
  readonly goal: string;
  readonly allowedCommands: readonly string[];
  readonly allowedEnvironment?: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxSearchResults?: number;
  readonly maxListedFiles?: number;
  readonly genome?: GenomeRuntimeAssets;
}

export interface SandboxTurnRecord {
  readonly action: AgentAction;
  readonly outcome: Readonly<Record<string, unknown>>;
}

/**
 * An EnvironmentInterface backed by a real sandbox workspace.
 *
 * Unlike MemoryToolEnvironment, which shifts from a fixed observation list and
 * throws once that list is exhausted, this environment derives each observation
 * from workspace state plus the previous turn's outcome. A fixed list is test
 * fixture semantics; a real agent loop must be able to observe indefinitely.
 *
 * The workspace is not owned here. Creation and disposal belong to the caller,
 * which should use try/finally, matching how runTask handles its workspace.
 */
export class SandboxToolEnvironment implements EnvironmentInterface {
  private readonly tools: ToolRegistry;
  private readonly history: SandboxTurnRecord[] = [];
  private readonly maxListedFiles: number;
  private goal: string;
  private turn = 0;

  public constructor(private readonly options: SandboxToolEnvironmentOptions) {
    this.tools = createSandboxTools(options);
    // Genome tools register after built-ins; a name collision throws, which
    // keeps a plugin from silently shadowing the sandbox-boundary tools.
    options.genome?.registerTools?.(this.tools);
    this.goal = options.goal;
    this.maxListedFiles = options.maxListedFiles ?? DEFAULT_MAX_LISTED_FILES;
  }

  public async observe(): Promise<Observation> {
    const files = await listWorkspaceFiles(
      this.options.workspace.inputRoot,
      this.maxListedFiles,
    );
    const last = this.history.at(-1);

    if (last === undefined) {
      return {
        kind: "task-start",
        content: {
          goal: this.goal,
          // A relative root only. The absolute temporary path stays hidden so
          // the agent has nothing to concatenate its way out of the sandbox with.
          workspaceRoot: ".",
          files,
          allowedCommands: [...this.options.allowedCommands],
          tools: this.tools.names(),
          ...(this.options.genome?.workflowSteps !== undefined &&
          this.options.genome.workflowSteps.length > 0
            ? { workflow: [...this.options.genome.workflowSteps] }
            : {}),
          ...(this.options.genome?.policyHints !== undefined &&
          Object.keys(this.options.genome.policyHints).length > 0
            ? { policy: this.options.genome.policyHints }
            : {}),
        },
      };
    }

    return {
      kind: "tool-outcome",
      content: {
        goal: this.goal,
        turn: this.turn,
        workspaceRoot: ".",
        files,
        lastAction: last.action,
        lastOutcome: last.outcome,
      },
    };
  }

  public async act(
    action: AgentAction,
  ): Promise<Readonly<Record<string, unknown>>> {
    // Registry membership decides: built-ins plus whatever genome plugins
    // registered. Unknown names throw, same as before.
    if (!this.tools.has(action.type)) {
      throw new Error(`unknown tool action: ${action.type}`);
    }

    const result = await this.tools.invoke({
      name: action.type,
      input: action.input,
    });
    const outcome = { ok: result.ok, ...result.output };
    this.turn += 1;
    this.history.push({ action, outcome });
    return outcome;
  }

  /** Replaces the goal carried by subsequent observations. */
  public setGoal(goal: string): void {
    if (goal.trim() === "") {
      throw new TypeError("goal must not be empty");
    }
    this.goal = goal;
  }

  public getGoal(): string {
    return this.goal;
  }

  public turnCount(): number {
    return this.turn;
  }

  public getHistory(): readonly SandboxTurnRecord[] {
    return [...this.history];
  }

  public async listFiles(): Promise<readonly string[]> {
    return listWorkspaceFiles(
      this.options.workspace.inputRoot,
      this.maxListedFiles,
    );
  }
}
