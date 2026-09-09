// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AgentCore, type CognitionProvider, type EnvironmentInterface, type AgentAction } from "../core/agent-core.js";
import { SandboxToolEnvironment } from "../environment/sandbox-tool-environment.js";
import { createSandboxWorkspace, writeSandboxFile } from "../sandbox/workspace.js";
import { EventLog } from "./event-log.js";
import { hashObject } from "./calibration.js";
import { assertRepairTask, type RepairTask } from "./repair-task.js";
import type { RepairEvaluator, RepairTestResult } from "./repair-evaluator.js";

export interface RepairExperimentOptions {
  readonly task: RepairTask;
  readonly provider: CognitionProvider;
  /** Deliberately allowlisted metadata, never provider configuration or credentials. */
  readonly model: string;
  readonly evaluator: RepairEvaluator;
  readonly outputRoot: string;
  readonly maxTurns?: number;
  readonly sourceCommit: string;
  readonly onProgress?: (message: string) => void;
}

export interface RepairReport {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly taskId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: "passed" | "failed" | "error";
  readonly stopReason: string;
  readonly error: string | null;
  readonly model: string;
  readonly modelCalls: number;
  readonly turns: number;
  readonly maxTurns: number;
  readonly sourceCommit: string;
  readonly taskHash: string;
  readonly acceptanceHash: string;
  readonly candidateHash: string;
  readonly evaluator: Readonly<Record<string, unknown>>;
  readonly baseline: RepairTestResult | null;
  readonly candidate: RepairTestResult | null;
  readonly changedFiles: readonly string[];
  readonly checks: Readonly<Record<string, boolean>>;
  readonly outputDirectory: string;
}

export const REPAIR_SYSTEM_PROMPT = [
  "You repair a small JavaScript project. Use exactly one JSON tool action per turn.",
  'Format: {"type":"read|search|write|test", "input":{...}}. No prose or markdown.',
  'read: {"path":"relative/file.mjs"}; search: {"query":"text"}; write: {"path":"relative/file.mjs","content":"full file content"}; test: {}.',
  "Only editableFiles may be written. Tests and the task contract are immutable.",
  "The test tool always executes the fixed visible tests in a container; it takes no command or arguments.",
  "Read the source and visible tests, implement the full goal including edge cases, then call test.",
  "The controller stops once changed code passes visible tests, then runs private acceptance tests once.",
  "You cannot use exec, install dependencies, access the network, or view private acceptance tests.",
].join("\n");

