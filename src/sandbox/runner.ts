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

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { ResourceMeter } from "../resources/resource-meter.js";
import { resolveSandboxPath } from "./workspace.js";

export interface SandboxCommandOptions {
  readonly workspaceRoot: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly allowedCommands: readonly string[];
  readonly allowedEnvironment?: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly cwd?: string;
}

export interface SandboxCommandResult {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputTruncated: boolean;
  readonly durationMs: number;
  readonly resourceUsage: SandboxResourceUsage;
}

export interface SandboxResourceUsage {
  readonly scope: "controller-process";
  readonly cpuTimeMs: number;
  readonly memoryPeakBytes: number;
}

export async function runSandboxCommand(
  options: SandboxCommandOptions,
): Promise<SandboxCommandResult> {
  if (!options.allowedCommands.includes(options.command)) {
    throw new Error(`command is not allowed in sandbox: ${options.command}`);
  }

  const args = [...(options.args ?? [])];
  const cwd = resolveSandboxPath(
    options.workspaceRoot,
    options.cwd ?? ".",
  );
  const environment = createSandboxEnvironment(
    options.environment ?? process.env,
    options.allowedEnvironment ?? [],
  );
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
  const meter = new ResourceMeter({ agentId: "sandbox-controller" });
  const child = spawn(options.command, args, {
    cwd,
    env: environment,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  let outputTruncated = false;
  const collect = (target: Buffer[]) => (chunk: Buffer) => {
    if (outputBytes >= maxOutputBytes) {
      outputTruncated = true;
      return;
    }
    const remaining = maxOutputBytes - outputBytes;
    const accepted = chunk.subarray(0, remaining);
    target.push(accepted);
    outputBytes += accepted.byteLength;
    if (accepted.byteLength < chunk.byteLength) outputTruncated = true;
  };
  child.stdout?.on("data", collect(stdout));
  child.stderr?.on("data", collect(stderr));

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    terminateProcess(child);
  }, timeoutMs);

  const [exitCode, signal] = (await once(child, "close")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  clearTimeout(timeout);
  const usage = meter.finish();

  return {
    command: options.command,
    args,
    exitCode,
    signal,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
    timedOut,
    outputTruncated,
    durationMs: usage.wallTimeMs,
    resourceUsage: {
      // ResourceMeter measures the controller process. Child-process resource
      // accounting is platform-specific and remains outside this phase.
      scope: "controller-process",
      cpuTimeMs: usage.cpuTimeMs,
      memoryPeakBytes: usage.memoryPeakBytes,
    },
  };
}

function terminateProcess(child: ChildProcess): void {
  if (!child.killed) child.kill();
}

function createSandboxEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  allowedKeys: readonly string[],
): NodeJS.ProcessEnv {
  // Default to an empty environment so host secrets are never inherited by
  // accident; callers must explicitly opt in to each required variable.
  const environment: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}
