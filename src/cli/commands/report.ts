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

import type { ExperimentEvent } from "../../contracts/index.js";
import { replayEnergyEvents } from "../../energy/ledger.js";
import { replayEvents } from "../../experiment/replay.js";
import {
  formatOption,
  numberOption,
  parseCommandArgs,
  resolveConfig,
  stringOption,
  type CliOptionConfig,
} from "../args.js";
import { describeError, type CliCommand } from "../command.js";
import {
  countEventTypes,
  listAgentIds,
  readEventLog,
  resolveEventLogPath,
  selectRun,
} from "../events.js";
import type { CommandDefinition } from "../help.js";

export const definition: CommandDefinition = {
  name: "report",
  summary: "Generate a summary for an experiment run.",
  usage: "report [--run <run-id>] [--format <json|text>]",
  options: [
    "--run <run-id>          Select an experiment run.",
    "--format <json|text>    Choose the report format.",
    "--input <path>          Read an append-only event log.",
    "--energy <number>       Initial energy the ledger replay starts from.",
    "--help, -h              Show this help.",
  ],
};

const options: CliOptionConfig = {
  run: { type: "string" },
  format: { type: "string" },
  input: { type: "string" },
  energy: { type: "string" },
};

export interface ReportAgent {
  readonly agentId: string;
  /** Null when the agent never emitted AGENT_STATE_CHANGED in this run. */
  readonly lifecycle: string | null;
  /** Null when the energy ledger could not be replayed. */
  readonly energy: number | null;
}

export interface RunReport {
  readonly eventLog: string;
  readonly runId: string | null;
  readonly eventCount: number;
  readonly eventsByType: Readonly<Record<string, number>>;
  readonly initialEnergy: number;
  readonly agents: readonly ReportAgent[];
  readonly warnings: readonly string[];
}

export const reportCommand: CliCommand = {
  definition,
  helpWhenEmpty: true,
  async run(args, io) {
    const { values } = parseCommandArgs(definition, args, options);
    const format = formatOption(values);
    const config = resolveConfig(values);
    const logPath = resolveEventLogPath(values, config);

    const events = await readEventLog(logPath);
    const selected = selectRun(definition, events, stringOption(values, "run"));
    const report = buildRunReport({
      eventLog: logPath,
      events: selected,
      initialEnergy: numberOption(values, "energy") ?? config.defaultEnergy,
    });

    io.out(
      format === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatReportText(report),
    );
    return 0;
  },
};

export function buildRunReport(input: {
  readonly eventLog: string;
  readonly events: readonly ExperimentEvent[];
  readonly initialEnergy: number;
}): RunReport {
  const state = replayEvents(input.events);
  const warnings: string[] = [];
  const balances = replayBalances(input, warnings);

  const agents = listAgentIds(input.events).map((agentId): ReportAgent => ({
    agentId,
    lifecycle: state.agents.get(agentId) ?? null,
    energy: balances === null ? null : balances.get(agentId) ?? input.initialEnergy,
  }));

  return {
    eventLog: input.eventLog,
    runId: state.runId,
    eventCount: state.eventCount,
    eventsByType: countEventTypes(input.events),
    initialEnergy: input.initialEnergy,
    agents,
    warnings,
  };
}

/**
 * Rebuilds energy balances, degrading to null instead of failing the report.
 *
 * The ledger refuses a transaction whose balanceBefore disagrees with its own
 * running total, which happens whenever the replay starts from a different
 * initial energy than the run did. That is a mismatch between this invocation and
 * the recorded history, so the fix is a flag, not a lost report: everything else
 * in the summary is still true and worth printing.
 */
function replayBalances(
  input: {
    readonly events: readonly ExperimentEvent[];
    readonly initialEnergy: number;
  },
  warnings: string[],
): Map<string, number> | null {
  try {
    const ledger = replayEnergyEvents(input.events, {
      initialEnergy: input.initialEnergy,
      // Replay reads amounts from the recorded transactions; the schedules only
      // matter when the ledger is the one deciding a debit.
      debitByReason: {},
      rewardByReason: {},
    });
    const balances = new Map<string, number>();
    for (const agentId of listAgentIds(input.events)) {
      balances.set(agentId, ledger.balanceOf(agentId));
    }
    return balances;
  } catch (error) {
    warnings.push(
      `energy ledger not replayed: ${describeError(error)}. ` +
        `Replay started from ${input.initialEnergy}; set --energy or HARNESS_DEFAULT_ENERGY to the value the run used.`,
    );
    return null;
  }
}

export function formatReportText(report: RunReport): string {
  const types = Object.entries(report.eventsByType);
  const typeWidth = types.reduce((width, [type]) => Math.max(width, type.length), 0);

  return [
    `event log:      ${report.eventLog}`,
    `run:            ${report.runId ?? "(none)"}`,
    `events:         ${report.eventCount}`,
    `initial energy: ${report.initialEnergy}`,
    "",
    `events by type (${types.length}):`,
    ...types.map(([type, count]) => `  ${type.padEnd(typeWidth)}  ${count}`),
    "",
    `agents (${report.agents.length}):`,
    ...report.agents.map(
      (agent) =>
        `  ${agent.agentId}  lifecycle=${agent.lifecycle ?? "(unknown)"}  energy=${
          agent.energy ?? "(unavailable)"
        }`,
    ),
    ...(report.warnings.length === 0
      ? []
      : ["", "warnings:", ...report.warnings.map((warning) => `  - ${warning}`)]),
    "",
  ].join("\n");
}
