import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolveSandboxPath } from "./workspace.js";

export interface SandboxCommandOptions {
  readonly workspaceRoot: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly allowedCommands: readonly string[];
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
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
  const startedAt = Date.now();
  const child = spawn(options.command, args, {
    cwd,
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

  return {
    command: options.command,
    args,
    exitCode,
    signal,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
    timedOut,
    outputTruncated,
    durationMs: Date.now() - startedAt,
  };
}

function terminateProcess(child: ChildProcess): void {
  if (!child.killed) child.kill();
}
