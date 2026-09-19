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

import type { EvaluationResult } from "../contracts/index.js";

export interface FitnessWeights {
  readonly taskSuccess: number;
  readonly testPassRate: number;
  readonly stability: number;
  readonly regressionPenalty: number;
  readonly humanBonus: number;
}

export const DEFAULT_FITNESS_WEIGHTS: FitnessWeights = {
  taskSuccess: 0.4,
  testPassRate: 0.3,
  stability: 0.2,
  regressionPenalty: 0.4,
  humanBonus: 0.1,
};

export interface FitnessScore {
  /** Composite score clamped to [0, 1]. */
  readonly value: number;
  /** Per-term contributions before clamping, kept for auditability. */
  readonly components: Readonly<Record<string, number>>;
}

/**
 * A scalar fitness for selection decisions (who reproduces, who goes
 * dormant). The raw metrics stay authoritative — this composite exists so
 * the evolution loop can rank agents, not so agents can aim at a number.
 */
export function computeFitness(
  evaluation: EvaluationResult,
  weights: FitnessWeights = DEFAULT_FITNESS_WEIGHTS,
): FitnessScore {
  const human = humanAcceptanceScore(evaluation.humanAcceptance);
  const components = {
    taskSuccess: weights.taskSuccess * (evaluation.taskSuccess ? 1 : 0),
    testPassRate: weights.testPassRate * evaluation.testPassRate,
    stability: weights.stability * evaluation.stability,
    regression: -weights.regressionPenalty * evaluation.regressionRate,
    human: weights.humanBonus * human,
  };
  const raw = Object.values(components).reduce((sum, term) => sum + term, 0);
  return {
    value: Math.min(1, Math.max(0, raw)),
    components,
  };
}

function humanAcceptanceScore(
  acceptance: EvaluationResult["humanAcceptance"],
): number {
  if (acceptance === undefined) return 0;
  if (acceptance === "accept") return 1;
  if (acceptance === "reject") return -1;
  // 1..5 → -1..1
  return (acceptance - 3) / 2;
}
