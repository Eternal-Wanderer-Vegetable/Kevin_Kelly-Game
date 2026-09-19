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

export const TOOL_NAMES = [
  "read",
  "search",
  "write",
  "exec",
  "test",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolCall {
  /**
   * Built-in calls use ToolName; plugin tools register additional names, so
   * the call site accepts any string and the registry decides.
   */
  readonly name: ToolName | (string & {});
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ToolResult {
  readonly ok: boolean;
  readonly output: Readonly<Record<string, unknown>>;
}

export type ToolHandler = (
  input: Readonly<Record<string, unknown>>,
) => Promise<ToolResult>;

export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  public register(name: ToolName | (string & {}), handler: ToolHandler): void {
    if (this.handlers.has(name)) {
      throw new Error(`tool ${name} is already registered`);
    }
    this.handlers.set(name, handler);
  }

  public async invoke(call: ToolCall): Promise<ToolResult> {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      throw new Error(`tool ${call.name} is not registered`);
    }
    return handler(call.input);
  }

  public has(name: ToolName | (string & {})): boolean {
    return this.handlers.has(name);
  }

  /** Every registered tool name, built-ins first in registration order. */
  public names(): readonly string[] {
    return [...this.handlers.keys()];
  }
}
