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

import { cp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TaskSpec } from "../contracts/index.js";
import {
  createSandboxWorkspace,
  writeSandboxFile,
  type SandboxWorkspace,
} from "../sandbox/workspace.js";
import {
  runSandboxCommand,
  type SandboxCommandResult,
} from "../sandbox/runner.js";

export interface TaskCommand {
  readonly command: string;
  readonly args?: readonly string[];
}

export interface TaskRunnerOptions {
  readonly command?: TaskCommand;
  readonly inputFiles?: Readonly<Record<string, string>>;
  readonly allowedEnvironment?: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface TaskRunResult {
  readonly taskId: string;
  readonly success: boolean;
  readonly patch: TaskPatch;
  readonly workspace: {
    readonly root: string;
    readonly inputRoot: string;
    readonly outputRoot: string;
    readonly cleaned: boolean;
    readonly metadata: {
      readonly source: string;
      readonly commit: string;
      readonly inputFileCount: number;
    };
  };
  readonly commandResult: SandboxCommandResult | null;
  readonly error: string | null;
}

export interface TaskPatch {
  readonly added: Readonly<Record<string, string>>;
  readonly modified: Readonly<Record<string, { readonly before: string; readonly after: string }>>;
  readonly deleted: Readonly<Record<string, string>>;
}

export async function runTask(
  taskSpec: TaskSpec,
  options: TaskRunnerOptions = {},
): Promise<TaskRunResult> {
  const workspace = await createSandboxWorkspace(`task-${taskSpec.taskId}-`);
  let cleaned = false;
  let commandResult: SandboxCommandResult | null = null;
  let error: string | null = null;
  let patch: TaskPatch = { added: {}, modified: {}, deleted: {} };
  let before: Readonly<Record<string, string>> = {};
  let inputFileCount = 0;

  try {
    inputFileCount = await populateTaskInput(
      workspace,
      taskSpec,
      options.inputFiles,
    );
    before = await snapshotWorkspace(workspace.inputRoot);
    const taskCommand = options.command ?? parseCommand(taskSpec.baselineTestCommand);
    commandResult = await runSandboxCommand({
      workspaceRoot: workspace.inputRoot,
      command: taskCommand.command,
      ...(taskCommand.args ? { args: taskCommand.args } : {}),
      allowedCommands: taskSpec.allowedCommands,
      ...(options.allowedEnvironment
        ? { allowedEnvironment: options.allowedEnvironment }
        : {}),
      ...(options.environment ? { environment: options.environment } : {}),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxOutputBytes === undefined
        ? {}
        : { maxOutputBytes: options.maxOutputBytes }),
    });
    const after = await snapshotWorkspace(workspace.inputRoot);
    patch = createPatch(before, after);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    if (error !== null || commandResult !== null) {
      const after = await snapshotWorkspace(workspace.inputRoot);
      patch = createPatch(before, after);
    }
    await workspace.dispose();
    cleaned = true;
  }

  return {
    taskId: taskSpec.taskId,
    success: commandResult?.exitCode === 0 && !commandResult.timedOut,
    patch,
    workspace: {
      root: workspace.root,
      inputRoot: workspace.inputRoot,
      outputRoot: workspace.outputRoot,
      cleaned,
      metadata: {
        source: taskSpec.repository.source,
        commit: taskSpec.repository.commit,
        inputFileCount,
      },
    },
    commandResult,
    error,
  };
}

async function populateTaskInput(
  workspace: SandboxWorkspace,
  taskSpec: TaskSpec,
  inputFiles?: Readonly<Record<string, string>>,
): Promise<number> {
  let inputFileCount = 0;
  // A fixture is copied before execution so the source tree remains immutable.
  if (taskSpec.repository.source !== "fixture") {
    await cp(taskSpec.repository.source, workspace.inputRoot, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  }

  for (const [relativePath, content] of Object.entries(inputFiles ?? {})) {
    await writeSandboxFile(workspace.inputRoot, relativePath, content);
    inputFileCount += 1;
  }
  return inputFileCount;
}

async function snapshotWorkspace(
  directory: string,
  prefix = "",
): Promise<Readonly<Record<string, string>>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await snapshotWorkspace(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files[relativePath] = await readFile(absolutePath, "utf8");
    }
  }
  return files;
}

function createPatch(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): TaskPatch {
  const added: Record<string, string> = {};
  const modified: Record<string, { before: string; after: string }> = {};
  const deleted: Record<string, string> = {};
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const path of paths) {
    const previous = before[path];
    const current = after[path];
    if (previous === undefined && current !== undefined) {
      added[path] = current;
    } else if (previous !== undefined && current === undefined) {
      deleted[path] = previous;
    } else if (previous !== current && previous !== undefined && current !== undefined) {
      modified[path] = { before: previous, after: current };
    }
  }

  return { added, modified, deleted };
}

function parseCommand(commandLine: string): TaskCommand {
  const parts = commandLine.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  const values = parts.map((part) =>
    part.startsWith('"') || part.startsWith("'")
      ? part.slice(1, -1)
      : part,
  );
  const [command, ...args] = values;
  if (!command) throw new Error("TaskSpec.baselineTestCommand must not be empty");
  return { command, args };
}
