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

import type {
  PolicyDocument,
  WorkflowManifest,
} from "../contracts/index.js";

/**
 * The decision surface a genome's policies can steer.
 *
 * Every field is optional; a policy document that names a rule the runtime
 * does not understand is preserved verbatim in `rules` so the vocabulary can
 * evolve faster than the interpreter — that is the point of making policy
 * heritable. Only recognised keys change behaviour.
 */
export interface PolicyConfig {
  /** Force cognition to the external tier from the first request. */
  readonly escalateToExternal?: boolean;
  /** Escalate to external after this many local failures. */
  readonly externalAfterFailures?: number;
  /** Enter DORMANT when energy falls below this balance. */
  readonly dormantBelowEnergy?: number;
  /** Pay for a clone once energy exceeds this balance. */
  readonly cloneAboveEnergy?: number;
  /** Attempt a self-rewrite after this many consecutive task failures. */
  readonly rewriteAfterFailures?: number;
  /** Priority forwarded to the shared SLM queue. */
  readonly queuePriority?: number;
  /** Unrecognised rules, kept verbatim for lineage and future runtimes. */
  readonly rules: Readonly<Record<string, unknown>>;
}

const POLICY_RULE_KEYS = {
  escalateToExternal: "cognition.escalateToExternal",
  externalAfterFailures: "cognition.externalAfterFailures",
  dormantBelowEnergy: "lifecycle.dormantBelowEnergy",
  cloneAboveEnergy: "reproduction.cloneAboveEnergy",
  rewriteAfterFailures: "adaptation.rewriteAfterFailures",
  queuePriority: "resource.queuePriority",
} as const;

export function derivePolicyConfig(
  policies: readonly PolicyDocument[],
): PolicyConfig {
  const merged: Record<string, unknown> = {};
  for (const policy of policies) {
    Object.assign(merged, policy.rules);
  }
  const recognised = new Set<string>(Object.values(POLICY_RULE_KEYS));
  const rest = Object.fromEntries(
    Object.entries(merged).filter(([key]) => !recognised.has(key)),
  );
  return {
    ...(merged[POLICY_RULE_KEYS.escalateToExternal] === true
      ? { escalateToExternal: true }
      : {}),
    ...(isPositiveInt(merged[POLICY_RULE_KEYS.externalAfterFailures])
      ? {
          externalAfterFailures: merged[
            POLICY_RULE_KEYS.externalAfterFailures
          ] as number,
        }
      : {}),
    ...(isFiniteNumber(merged[POLICY_RULE_KEYS.dormantBelowEnergy])
      ? {
          dormantBelowEnergy: merged[
            POLICY_RULE_KEYS.dormantBelowEnergy
          ] as number,
        }
      : {}),
    ...(isFiniteNumber(merged[POLICY_RULE_KEYS.cloneAboveEnergy])
      ? {
          cloneAboveEnergy: merged[
            POLICY_RULE_KEYS.cloneAboveEnergy
          ] as number,
        }
      : {}),
    ...(isPositiveInt(merged[POLICY_RULE_KEYS.rewriteAfterFailures])
      ? {
          rewriteAfterFailures: merged[
            POLICY_RULE_KEYS.rewriteAfterFailures
          ] as number,
        }
      : {}),
    ...(isFiniteNumber(merged[POLICY_RULE_KEYS.queuePriority])
      ? {
          queuePriority: merged[
            POLICY_RULE_KEYS.queuePriority
          ] as number,
        }
      : {}),
    rules: rest,
  };
}

/**
 * Flattens the steps of every workflow in the genome into one ordered list.
 * Workflows describe *how* an agent uses its tools; the list is injected into
 * the observation so the model sees the strategy its genome encodes.
 */
export function workflowGuidance(
  workflows: readonly WorkflowManifest[],
): readonly string[] {
  const steps: string[] = [];
  for (const workflow of workflows) {
    for (const step of workflow.steps) steps.push(step);
  }
  return steps;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
