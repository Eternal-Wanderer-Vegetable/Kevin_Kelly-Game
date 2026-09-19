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

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentCore,
  type CognitionProvider,
} from "../core/agent-core.js";
import {
  assertGenomeManifest,
  type AgentState,
  type EvaluationResult,
  type ExperimentEvent,
  type GenomeManifest,
  type PolicyDocument,
  type TaskSpec,
} from "../contracts/index.js";
import { EnergyLedger, energyTransactionEvent, type EnergyPolicy } from "../energy/ledger.js";
import { SandboxToolEnvironment } from "../environment/sandbox-tool-environment.js";
import { IndependentEvaluator } from "../evaluation/evaluator.js";
import { computeFitness } from "../evaluation/fitness.js";
import { CloneEmbryoService, type GenomeMutation } from "../evolution/clone.js";
import { derivePolicyConfig, workflowGuidance, type PolicyConfig } from "../evolution/genome-runtime.js";
import { MutationPlanner } from "../evolution/mutation-planner.js";
import { applyPluginTools } from "../evolution/plugin-runtime.js";
import { SelfRewriteService } from "../evolution/self-rewrite.js";
import {
  hashDirectory,
  GenomeRevisionStore,
  writeGenomeManifest,
} from "../genome/revision-store.js";
import { loadPlugin, loadPolicy, loadWorkflow } from "../genome/loader.js";
import {
  defaultEcologyIndexPath,
  EcologicalMemoryIndex,
} from "../lifecycle/ecological-memory.js";
import { PopulationController } from "../lifecycle/population.js";
import { IndividualMemoryStore } from "../memory/store.js";
import { runSandboxCommand, type SandboxCommandResult } from "../sandbox/runner.js";
import { createSandboxWorkspace } from "../sandbox/workspace.js";
import { writeSandboxFile } from "../sandbox/workspace.js";
import { TaskPool } from "../tasks/task-pool.js";
import type { TaskRunResult } from "../tasks/task-runner.js";
import { EventLog } from "./event-log.js";

export interface EvolutionAgentSpec {
  readonly agentId: string;
  /** Directory containing manifest.json plus genome assets. */
  readonly genomeDir: string;
}

export interface EvolutionPlan {
  readonly schemaVersion: 1;
  readonly generations: number;
  readonly maxTurnsPerTask: number;
  readonly agents: readonly EvolutionAgentSpec[];
  readonly tasks: readonly { task: TaskSpec; inputFiles?: Readonly<Record<string, string>> }[];
  readonly energyPolicy: EnergyPolicy;
  readonly cloneAboveEnergy: number;
  readonly dormantBelowEnergy: number;
  readonly rewriteAfterFailures: number;
  readonly taskTimeoutMs?: number;
  readonly directories: {
    readonly genomeRoot: string;
    readonly candidateRoot: string;
    readonly archiveRoot: string;
    readonly snapshotRoot: string;
  };
}

export interface EvolutionLoopOptions {
  /**
   * Builds the cognition stack for one agent given its policy config — the
   * caller wraps local/external tiers and the shared queue here, so the loop
   * itself stays model-agnostic.
   */
  readonly cognitionFor: (
    agentId: string,
    policy: PolicyConfig,
  ) => CognitionProvider;
  readonly eventLog: EventLog;
  readonly planner?: MutationPlanner;
}

export interface GenerationReport {
  readonly generation: number;
  readonly agents: readonly AgentState[];
  readonly evaluations: readonly EvaluationResult[];
  readonly fitness: Readonly<Record<string, number>>;
}

export interface EvolutionResult {
  readonly runId: string;
  readonly generations: readonly GenerationReport[];
}

const SYSTEM_GOAL_SUFFIX =
  'One JSON action per turn: {"type":"<tool>","input":{...}}. ' +
  "Use the test tool with an allowed command to verify, then stop changing files.";

/**
 * The orchestrator the design's core loop requires: task → agent → sandbox →
 * evaluation → energy → self-rewrite / clone+mutation → next generation.
 * Every step emits events so a run replays exactly.
 */
export class EvolutionLoop {
  private readonly evaluator = new IndependentEvaluator();
  private readonly revisions: GenomeRevisionStore;
  private readonly energy: EnergyLedger;
  private readonly population: PopulationController;
  private readonly selfRewrite: SelfRewriteService;
  private readonly embryo: CloneEmbryoService;
  private readonly memories = new Map<string, IndividualMemoryStore>();
  private readonly consecutiveFailures = new Map<string, number>();

