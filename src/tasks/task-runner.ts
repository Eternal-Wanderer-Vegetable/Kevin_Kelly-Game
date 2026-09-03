import { cp } from "node:fs/promises";
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
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface TaskRunResult {
  readonly taskId: string;
  readonly success: boolean;
  readonly workspace: {
    readonly root: string;
    readonly inputRoot: string;
    readonly outputRoot: string;
    readonly cleaned: boolean;
  };
  readonly commandResult: SandboxCommandResult | null;
  readonly error: string | null;
}

export async function runTask(
  taskSpec: TaskSpec,
  options: TaskRunnerOptions = {},
): Promise<TaskRunResult> {
  const workspace = await createSandboxWorkspace(`task-${taskSpec.taskId}-`);
  let cleaned = false;
  let commandResult: SandboxCommandResult | null = null;
  let error: string | null = null;

  try {
    await populateTaskInput(workspace, taskSpec, options.inputFiles);
    const taskCommand = options.command ?? parseCommand(taskSpec.baselineTestCommand);
    commandResult = await runSandboxCommand({
      workspaceRoot: workspace.inputRoot,
      command: taskCommand.command,
      ...(taskCommand.args ? { args: taskCommand.args } : {}),
      allowedCommands: taskSpec.allowedCommands,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxOutputBytes === undefined
        ? {}
        : { maxOutputBytes: options.maxOutputBytes }),
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    await workspace.dispose();
    cleaned = true;
  }

  return {
    taskId: taskSpec.taskId,
    success: commandResult?.exitCode === 0 && !commandResult.timedOut,
    workspace: {
      root: workspace.root,
      inputRoot: workspace.inputRoot,
      outputRoot: workspace.outputRoot,
      cleaned,
    },
    commandResult,
    error,
  };
}

async function populateTaskInput(
  workspace: SandboxWorkspace,
  taskSpec: TaskSpec,
  inputFiles?: Readonly<Record<string, string>>,
): Promise<void> {
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
  }
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
