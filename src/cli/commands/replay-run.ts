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

import { replayEvents, type ReplayState } from "../../experiment/replay.js";
import {
  formatOption,
  parseCommandArgs,
  resolveConfig,
  stringOption,
  type CliOptionConfig,
} from "../args.js";
import type { CliCommand } from "../command.js";
import { readEventLog, resolveEventLogPath, selectRun } from "../events.js";
import type { CommandDefinition } from "../help.js";

export const definition: CommandDefinition = {
  name: "replay-run",
  summary: "Replay an experiment event log.",
  usage: "replay-run [--input <events.jsonl>]",
  options: [
    "--input <path>  Read an append-only event log.",
    "--run <run-id>  Replay a single run from a mixed log.",
    "--format <json|text>  Choose the output format; text by default.",
    "--help, -h       Show this help.",
  ],
};

const options: CliOptionConfig = {
  input: { type: "string" },
  run: { type: "string" },
  format: { type: "string" },
};

export interface ReplayReport {
  readonly eventLog: string;
  readonly runId: string | null;
  readonly eventCount: number;
  readonly agents: Readonly<Record<string, string>>;
}

export const replayRunCommand: CliCommand = {
  definition,
  helpWhenEmpty: true,
  async run(args, io) {
    const { values } = parseCommandArgs(definition, args, options);
    const format = formatOption(values);
    const config = resolveConfig(values);
    const logPath = resolveEventLogPath(values, config);

    const events = await readEventLog(logPath);
    const selected = selectRun(definition, events, stringOption(values, "run"));
    const report = buildReplayReport(logPath, replayEvents(selected));

    io.out(
      format === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatReplayText(report),
    );
    return 0;
  },
};

export function buildReplayReport(
  eventLog: string,
  state: ReplayState,
): ReplayReport {
  return {
    eventLog,
    runId: state.runId,
    eventCount: state.eventCount,
    agents: Object.fromEntries(
      [...state.agents.entries()].sort((left, right) =>
        left[0].localeCompare(right[0]),
      ),
    ),
  };
}

export function formatReplayText(report: ReplayReport): string {
  const agents = Object.entries(report.agents);
  return [
    `event log: ${report.eventLog}`,
    `run:       ${report.runId ?? "(none)"}`,
    `events:    ${report.eventCount}`,
    `agents:    ${agents.length}`,
    ...agents.map(([agentId, lifecycle]) => `  ${agentId}  ${lifecycle}`),
    "",
  ].join("\n");
}