  public constructor(
    private readonly plan: EvolutionPlan,
    private readonly options: EvolutionLoopOptions,
    private readonly runId = `evolution-${randomUUID()}`,
    private readonly taskPool?: TaskPool,
  ) {
    this.revisions = new GenomeRevisionStore(plan.directories.genomeRoot);
    this.energy = new EnergyLedger(plan.energyPolicy);
    this.population = new PopulationController(
      this.energy,
      plan.directories.archiveRoot,
      new EcologicalMemoryIndex(
        defaultEcologyIndexPath(plan.directories.archiveRoot),
      ),
    );
    this.selfRewrite = new SelfRewriteService(
      this.revisions,
      plan.directories.candidateRoot,
    );
    this.embryo = new CloneEmbryoService(
      this.revisions,
      this.energy,
      plan.directories.candidateRoot,
      plan.directories.archiveRoot,
    );
    for (const task of plan.tasks) this.taskPool?.register(task.task);
  }

  public async run(): Promise<EvolutionResult> {
    await this.seedGenerationZero();
    const generations: GenerationReport[] = [];
    for (let generation = 0; generation < this.plan.generations; generation++) {
      generations.push(await this.runGeneration(generation));
    }
    return { runId: this.runId, generations };
  }

  private async seedGenerationZero(): Promise<void> {
    for (const spec of this.plan.agents) {
      const raw = JSON.parse(
        await readFile(join(spec.genomeDir, "manifest.json"), "utf8"),
      ) as unknown;
      assertGenomeManifest(raw);
      // The plan's agentId is authoritative: the same base genome may seed
      // several agents, so the manifest is re-stamped per spec.
      const pending = {
        ...raw,
        agentId: spec.agentId,
        genomeHash: "sha256:pending",
      };
      await writeGenomeManifest(spec.genomeDir, pending);
      const genomeHash = await hashDirectory(spec.genomeDir);
      const manifest = { ...pending, genomeHash };
      await writeGenomeManifest(spec.genomeDir, manifest);
      await this.revisions.create(manifest, spec.genomeDir);
      const state: AgentState = {
        schemaVersion: 1,
        agentId: spec.agentId,
        generation: 0,
        lifecycle: "ACTIVE",
        energy: this.plan.energyPolicy.initialEnergy,
        genomeId: manifest.genomeId,
      };
      this.population.register(state);
      this.memories.set(spec.agentId, new IndividualMemoryStore(spec.agentId));
      this.consecutiveFailures.set(spec.agentId, 0);
    }
  }

  private async runGeneration(generation: number): Promise<GenerationReport> {
    await this.event("GENERATION_STARTED", undefined, { generation });
    const evaluations: EvaluationResult[] = [];
    const fitness: Record<string, number> = {};

    for (const spec of this.plan.agents) {
      const entry = this.population.get(spec.agentId);
      if (entry.state.lifecycle === "DEAD") continue;

      // Maintenance tick: ACTIVE pays full upkeep, DORMANT the cheap rate;
      // an agent that cannot pay dies here.
      const afterUpkeep = this.population.maintain(spec.agentId);
      await this.event("AGENT_STATE_CHANGED", spec.agentId, {
        lifecycle: afterUpkeep.lifecycle,
        generation,
      });
      if (afterUpkeep.lifecycle === "DEAD") {
        await this.die(spec.agentId, "insufficient energy for maintenance");
        continue;
      }
      if (afterUpkeep.lifecycle === "DORMANT") {
        // Dormant agents do no work this generation; policy may revive them
        // once energy recovers.
        continue;
      }

      const taskEntry = this.plan.tasks[generation % this.plan.tasks.length];
      const task = taskEntry?.task;
      if (task === undefined) continue;
      await this.event("TASK_ASSIGNED", spec.agentId, {
        taskId: task.taskId,
        generation,
      });

      const evaluation = await this.runAgentTask(
        spec.agentId,
        task,
        taskEntry?.inputFiles,
        generation,
      );
      evaluations.push(evaluation);
      fitness[spec.agentId] = computeFitness(evaluation).value;
      await this.event("EVALUATION_COMPLETED", spec.agentId, {
        evaluation,
        fitness: fitness[spec.agentId],
        generation,
      });

      this.memories.get(spec.agentId)?.record({
        taskId: task.taskId,
        context: { generation },
        summary: evaluation.taskSuccess
          ? `succeeded ${task.taskId}`
          : `failed ${task.taskId}`,
        outcome: evaluation.taskSuccess ? "success" : "failure",
      });
      await this.event("MEMORY_RECORDED", spec.agentId, {
        taskId: task.taskId,
        outcome: evaluation.taskSuccess ? "success" : "failure",
        generation,
      });

      if (evaluation.taskSuccess) {
        this.consecutiveFailures.set(spec.agentId, 0);
        this.taskPool?.complete(task.taskId);
        const reward = this.energy.reward(spec.agentId, "task-success");
        await this.options.eventLog.append(
          energyTransactionEvent(this.runId, reward),
        );
      } else {
        this.consecutiveFailures.set(
          spec.agentId,
          (this.consecutiveFailures.get(spec.agentId) ?? 0) + 1,
        );
      }

      await this.maybeEvolve(spec.agentId, evaluation, generation);
    }

    const snapshot = this.population.snapshot(generation + 1);
    await this.population.saveSnapshot(
      generation + 1,
      join(this.plan.directories.snapshotRoot, `generation-${generation + 1}.json`),
    );
    await this.event("POPULATION_SNAPSHOT", undefined, {
      generation: generation + 1,
      agents: snapshot.agents,
    });
    await this.event("GENERATION_COMPLETED", undefined, { generation });
    return {
      generation,
      agents: snapshot.agents,
      evaluations,
      fitness,
    };
  }

