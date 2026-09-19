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
import type { HumanAcceptance } from "../../contracts/index.js";
import { EventLog } from "../../experiment/event-log.js";
import {
  CONFIG_OPTIONS,
  CONFIG_OPTION_HELP,
  parseCommandArgs,
  requireStringOption,
  resolveConfig,
  stringOption,
  type CliOptionConfig,
} from "../args.js";
import { CliError, type CliCommand } from "../command.js";
import { resolveEventLogPath } from "../events.js";
import type { CommandDefinition } from "../help.js";

export const definition: CommandDefinition = {
  name: "accept",
  summary: "Record a human acceptance verdict for an evaluation.",
  usage:
    "accept --verdict <accept|reject|1-5> [--evaluation <id>] [--run <runId>]",
  options: [
    "--verdict <v>               accept, reject, or an integer 1-5.",
    "--evaluation <id>           Evaluation to annotate; defaults to the latest in the log.",
    "--run <runId>               Limit the evaluation lookup to one run.",
    "--event-log <path>          Override the append-only event log path.",
    ...CONFIG_OPTION_HELP.filter((option) => !option.startsWith("--event-log")),
    "--help, -h                   Show this help.",
  ],
};

const options: CliOptionConfig = {
  verdict: { type: "string" },
  evaluation: { type: "string" },
  run: { type: "string" },
  ...CONFIG_OPTIONS,
};

export const acceptCommand: CliCommand = {
  definition,
  helpWhenEmpty: true,
  async run(args, io) {
    const { values, positionals } = parseCommandArgs(definition, args, options);
    if (positionals.length > 0) {
      throw new CliError(
        `unexpected positional argument: ${positionals[0]}`,
        definition,
      );
    }
    const verdict = parseVerdict(
      requireStringOption(definition, values, "verdict"),
    );
    const config = resolveConfig(values);
    const eventLogPath = resolveEventLogPath(values, config);
    const log = new EventLog(eventLogPath);
    const events = await log.readAll();

    const runFilter = stringOption(values, "run");
    let evaluationId = stringOption(values, "evaluation");
    if (evaluationId === undefined) {
      const candidates = events.filter(
        (event) =>
          event.type === "EVALUATION_COMPLETED" &&
          (runFilter === undefined || event.runId === runFilter),
      );
      const latest = candidates.at(-1);
      const candidate = latest?.payload["evaluation"];
      const id =
        typeof candidate === "object" && candidate !== null
          ? (candidate as Record<string, unknown>)["evaluationId"]
          : undefined;
      if (typeof id !== "string") {
        throw new CliError(
          "no EVALUATION_COMPLETED event found; pass --evaluation explicitly",
          definition,
        );
      }
      evaluationId = id;
    }

    await log.append({
      schemaVersion: 1,
      eventId: `event-${randomUUID()}`,
      runId: runFilter ?? events.at(-1)?.runId ?? "manual",
      timestamp: new Date().toISOString(),
      type: "HUMAN_ACCEPTANCE_RECORDED",
      payload: { evaluationId, verdict },
    });
    io.out(`recorded ${JSON.stringify(verdict)} for ${evaluationId}\n`);
    return 0;
  },
};

function parseVerdict(value: string): HumanAcceptance {
  if (value === "accept" || value === "reject") return value;
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 5) {
    return numeric as HumanAcceptance;
  }
  throw new CliError(
    `--verdict must be accept, reject, or an integer 1-5; received: ${value}`,
    definition,
  );
}
