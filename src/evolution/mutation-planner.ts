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

import type { CognitionProvider, Observation } from "../core/agent-core.js";
import type { GenomeManifest } from "../contracts/index.js";
import type { GenomeMutation } from "./clone.js";

export interface AgentEvolutionContext {
  readonly agentId: string;
  readonly manifest: GenomeManifest;
  readonly recentFailures: readonly string[];
  readonly recentSuccesses: readonly string[];
  readonly energyBalance: number;
  readonly fitness?: number;
}

export interface RewriteEdit {
  readonly path: string;
  readonly content: string;
}

export interface SelfRewritePlan {
  readonly manifest: GenomeManifest;
  readonly edits: readonly RewriteEdit[];
}

const MUTATION_KINDS = new Set([
  "add-plugin",
  "delete-plugin",
  "copy-plugin",
  "modify-plugin",
  "modify-workflow",
  "modify-policy",
  "create-tool",
]);

/**
 * Lets the SLM itself decide how the genome should change — the "agent
 * notices its own defect and rewrites" path from the design. The model
 * answers an AgentAction of type `mutations` or `rewrite`; every element is
 * validated against the structural whitelist, and anything unparseable or
 * illegal degrades to an empty plan rather than a corrupt genome.
 */
export class MutationPlanner {
  public constructor(private readonly cognition: CognitionProvider) {}

  public async planMutations(
    context: AgentEvolutionContext,
  ): Promise<readonly GenomeMutation[]> {
    const observation = this.evolutionObservation(context, "mutations");
    try {
      const action = await this.cognition.think({
        agentId: context.agentId,
        observation,
      });
      if (action.type !== "mutations") return [];
      return parseMutations(action.input["mutations"], context.manifest);
    } catch {
      // A planner failure must never abort evolution; no plan = no mutation.
      return [];
    }
  }

  public async planSelfRewrite(
    context: AgentEvolutionContext,
  ): Promise<SelfRewritePlan | null> {
    const observation = this.evolutionObservation(context, "rewrite");
    try {
      const action = await this.cognition.think({
        agentId: context.agentId,
        observation,
      });
      if (action.type !== "rewrite") return null;
      return parseRewritePlan(action.input, context);
    } catch {
      return null;
    }
  }

  private evolutionObservation(
    context: AgentEvolutionContext,
    mode: "mutations" | "rewrite",
  ): Observation {
    return {
      kind: mode === "mutations" ? "plan-mutations" : "plan-self-rewrite",
      content: {
        agentId: context.agentId,
        genome: context.manifest,
        recentFailures: [...context.recentFailures],
        recentSuccesses: [...context.recentSuccesses],
        energyBalance: context.energyBalance,
        ...(context.fitness === undefined
          ? {}
          : { fitness: context.fitness }),
        instructions:
          mode === "mutations"
            ? 'Reply {"type":"mutations","input":{"mutations":[...]}} using kinds: add-plugin, delete-plugin, copy-plugin, modify-plugin, modify-workflow, modify-policy, create-tool. Reply with an empty list to change nothing.'
            : 'Reply {"type":"rewrite","input":{"manifest":{...},"edits":[{"path":"...","content":"..."}]}} with the full updated GenomeManifest. Reply {"type":"rewrite","input":{"edits":[]}} to change nothing.',
      },
    };
  }
}

function parseMutations(
  value: unknown,
  manifest: GenomeManifest,
): readonly GenomeMutation[] {
  if (!Array.isArray(value)) return [];
  const accepted: GenomeMutation[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const candidate = item as Record<string, unknown>;
    const kind = candidate["kind"];
    if (typeof kind !== "string" || !MUTATION_KINDS.has(kind)) continue;
    const mutation = toMutation(kind, candidate, manifest);
    if (mutation !== null) accepted.push(mutation);
  }
  return accepted;
}

function toMutation(
  kind: string,
  candidate: Record<string, unknown>,
  manifest: GenomeManifest,
): GenomeMutation | null {
  const str = (key: string): string | null =>
    typeof candidate[key] === "string" && candidate[key] !== ""
      ? (candidate[key] as string)
      : null;
  switch (kind) {
    case "add-plugin": {
      const plugin = str("plugin");
      return plugin === null ? null : { kind, plugin };
    }
    case "delete-plugin": {
      const plugin = str("plugin");
      return plugin === null || !manifest.plugins.includes(plugin)
        ? null
        : { kind, plugin };
    }
    case "copy-plugin": {
      const source = str("source");
      const target = str("target");
      return source === null ||
        target === null ||
        !manifest.plugins.includes(source)
        ? null
        : { kind, source, target };
    }
    case "modify-plugin": {
      const plugin = str("plugin");
      const replacement = str("replacement");
      return plugin === null || replacement === null
        ? null
        : { kind, plugin, replacement };
    }
    case "modify-workflow": {
      const workflow = str("workflow");
      return workflow === null ? null : { kind, workflow };
    }
    case "modify-policy": {
      const policy = str("policy");
      return policy === null ? null : { kind, policy };
    }
    case "create-tool": {
      const tool = str("tool");
      return tool === null ? null : { kind, tool };
    }
    default:
      return null;
  }
}

function parseRewritePlan(
  input: Readonly<Record<string, unknown>>,
  context: AgentEvolutionContext,
): SelfRewritePlan | null {
  const editsValue = input["edits"];
  if (!Array.isArray(editsValue)) return null;
  const edits: RewriteEdit[] = [];
  for (const item of editsValue) {
    if (typeof item !== "object" || item === null) return null;
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate["path"] !== "string" ||
      typeof candidate["content"] !== "string"
    ) {
      return null;
    }
    if (candidate["path"].startsWith("/") || candidate["path"].includes("..")) {
      return null;
    }
    edits.push({ path: candidate["path"], content: candidate["content"] });
  }
  // The planner may supply an updated manifest; when absent, reuse the
  // current one — the revision store recomputes the hash either way.
  const manifest =
    typeof input["manifest"] === "object" && input["manifest"] !== null
      ? (input["manifest"] as GenomeManifest)
      : context.manifest;
  return { manifest, edits };
}