  private async runAgentTask(
    agentId: string,
    task: TaskSpec,
    inputFiles: Readonly<Record<string, string>> | undefined,
    generation: number,
  ): Promise<EvaluationResult> {
    const revision = this.revisions.current(agentId);
    if (revision === null) {
      throw new Error(`agent has no active genome: ${agentId}`);
    }
    const workspace = await createSandboxWorkspace(`evolve-${agentId}-`);
    let commandResult: SandboxCommandResult | null = null;
    let error: string | null = null;
    try {
      for (const [path, content] of Object.entries(inputFiles ?? {})) {
        await writeSandboxFile(workspace.inputRoot, path, content);
      }
      const assets = await this.loadGenomeAssets(revision.directory, revision.manifest);
      const policy = derivePolicyConfig(assets.policies);
      const environment = new SandboxToolEnvironment({
        workspace,
        goal: `${task.title}. ${SYSTEM_GOAL_SUFFIX}`,
        allowedCommands: task.allowedCommands,
        genome: {
          workflowSteps: workflowGuidance(assets.workflows),
          policyHints: policy.rules,
          ...(assets.plugins.length === 0
            ? {}
            : {
                registerTools: (registry) => {
                  for (const plugin of assets.plugins) {
                    applyPluginTools(registry, plugin);
                  }
                },
              }),
        },
      });
      const cognition = this.options.cognitionFor(agentId, policy);
      const agent = new AgentCore(agentId, cognition, environment);
      for (let turn = 0; turn < this.plan.maxTurnsPerTask; turn++) {
        if (agent.getLifecycle() !== "ACTIVE") break;
        const result = await agent.runTurn();
        if (
          result.action.type === "test" &&
          result.outcome["passed"] === true
        ) {
          break;
        }
      }
      const baseline = parseCommand(task.baselineTestCommand);
      commandResult = await runSandboxCommand({
        workspaceRoot: workspace.inputRoot,
        command: baseline.command,
        ...(baseline.args === undefined ? {} : { args: baseline.args }),
        allowedCommands: task.allowedCommands,
        timeoutMs: this.plan.taskTimeoutMs ?? 30_000,
      });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      await workspace.dispose();
    }
    const run: TaskRunResult = {
      taskId: task.taskId,
      success:
        error === null &&
        commandResult !== null &&
        commandResult.exitCode === 0 &&
        !commandResult.timedOut,
      patch: { added: {}, modified: {}, deleted: {} },
      workspace: {
        root: "",
        inputRoot: "",
        outputRoot: "",
        cleaned: true,
        metadata: {
          source: task.repository.source,
          commit: task.repository.commit,
          inputFileCount: Object.keys(inputFiles ?? {}).length,
        },
      },
      commandResult,
      error,
    };
    return this.evaluator.evaluate({ task, agentId, candidate: run });
  }

