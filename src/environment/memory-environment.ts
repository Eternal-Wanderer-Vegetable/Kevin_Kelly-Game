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

export class MemoryEnvironment implements EnvironmentInterface {
  private readonly observations: Observation[];
  private readonly actions: AgentAction[] = [];

  public constructor(initialObservations: readonly Observation[]) {
    this.observations = [...initialObservations];
  }

  public async observe(): Promise<Observation> {
    const observation = this.observations.shift();
    if (!observation) {
      throw new Error("environment has no observation available");
    }
    return observation;
  }

  public async act(
    action: AgentAction,
  ): Promise<Readonly<Record<string, unknown>>> {
    this.actions.push(action);
    return { accepted: true, actionType: action.type };
  }

  public getActions(): readonly AgentAction[] {
    return [...this.actions];
  }
}
