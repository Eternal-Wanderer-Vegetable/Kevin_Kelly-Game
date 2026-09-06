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

import type { AgentLifecycleState } from "../contracts/index.js";

export interface Observation {
  readonly kind: string;
  readonly content: Readonly<Record<string, unknown>>;
}

export interface AgentAction {
  readonly type: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface CognitionRequest {
  readonly agentId: string;
  readonly observation: Observation;
}

export interface CognitionProvider {
  think(request: CognitionRequest): Promise<AgentAction>;
}

export interface EnvironmentInterface {
  observe(): Promise<Observation>;
  act(action: AgentAction): Promise<Readonly<Record<string, unknown>>>;
}

export interface AgentTurnResult {
  readonly observation: Observation;
  readonly action: AgentAction;
  readonly outcome: Readonly<Record<string, unknown>>;
}

export class AgentCore {
  private lifecycle: AgentLifecycleState = "ACTIVE";

  public constructor(
    private readonly agentId: string,
    private readonly cognition: CognitionProvider,
    private readonly environment: EnvironmentInterface,
  ) {}

  public getLifecycle(): AgentLifecycleState {
    return this.lifecycle;
  }

  public async runTurn(): Promise<AgentTurnResult> {
    if (this.lifecycle !== "ACTIVE") {
      throw new Error(`agent ${this.agentId} is not active`);
    }

    // Core owns the turn order. Genome code may later influence cognition and
    // action selection, but it must not bypass observation or environment act.
    const observation = await this.environment.observe();
    const action = await this.cognition.think({
      agentId: this.agentId,
      observation,
    });
    const outcome = await this.environment.act(action);

    return { observation, action, outcome };
  }

  public enterDormant(): void {
    this.requireState("ACTIVE");
    this.lifecycle = "DORMANT";
  }

  public revive(): void {
    this.requireState("DORMANT");
    this.lifecycle = "ACTIVE";
  }

  public die(): void {
    if (this.lifecycle === "DEAD") {
      throw new Error(`agent ${this.agentId} is already dead`);
    }
    this.lifecycle = "DEAD";
  }

  private requireState(expected: AgentLifecycleState): void {
    if (this.lifecycle !== expected) {
      throw new Error(
        `agent ${this.agentId} must be ${expected}, current state is ${this.lifecycle}`,
      );
    }
  }
}