  private async maybeEvolve(
    agentId: string,
    evaluation: EvaluationResult,
    generation: number,
  ): Promise<void> {
    const balance = this.energy.balanceOf(agentId);
    const revision = this.revisions.current(agentId);
    if (revision === null) return;
    const context = {
      agentId,
      manifest: revision.manifest,
      recentFailures:
        (this.memories.get(agentId)?.all() ?? [])
          .filter((m) => m.outcome === "failure")
          .slice(-5)
          .map((m) => m.summary),
      recentSuccesses:
        (this.memories.get(agentId)?.all() ?? [])
          .filter((m) => m.outcome === "success")
          .slice(-5)
          .map((m) => m.summary),
      energyBalance: balance,
      fitness: computeFitness(evaluation).value,
    };

    // Low energy → go dormant and wait out the famine instead of dying.
    if (balance <= this.plan.dormantBelowEnergy) {
      const state = this.population.transition(agentId, "DORMANT");
      await this.event("AGENT_STATE_CHANGED", agentId, {
        lifecycle: state.lifecycle,
        generation,
        reason: "energy below dormancy threshold",
      });
      return;
    }

    // Enough surplus → pay for a clone with model-planned mutations.
    if (balance >= this.plan.cloneAboveEnergy) {
      const mutations: readonly GenomeMutation[] =
        (await this.options.planner?.planMutations(context)) ?? [];
      const childId = `agent-${randomUUID().slice(0, 8)}`;
      const childManifest: GenomeManifest = {
        ...revision.manifest,
        genomeId: `genome-${randomUUID()}`,
        agentId: childId,
        parentId: revision.manifest.genomeId,
        generation: generation + 1,
      };
      const result = await this.embryo.clone(
        agentId,
        childId,
        childManifest,
        mutations,
      );
      for (const record of result.mutations) {
        await this.event("MUTATION_CREATED", agentId, {
          mutation: record,
          generation,
        });
      }
      if (result.status === "born") {
        this.population.register({
          schemaVersion: 1,
          agentId: childId,
          generation: generation + 1,
          lifecycle: "ACTIVE",
          energy: this.plan.energyPolicy.initialEnergy,
          genomeId: result.revision.manifest.genomeId,
        });
        this.memories.set(childId, new IndividualMemoryStore(childId));
        this.consecutiveFailures.set(childId, 0);
        // Register the child into the run's agent list is intentionally not
        // done mid-generation; it joins the pool via population snapshot.
        await this.event("EMBRYO_QUALIFIED", childId, {
          parentId: agentId,
          genomeId: result.revision.manifest.genomeId,
          generation,
        });
      } else {
        await this.event("EMBRYO_REJECTED", childId, {
          parentId: agentId,
          reason: result.failure.reason,
          generation,
        });
      }
      return;
    }

    // Repeated failures → self-rewrite attempt.
    if (
      (this.consecutiveFailures.get(agentId) ?? 0) >=
      this.plan.rewriteAfterFailures
    ) {
      const plan = await this.options.planner?.planSelfRewrite(context);
      if (plan === null || plan === undefined) return;
      const candidateManifest: GenomeManifest = {
        ...revision.manifest,
        ...plan.manifest,
        agentId,
        parentId: revision.manifest.genomeId,
      };
      const result = await this.selfRewrite.rewrite(
        agentId,
        candidateManifest,
        async (directory) => {
          for (const edit of plan.edits) {
            await writeSandboxFile(directory, edit.path, edit.content);
          }
        },
      );
      if (result.status === "accepted") {
        this.consecutiveFailures.set(agentId, 0);
        await this.event("GENOME_REWRITTEN", agentId, {
          genomeId: result.revision.manifest.genomeId,
          generation,
        });
      }
    }
  }

  private async die(agentId: string, reason: string): Promise<void> {
    await this.event("AGENT_DIED", agentId, { reason });
    const directory = await this.population.archiveDead(agentId);
    this.taskPool?.releaseAgent(agentId);
    await this.event("LEGACY_ARCHIVED", agentId, { archiveDirectory: directory });
  }

  private async loadGenomeAssets(
    directory: string,
    manifest: GenomeManifest,
  ): Promise<{
    plugins: Awaited<ReturnType<typeof loadPlugin>>[];
    workflows: Awaited<ReturnType<typeof loadWorkflow>>[];
    policies: PolicyDocument[];
  }> {
    const plugins = [];
    for (const plugin of manifest.plugins) {
      plugins.push(await loadPlugin(directory, plugin));
    }
    const workflows = [];
    for (const workflow of manifest.workflows) {
      workflows.push(await loadWorkflow(directory, workflow));
    }
    const policies = [];
    for (const policy of manifest.policies) {
      policies.push(await loadPolicy(directory, policy));
    }
    return { plugins, workflows, policies };
  }

  private async event(
    type: string,
    agentId: string | undefined,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const event: ExperimentEvent = {
      schemaVersion: 1,
      eventId: `event-${randomUUID()}`,
      runId: this.runId,
      timestamp: new Date().toISOString(),
      type,
      ...(agentId === undefined ? {} : { agentId }),
      payload,
    };
    await this.options.eventLog.append(event);
  }
}

function parseCommand(value: string): {
  command: string;
  args?: readonly string[];
} {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const [command, ...args] = parts;
  if (command === undefined) throw new Error("baselineTestCommand is empty");
  return args.length === 0 ? { command } : { command, args };
}
