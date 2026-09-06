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
import {
  TOOL_NAMES,
  type ToolName,
  type ToolRegistry,
} from "./tool-registry.js";

export interface MemoryToolEnvironmentOptions {
  readonly observations: readonly Observation[];
}

export class MemoryToolEnvironment implements EnvironmentInterface {
  private readonly observations: Observation[];

  public constructor(
    private readonly tools: ToolRegistry,
    options: MemoryToolEnvironmentOptions,
  ) {
    this.observations = [...options.observations];
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
    if (!isToolName(action.type)) {
      throw new Error(`unknown tool action: ${action.type}`);
    }

    const result = await this.tools.invoke({
      name: action.type,
      input: action.input,
    });
    return { ok: result.ok, ...result.output };
  }
}

function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}
