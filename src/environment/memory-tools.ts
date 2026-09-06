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

import { ToolRegistry, type ToolResult } from "./tool-registry.js";

export interface MemoryTools {
  readonly registry: ToolRegistry;
  readonly files: Map<string, string>;
  readonly commands: Map<string, boolean>;
}

export function createMemoryToolEnvironment(
  files: Readonly<Record<string, string>> = {},
  commands: Readonly<Record<string, boolean>> = {},
): MemoryTools {
  const registry = new ToolRegistry();
  const fileStore = new Map(Object.entries(files));
  const commandStore = new Map(Object.entries(commands));

  registry.register("read", async (input) => {
    const path = requireString(input.path, "read.path");
    const content = fileStore.get(path);
    return content === undefined
      ? failure(`file not found: ${path}`)
      : success({ path, content });
  });

  registry.register("search", async (input) => {
    const query = requireString(input.query, "search.query");
    const matches = [...fileStore.entries()]
      .filter(([path, content]) => path.includes(query) || content.includes(query))
      .map(([path]) => path);
    return success({ query, matches });
  });

  registry.register("write", async (input) => {
    const path = requireString(input.path, "write.path");
    const content = requireString(input.content, "write.content");
    fileStore.set(path, content);
    return success({ path, bytesWritten: Buffer.byteLength(content, "utf8") });
  });

  registry.register("exec", async (input) => {
    const command = requireString(input.command, "exec.command");
    return success({
      command,
      exitCode: commandStore.get(command) === false ? 1 : 0,
    });
  });

  registry.register("test", async (input) => {
    const command = requireString(input.command, "test.command");
    return success({
      command,
      passed: commandStore.get(command) ?? true,
    });
  });

  return { registry, files: fileStore, commands: commandStore };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function success(output: Readonly<Record<string, unknown>>): ToolResult {
  return { ok: true, output };
}

function failure(message: string): ToolResult {
  return { ok: false, output: { error: message } };
}
