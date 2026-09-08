/*
 * Copyright (C) 2026 Vegetable
 *
 * This file is part of Evolving Coding Harness.
 *
 * Evolving Coding Harness is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3, or later.
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
import { AgentCore } from "../../core/agent-core.js";
import {
  assertTaskSpec,
  type TaskSpec,
} from "../../contracts/index.js";
import { SandboxToolEnvironment } from "../../environment/sandbox-tool-environment.js";
import { createProviderFromConfig } from "../../providers/openai-compatible.js";
import { MockCognitionProvider } from "../../providers/mock-cognition.js";
import {
  createSandboxWorkspace,
  type SandboxWorkspace,
} from "../../sandbox/workspace.js";
import {
  CONFIG_OPTIONS,
  parseCommandArgs,
  resolveConfig,
  stringOption,
  type CliOptionConfig,
} from "../args.js";
import { CliError, describeError, type CliCommand } from "../command.js";
import { runTextRepl } from "./repl-text.js";
import {
  ReplSession,
  type ReplSessionRuntime,
} from "../tui/session.js";

export const definition = {
  name: "repl",
  summary: "Run an interactive Observe-Think-Act coding session.",
  usage: "repl [--task <task-spec.json>] [--goal <text>] [--provider <kind>]",
  options: [
    "--task <path>                 Load a TaskSpec and copy its repository.",
    "--goal <text>                 Set the initial task goal.",
    "--provider <local|external|mock>  Select the cognition provider.",
    "--agent <agent-id>            Set the agent identifier.",
    "--help, -h                    Show this help.",
  ],
} as const;

const options: CliOptionConfig = {
  task: { type: "string" },
  goal: { type: "string" },
  provider: { type: "string" },
  agent: { type: "string" },
  ...CONFIG_OPTIONS,
};

type ProviderKind = "local" | "external" | "mock";

export const replCommand: CliCommand = {
  definition,
  async run(args, io) {
    const { values } = parseCommandArgs(definition, args, options);
    const config = resolveConfig(values);
    const providerKind = parseProviderKind(stringOption(values, "provider"));
    const agentId = stringOption(values, "agent") ?? "agent-repl";
    let task = await readOptionalTask(stringOption(values, "task"));
    const initialGoal =
      stringOption(values, "goal") ?? task?.title ?? "Explore the sandbox workspace";

    const createRuntime = (goal: string): Promise<ReplSessionRuntime> =>
      createReplRuntime({
        config,
        task,
        goal,
        providerKind,
        agentId,
      });

    const runtime = await createRuntime(initialGoal);
    const session = new ReplSession({ runtime, createRuntime });
    const loadTask = async (path: string): Promise<void> => {
      const nextTask = await readTask(path);
      const nextRuntime = await createReplRuntime({
        config,
        task: nextTask,
        goal: nextTask.title,
        providerKind,
        agentId,
      });
      task = nextTask;
      await session.replaceRuntime(nextRuntime, nextTask.title);
    };

    try {
      if (process.stdout.isTTY !== true) {
        await runTextRepl(session, io, { loadTask });
        return 0;
      }

      // Keep Ink out of every non-interactive command and out of the no-TTY
      // fallback. A URL expression prevents the root TypeScript project from
      // pulling JSX sources into its non-JSX compilation.
      const tui = (await import(
        new URL("../tui/app.js", import.meta.url).href
      )) as {
        runTui(props: {
          session: ReplSession;
          loadTask(path: string): Promise<void>;
        }): Promise<void>;
      };
      await tui.runTui({ session, loadTask });
      return 0;
    } finally {
      await session.dispose();
    }
  },
};

async function createReplRuntime(input: {
  readonly config: ReturnType<typeof resolveConfig>;
  readonly task: TaskSpec | undefined;
  readonly goal: string;
  readonly providerKind: ProviderKind;
  readonly agentId: string;
}): Promise<ReplSessionRuntime> {
  const workspace = await createSandboxWorkspace(
    `repl-${input.task?.taskId ?? "session"}-`,
  );

  try {
    await populateWorkspace(workspace, input.task);
    const initial = await snapshotWorkspace(workspace.inputRoot);
    const provider =
      input.providerKind === "mock"
        ? new MockCognitionProvider({
            type: "write",
            input: {
              path: ".harness/mock-turn.txt",
              content: "mock provider turn",
            },
          })
        : createProviderFromConfig(input.config, input.providerKind);
    const environment = new SandboxToolEnvironment({
      workspace,
      goal: input.goal,
      allowedCommands: input.task?.allowedCommands ?? [],
      timeoutMs: 30_000,
    });
    const agent = new AgentCore(input.agentId, provider, environment);

    return {
      agent,
      environment,
      dispose: () => workspace.dispose(),
      describeProvider: () => describeProvider(input.providerKind, provider),
      getPatch: async () => formatPatch(initial, await snapshotWorkspace(workspace.inputRoot)),
    };
  } catch (error) {
    await workspace.dispose();
    throw error;
  }
}

function describeProvider(
  kind: ProviderKind,
  provider: MockCognitionProvider | ReturnType<typeof createProviderFromConfig>,
): Readonly<Record<string, unknown>> {
  if (kind === "mock") {
    if (!(provider instanceof MockCognitionProvider)) {
      throw new Error("mock provider runtime was not constructed as expected");
    }
    return {
      provider: "mock",
      action: "write .harness/mock-turn.txt",
      calls: provider.getRequests().length,
    };
  }

  if (provider instanceof MockCognitionProvider) {
    throw new Error("OpenAI provider runtime was not constructed as expected");
  }
  const described = provider.describe();
  return {
    provider: "openai-compatible",
    ...described,
    ...provider.callCount(),
  };
}

async function populateWorkspace(
  workspace: SandboxWorkspace,
  task: TaskSpec | undefined,
): Promise<void> {
  if (task === undefined || task.repository.source === "fixture") return;
  await cp(task.repository.source, workspace.inputRoot, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
}

async function readOptionalTask(path: string | undefined): Promise<TaskSpec | undefined> {
  return path === undefined ? undefined : readTask(path);
}

async function readTask(path: string): Promise<TaskSpec> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new CliError(`cannot read task spec ${path}: ${describeError(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliError(
      `task spec ${path} is not valid JSON: ${describeError(error)}`,
    );
  }

  try {
    assertTaskSpec(parsed);
    return parsed;
  } catch (error) {
    throw new CliError(`task spec ${path} is invalid: ${describeError(error)}`);
  }
}

async function snapshotWorkspace(
  directory: string,
  prefix = "",
): Promise<Readonly<Record<string, string>>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of entries) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await snapshotWorkspace(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files[relativePath] = await readFile(absolutePath, "utf8");
    }
  }
  return files;
}

function formatPatch(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): string {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();

  for (const path of paths) {
    const previous = before[path];
    const current = after[path];
    if (previous === undefined && current !== undefined) added.push(path);
    else if (previous !== undefined && current === undefined) deleted.push(path);
    else if (previous !== current) modified.push(path);
  }

  if (added.length === 0 && modified.length === 0 && deleted.length === 0) {
    return "no workspace changes\n";
  }
  return [
    "workspace changes:",
    ...formatPatchSection("added", added),
    ...formatPatchSection("modified", modified),
    ...formatPatchSection("deleted", deleted),
    "",
  ].join("\n");
}

function formatPatchSection(label: string, paths: readonly string[]): string[] {
  return [
    `${label}:`,
    ...(paths.length === 0 ? ["  (none)"] : paths.map((path) => `  ${path}`)),
  ];
}

function parseProviderKind(value: string | undefined): ProviderKind {
  const kind = value ?? "mock";
  if (kind === "local" || kind === "external" || kind === "mock") return kind;
  throw new CliError(`--provider must be local, external, or mock; received: ${kind}`);
}