export async function runRepairExperiment(options: RepairExperimentOptions): Promise<RepairReport> {
  // Detach from caller-owned objects so the fixed test bundle cannot drift mid-run.
  const task: RepairTask = structuredClone(options.task);
  assertRepairTask(task);
  const maxTurns = options.maxTurns ?? 12;
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) {
    throw new TypeError("maxTurns must be an integer between 1 and 100");
  }
  const runId = `repair-${randomUUID()}`;
  const directory = resolve(options.outputRoot, runId);
  await mkdir(directory, { recursive: true });
  const startedAt = new Date().toISOString();
  const log = new EventLog(join(directory, "events.jsonl"));
  const event = async (type: string, payload: Readonly<Record<string, unknown>>) => {
    await log.append({ schemaVersion: 1, eventId: randomUUID(), runId,
      timestamp: new Date().toISOString(), type, agentId: "repair-agent", payload });
  };
  const saveJson = (path: string, value: unknown) => writeFile(join(directory, path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await saveJson("task.json", task);
  await event("REPAIR_STARTED", { taskId: task.taskId, taskHash: hashObject(task), model: options.model, maxTurns });

  let baseline: RepairTestResult | null = null;
  let candidate: RepairTestResult | null = null;
  let modelCalls = 0;
  let turns = 0;
  let stopReason = "turn-budget-exhausted";
  let error: string | null = null;
  let candidateFiles: Record<string, string> = { ...task.files };
  const history: { action: AgentAction; outcome: Readonly<Record<string, unknown>> }[] = [];
  const workspace = await createSandboxWorkspace("repair-agent-");

  const acceptance = (files: Readonly<Record<string, string>>) => options.evaluator.evaluate(
    { ...files, ...task.acceptanceTests }, Object.keys(task.acceptanceTests),
  );
  const collectSource = async () => {
    const source: Record<string, string> = { ...task.files };
    for (const path of task.editableFiles) source[path] = await readFile(join(workspace.inputRoot, path), "utf8");
    return source;
  };
  try {
    for (const [path, content] of Object.entries({ ...task.files, ...task.visibleTests })) {
      await writeSandboxFile(workspace.inputRoot, path, content);
    }
    options.onProgress?.("Running fixed acceptance tests on the original source...");
    baseline = await acceptance(task.files);
    await event("REPAIR_BASELINE", { result: baseline });
    if (baseline.tests === 0 || baseline.timedOut || baseline.exitCode === null) {
      throw new Error("baseline did not produce a valid test result");
    }
    if (baseline.passed) throw new Error("baseline already passes; this task cannot demonstrate a repair");

    const base = new SandboxToolEnvironment({ workspace, goal: task.goal, allowedCommands: [] });
    const environment: EnvironmentInterface = {
      observe: async () => ({ kind: "repair-task", content: {
        goal: task.goal, files: await base.listFiles(), editableFiles: task.editableFiles,
        visibleTests: Object.keys(task.visibleTests), history: structuredClone(history),
      } }),
      act: async (action) => {
        let outcome: Readonly<Record<string, unknown>>;
        try {
          if (action.type === "write") {
            if (typeof action.input.path !== "string" || !task.editableFiles.includes(action.input.path)) {
              throw new Error("write is restricted to editableFiles; tests are immutable");
            }
            if (typeof action.input.content !== "string" || Buffer.byteLength(action.input.content) > 128 * 1024) {
              throw new Error("write content is missing or exceeds 128 KiB");
            }
            outcome = await base.act(action);
          } else if (action.type === "read" || action.type === "search") {
            outcome = await base.act(action);
          } else if (action.type === "test") {
            if (Object.keys(action.input).length !== 0) throw new Error("test takes no arguments; its command is fixed");
            const result = await options.evaluator.evaluate(
              { ...await collectSource(), ...task.visibleTests }, Object.keys(task.visibleTests),
            );
            outcome = { ok: true, ...result };
          } else {
            throw new Error("only read, search, write and the fixed test action are allowed");
          }
        } catch (caught) {
          outcome = { ok: false, error: caught instanceof Error ? caught.message : String(caught) };
        }
        history.push({ action, outcome });
        return outcome;
      },
    };
    const counted: CognitionProvider = { think: async (request) => {
      modelCalls += 1;
      return options.provider.think(request);
    } };
    const agent = new AgentCore("repair-agent", counted, environment);
    for (; turns < maxTurns;) {
      const turn = await agent.runTurn();
      turns += 1;
      await event("REPAIR_TURN", { turn: turns, ...turn });
      options.onProgress?.(`Turn ${turns}/${maxTurns}: ${turn.action.type} (${turn.outcome.ok === true ? "ok" : "refused/failed"})`);
      if (turn.action.type === "test" && turn.outcome.passed === true) {
        candidateFiles = await collectSource();
        if (task.editableFiles.some((path) => task.files[path] !== candidateFiles[path])) {
          stopReason = "visible-tests-passed";
          break;
        }
      }
    }
    candidateFiles = await collectSource();
    options.onProgress?.("Running private acceptance tests on a fresh candidate workspace...");
    candidate = await acceptance(candidateFiles);
    await event("REPAIR_ACCEPTANCE", { result: candidate });
  } catch (caught) {
    stopReason = "execution-error";
    // Provider errors can include remote response bodies; do not persist credentials.
    error = "Experiment execution failed. Inspect the last completed event and retry after checking the provider or Docker configuration.";
    options.onProgress?.(`Experiment failed (${caught instanceof Error ? caught.name : "unknown error"}); partial artifacts will be saved.`);
    candidateFiles = await collectSource();
    await event("REPAIR_ERROR", { error });
  } finally {
    await workspace.dispose();
  }

  const changedFiles = task.editableFiles.filter((path) => task.files[path] !== candidateFiles[path]);
  const checks = {
    baselineReproducesFailure: baseline !== null && !baseline.passed && baseline.tests > 0 && baseline.failures > 0 && !baseline.timedOut,
    candidatePassesAcceptance: candidate?.passed === true,
    sourceChanged: changedFiles.length > 0,
    modelWasCalled: modelCalls > 0,
    noExecutionError: error === null,
  };
  const status = error !== null ? "error" : Object.values(checks).every(Boolean) ? "passed" : "failed";
  const report: RepairReport = {
    schemaVersion: 1, runId, taskId: task.taskId, startedAt, completedAt: new Date().toISOString(),
    status, stopReason, error, model: options.model, modelCalls, turns, maxTurns,
    sourceCommit: options.sourceCommit, taskHash: hashObject(task), acceptanceHash: hashObject(task.acceptanceTests),
    candidateHash: hashObject(candidateFiles), evaluator: options.evaluator.identity,
    baseline, candidate, changedFiles, checks, outputDirectory: directory,
  };
  await saveJson("candidate.json", candidateFiles);
  await saveJson("changes.json", changedFiles.map((path) => ({ path, before: task.files[path], after: candidateFiles[path] })));
  await saveJson("report.json", report);
  await event("REPAIR_COMPLETED", { report });
  const files = ["task.json", "candidate.json", "changes.json", "report.json", "events.jsonl"];
  await saveJson("checksums.json", Object.fromEntries(await Promise.all(files.map(async (path) => [
    path, `sha256:${createHash("sha256").update(await readFile(join(directory, path))).digest("hex")}`,
  ]))));
  return report;
}
