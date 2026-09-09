// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from "node:crypto";
import { runSandboxCommand } from "../sandbox/runner.js";
import { createSandboxWorkspace, writeSandboxFile } from "../sandbox/workspace.js";

export interface RepairTestResult {
  readonly passed: boolean;
  readonly tests: number;
  readonly passes: number;
  readonly failures: number;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RepairEvaluator {
  readonly identity: Readonly<Record<string, unknown>>;
  evaluate(files: Readonly<Record<string, string>>, tests: readonly string[]): Promise<RepairTestResult>;
}

/** One disposable container per evaluation. No model keys or host commands inside. */
export class DockerRepairEvaluator implements RepairEvaluator {
  public readonly identity: Readonly<Record<string, unknown>>;

  public constructor(
    private readonly image: string,
    private readonly timeoutMs = 30_000,
  ) {
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) {
      throw new TypeError("evaluation requires a resolved immutable Docker image ID");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new TypeError("test timeout must be between 1 and 120000 ms");
    }
    this.identity = { engine: "docker", image, timeoutMs, network: "none", memory: "256m", cpus: 1 };
  }

  public async evaluate(files: Readonly<Record<string, string>>, tests: readonly string[]): Promise<RepairTestResult> {
    const workspace = await createSandboxWorkspace("repair-eval-");
    const name = `harness-repair-${randomUUID()}`;
    try {
      for (const [path, content] of Object.entries(files)) {
        await writeSandboxFile(workspace.inputRoot, path, content);
      }
      const result = await runSandboxCommand({
        workspaceRoot: workspace.root,
        command: "docker",
        allowedCommands: ["docker"],
        allowedEnvironment: dockerEnvironment,
        timeoutMs: this.timeoutMs,
        maxOutputBytes: 64 * 1024,
        args: [
          "run", "--rm", "--pull=never", "--name", name,
          "--network=none", "--read-only", "--cap-drop=ALL",
          "--security-opt=no-new-privileges", "--pids-limit=64",
          "--memory=256m", "--cpus=1", "--user=65534:65534",
          "--mount", `type=bind,source=${workspace.inputRoot},target=/workspace,readonly`,
          "--workdir=/workspace", this.image, "node", "--test",
          "--test-reporter=tap", ...tests,
        ],
      });
      const count = (label: string) => Number(result.stdout.match(new RegExp(`^# ${label} (\\d+)\\s*$`, "m"))?.[1] ?? 0);
      const total = count("tests");
      const passes = count("pass");
      const failures = count("fail");
      return {
        passed: result.exitCode === 0 && !result.timedOut && !result.outputTruncated
          && total > 0 && passes === total && failures === 0,
        tests: total, passes, failures,
        exitCode: result.exitCode, timedOut: result.timedOut,
        durationMs: result.durationMs, stdout: result.stdout, stderr: result.stderr,
      };
    } finally {
      // Killing the Docker CLI alone does not stop a timed-out container.
      // Only remove the unique container created by this evaluation.
      try {
        const cleanup = await runSandboxCommand({
          workspaceRoot: workspace.root, command: "docker",
          args: ["rm", "--force", name], allowedCommands: ["docker"],
          allowedEnvironment: dockerEnvironment, timeoutMs: 10_000,
        });
        if (cleanup.exitCode !== 0 && !cleanup.stderr.includes("No such container")) {
          throw new Error(`cannot confirm evaluation container cleanup: ${name}`);
        }
      } finally {
        await workspace.dispose();
      }
    }
  }
}

const dockerEnvironment = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "USERPROFILE", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"];

export async function resolveRepairImage(reference: string): Promise<string> {
  if (!reference || reference.startsWith("-")) throw new TypeError("invalid Docker image reference");
  const result = await runSandboxCommand({
    workspaceRoot: process.cwd(), command: "docker",
    args: ["image", "inspect", "--format", "{{.Id}}", reference],
    allowedCommands: ["docker"], allowedEnvironment: dockerEnvironment, timeoutMs: 15_000,
  });
  const image = result.stdout.trim();
  if (result.exitCode !== 0 || !/^sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error(`Docker image is unavailable: ${reference}. Pull it before running the experiment.`);
  }
  return image;
}
