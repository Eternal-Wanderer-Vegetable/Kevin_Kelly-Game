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

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runSandboxCommand } from "../sandbox/runner.js";
import {
  resolveSandboxPath,
  writeSandboxFile,
  type SandboxWorkspace,
} from "../sandbox/workspace.js";
import { ToolRegistry, type ToolResult } from "./tool-registry.js";

export interface SandboxToolsOptions {
  readonly workspace: SandboxWorkspace;
  /**
   * Commands the agent may execute. This is the hard gate on execution, so
   * callers should pass the narrowest set the task needs. Never default to a
   * shell.
   */
  readonly allowedCommands: readonly string[];
  readonly allowedEnvironment?: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxSearchResults?: number;
  readonly maxListedFiles?: number;
}

export const DEFAULT_MAX_SEARCH_RESULTS = 50;
export const DEFAULT_MAX_LISTED_FILES = 200;

/**
 * Wires the five harness tools to a real sandbox workspace.
 *
 * Path and command validation is delegated to the sandbox module rather than
 * reimplemented here: one allowlist implementation is easier to audit than two.
 * Every tool reports refusal as a failure ToolResult, matching the style of
 * createMemoryToolEnvironment, so a denied action becomes an observation the
 * agent can react to instead of an exception that ends the run.
 */
export function createSandboxTools(options: SandboxToolsOptions): ToolRegistry {
  const registry = new ToolRegistry();
  const root = options.workspace.inputRoot;
  const maxSearchResults = options.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS;

  registry.register("read", async (input) => {
    const path = requireString(input.path, "read.path");
    try {
      const absolute = resolveSandboxPath(root, path);
      const content = await readFile(absolute, "utf8");
      return success({ path, content });
    } catch (error) {
      return failure(describe(error));
    }
  });

  registry.register("search", async (input) => {
    const query = requireString(input.query, "search.query");
    try {
      const files = await listWorkspaceFiles(root);
      const matches: string[] = [];
      for (const relativePath of files) {
        if (matches.length >= maxSearchResults) break;
        if (relativePath.includes(query)) {
          matches.push(relativePath);
          continue;
        }
        if (await fileContains(join(root, relativePath), query)) {
          matches.push(relativePath);
        }
      }
      return success({
        query,
        matches,
        truncated: matches.length >= maxSearchResults,
      });
    } catch (error) {
      return failure(describe(error));
    }
  });

  registry.register("write", async (input) => {
    const path = requireString(input.path, "write.path");
    const content = requireString(input.content, "write.content");
    try {
      // writeSandboxFile throws when the path escapes the workspace.
      await writeSandboxFile(root, path, content);
      return success({
        path,
        bytesWritten: Buffer.byteLength(content, "utf8"),
      });
    } catch (error) {
      return failure(describe(error));
    }
  });

  registry.register("exec", async (input) => {
    // Validation runs outside the try, matching read/search/write and the
    // memory tools: malformed input is a caller bug and throws, while an
    // execution refusal or failure becomes an observable failure result.
    const command = requireString(input.command, "exec.command");
    const args = requireStringArray(input.args, "exec.args");
    try {
      const result = await execute(options, command, args);
      return success({
        command: result.command,
        args: result.args,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        outputTruncated: result.outputTruncated,
        durationMs: result.durationMs,
      });
    } catch (error) {
      return failure(describe(error));
    }
  });

  registry.register("test", async (input) => {
    const command = requireString(input.command, "test.command");
    const args = requireStringArray(input.args, "test.args");
    try {
      const result = await execute(options, command, args);
      return success({
        command: result.command,
        args: result.args,
        // Aligned with the memory tools' test contract: a boolean verdict.
        passed: result.exitCode === 0 && !result.timedOut,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        outputTruncated: result.outputTruncated,
        durationMs: result.durationMs,
      });
    } catch (error) {
      return failure(describe(error));
    }
  });

  return registry;
}

async function execute(
  options: SandboxToolsOptions,
  command: string,
  args: readonly string[],
): ReturnType<typeof runSandboxCommand> {
  return runSandboxCommand({
    workspaceRoot: options.workspace.inputRoot,
    command,
    args,
    allowedCommands: options.allowedCommands,
    ...(options.allowedEnvironment === undefined
      ? {}
      : { allowedEnvironment: options.allowedEnvironment }),
    ...(options.environment === undefined
      ? {}
      : { environment: options.environment }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxOutputBytes === undefined
      ? {}
      : { maxOutputBytes: options.maxOutputBytes }),
  });
}

/**
 * Lists workspace files as paths relative to the input root, using forward
 * slashes on every platform so observations stay stable across hosts.
 *
 * Only relative paths are ever produced: absolute temporary paths must not
 * reach the agent, or a model may learn to probe outside the workspace.
 */
export async function listWorkspaceFiles(
  root: string,
  limit = DEFAULT_MAX_LISTED_FILES,
): Promise<readonly string[]> {
  const files: string[] = [];
  await walk(root, "", files, limit);
  files.sort();
  return files;
}

async function walk(
  directory: string,
  prefix: string,
  files: string[],
  limit: number,
): Promise<void> {
  if (files.length >= limit) return;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= limit) return;
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await walk(join(directory, entry.name), relativePath, files, limit);
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
}

async function fileContains(absolutePath: string, query: string): Promise<boolean> {
  try {
    const content = await readFile(absolutePath, "utf8");
    return content.includes(query);
  } catch {
    // Binary or unreadable files simply do not match.
    return false;
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, name: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array of strings`);
  }
  for (const item of value) {
    if (typeof item !== "string") {
      throw new TypeError(`${name} must be an array of strings`);
    }
  }
  return value as readonly string[];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function success(output: Readonly<Record<string, unknown>>): ToolResult {
  return { ok: true, output };
}

function failure(message: string): ToolResult {
  return { ok: false, output: { error: message } };
}
