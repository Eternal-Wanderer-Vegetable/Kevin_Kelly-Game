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

import type { LoadedPlugin } from "../genome/loader.js";
import type { ToolHandler, ToolRegistry } from "../environment/tool-registry.js";
import { TOOL_NAMES } from "../environment/tool-registry.js";

/**
 * The contract a plugin module must satisfy to extend the agent's tool set.
 * A plugin either exports `register(registry)` or a `tools` record of
 * name → handler. Handlers follow the same ToolResult shape as built-ins.
 */
export function applyPluginTools(
  registry: ToolRegistry,
  plugin: LoadedPlugin,
): readonly string[] {
  const module = plugin.module;
  const registered: string[] = [];

  if (typeof module["register"] === "function") {
    const before = registry.names();
    (module["register"] as (r: ToolRegistry) => void)(registry);
    registered.push(
      ...registry.names().filter((name) => !before.includes(name)),
    );
  }

  const tools = module["tools"];
  if (typeof tools === "object" && tools !== null && !Array.isArray(tools)) {
    for (const [name, handler] of Object.entries(
      tools as Record<string, unknown>,
    )) {
      if (typeof handler !== "function") {
        throw new Error(
          `plugin ${plugin.manifest.pluginId} tool ${name} is not a function`,
        );
      }
      registry.register(name, handler as ToolHandler);
      registered.push(name);
    }
  }

  if (registered.length === 0) {
    throw new Error(
      `plugin ${plugin.manifest.pluginId} exposes no register() or tools`,
    );
  }
  return registered;
}

/**
 * Names a plugin may never claim. A plugin that re-registered a built-in
 * could weaken the sandbox boundary, so the registry's duplicate check is
 * backed up by an explicit list for clearer failure messages.
 */
export function assertPluginToolNameAllowed(name: string): void {
  if ((TOOL_NAMES as readonly string[]).includes(name)) {
    throw new Error(`plugin tool may not shadow built-in tool: ${name}`);
  }
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) {
    throw new Error(`plugin tool name is invalid: ${name}`);
  }
}
