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

/**
 * The reference dictionary: its keys are the complete set of message keys, and
 * every other locale is typed against this shape, so a missing translation is
 * a compile error and the parity test catches placeholder drift at runtime.
 *
 * Interpolation uses {name} placeholders replaced by translate().
 */
export const en = {
  "app.title": "Harness Dashboard",
  "nav.runs": "Runs",
  "nav.artifacts": "Artifacts",
  "language.label": "Language",

  "runs.loading": "Loading runs…",
  "runs.empty":
    "No runs recorded yet. Start an experiment and this list refreshes itself.",
  "runs.column.run": "Run",
  "runs.column.status": "Status",
  "runs.column.events": "Events",
  "runs.column.started": "Started",
  "runs.column.last": "Last event",

  "status.running": "running",
  "status.completed": "completed",
  "status.error": "error",
  "status.stalled": "stalled",
  "status.active": "active",
  "status.dormant": "dormant",
  "status.dead": "dead",
  "status.other": "other",

  "detail.back": "← All runs",
  "detail.events": "Events",
  "detail.agents": "Agents",
  "detail.initialEnergy": "Initial energy",
  "detail.agentsHeading": "Agents",
  "detail.noAgents": "No agents recorded in this run.",
  "detail.energyLabel": "energy",
  "detail.energyUnavailable": "n/a",
  "detail.streamHeading": "Event stream",
  "detail.liveEvents": "{count} live events (last 500 kept)",
  "detail.filterType": "Type",
  "detail.filterAll": "all",
  "detail.failed": "Failed to load: {message}",

  "events.column.time": "Time",
  "events.column.type": "Type",
  "events.column.agent": "Agent",
  "events.column.detail": "Detail",

  "generations.heading": "Generations",
  "generations.summary": "completed {completed} of {started} started",

  "repair.heading": "Repair",
  "repair.taskLabel": "task",
  "repair.taskUnknown": "unknown",
  "repair.turnCount": "turn {turn}",
  "repair.turnProgress": "turn {turn} of {max}",
  "repair.acceptance": "acceptance:",
  "repair.passed": "passed",
  "repair.failed": "failed",
  "repair.error": "error:",

  "artifacts.heading": "Artifacts",
  "artifacts.loading": "Loading artifacts…",
  "artifacts.empty": "No artifacts recorded.",
};

export type Dictionary = typeof en;
export type MessageKey = keyof Dictionary;

export type TranslateParams = Readonly<Record<string, string | number>>;

/**
 * Replaces {name} placeholders; unknown names stay in the template so a typo
 * surfaces in the UI instead of vanishing into an empty string.
 */
export function translate(
  dictionary: Dictionary,
  key: MessageKey,
  params?: TranslateParams,
): string {
  const template = dictionary[key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match: string, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
