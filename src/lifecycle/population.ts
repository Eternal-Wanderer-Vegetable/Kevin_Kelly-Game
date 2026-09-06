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

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertAgentState,
  CONTRACT_SCHEMA_VERSION,
  type AgentLifecycleState,
  type AgentState,
  type PluginManifest,
} from "../contracts/index.js";
import { EnergyLedger } from "../energy/ledger.js";

export interface PopulationEntry {
  readonly state: AgentState;
  readonly verifiedPlugins: readonly PluginManifest[];
}

export interface PopulationSnapshot {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly generation: number;
  readonly agents: readonly AgentState[];
}

export interface LifecycleFailure {
  readonly agentId: string;
  readonly reason: string;
}

export class PopulationController {
  private readonly entries = new Map<string, PopulationEntry>();
  private readonly failuresList: LifecycleFailure[] = [];

  public constructor(
    private readonly energy: EnergyLedger,
    private readonly archiveRoot: string,
  ) {}

  public register(state: AgentState, verifiedPlugins: readonly PluginManifest[] = []): void {
    assertAgentState(state);
    if (this.entries.has(state.agentId)) {
      throw new Error(`agent is already registered: ${state.agentId}`);
    }
    this.entries.set(state.agentId, {
      state,
      verifiedPlugins: [...verifiedPlugins],
    });
    this.energy.initialize(state.agentId);
  }

  public get(agentId: string): PopulationEntry {
    const entry = this.entries.get(agentId);
    if (!entry) throw new Error(`unknown agent: ${agentId}`);
    return entry;
  }

  public transition(agentId: string, lifecycle: AgentLifecycleState): AgentState {
    const entry = this.get(agentId);
    if (!isAllowedTransition(entry.state.lifecycle, lifecycle)) {
      throw new Error(
        `invalid lifecycle transition: ${entry.state.lifecycle} -> ${lifecycle}`,
      );
    }
    const state = { ...entry.state, lifecycle };
    assertAgentState(state);
    this.entries.set(agentId, { ...entry, state });
    return state;
  }

  public maintain(agentId: string): AgentState {
    const entry = this.get(agentId);
    if (entry.state.lifecycle === "DEAD") {
      throw new Error(`dead agent cannot be maintained: ${agentId}`);
    }
    const transaction = this.energy.debit(agentId, "maintenance");
    if (transaction.amount > transaction.balanceBefore) {
      return this.transition(agentId, "DEAD");
    }
    return entry.state;
  }

  public async archiveDead(agentId: string): Promise<string> {
    const entry = this.get(agentId);
    if (entry.state.lifecycle !== "DEAD") {
      throw new Error(`only dead agents can be archived: ${agentId}`);
    }
    const directory = join(this.archiveRoot, agentId);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "legacy.json"),
      `${JSON.stringify(
        {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          agentId,
          genomeId: entry.state.genomeId,
          generation: entry.state.generation,
          verifiedPlugins: entry.verifiedPlugins,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return directory;
  }

  public snapshot(generation: number): PopulationSnapshot {
    const agents = [...this.entries.values()].map(({ state }) => state);
    return {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      generation,
      agents,
    };
  }

  public async saveSnapshot(
    generation: number,
    filePath: string,
  ): Promise<PopulationSnapshot> {
    const snapshot = this.snapshot(generation);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    return snapshot;
  }

  public failures(): readonly LifecycleFailure[] {
    return [...this.failuresList];
  }
}

function isAllowedTransition(
  from: AgentLifecycleState,
  to: AgentLifecycleState,
): boolean {
  if (from === "ACTIVE") return to === "DORMANT" || to === "DEAD";
  if (from === "DORMANT") return to === "ACTIVE" || to === "DEAD";
  return false;
}
