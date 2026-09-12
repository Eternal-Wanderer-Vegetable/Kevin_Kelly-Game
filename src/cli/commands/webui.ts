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

import { resolve } from "node:path";
import {
  CONFIG_OPTIONS,
  CONFIG_OPTION_HELP,
  numberOption,
  parseCommandArgs,
  resolveConfig,
  stringOption,
  type CliOptionConfig,
} from "../args.js";
import { type CliCommand } from "../command.js";
import { startWebUiServer } from "../../web/server.js";
import type { CommandDefinition } from "../help.js";

/** The built SPA, produced by `vite build` into dist/webui. */
const DEFAULT_STATIC_ROOT = "dist/webui";

export const definition: CommandDefinition = {
  name: "webui",
  summary: "Serve the read-only experiment dashboard over HTTP.",
  usage:
    "webui [--host <addr>] [--port <number>] [--token <value>] [--artifacts-dir <path>] [--poll-interval <ms>]",
  options: [
    "--host <addr>            Bind address. Defaults to 127.0.0.1; containers pass 0.0.0.0.",
    "--port <number>          Port. Defaults to 8080.",
    "--token <value>          Require this token on every request. Omit it for an open local server.",
    "--artifacts-dir <path>   Experiments directory to expose read-only. Defaults to ./experiments.",
    "--poll-interval <ms>     Event log poll interval. Defaults to 1500.",
    ...CONFIG_OPTION_HELP.filter(
      (option) =>
        option.startsWith("--data-dir") || option.startsWith("--event-log"),
    ),
    "--help, -h              Show this help.",
  ],
};

const options: CliOptionConfig = {
  host: { type: "string" },
  port: { type: "string" },
  token: { type: "string" },
  "artifacts-dir": { type: "string" },
  "poll-interval": { type: "string" },
  ...CONFIG_OPTIONS,
};

export const webuiCommand: CliCommand = {
  definition,
  async run(args, io) {
    const { values } = parseCommandArgs(definition, args, options);
    const config = resolveConfig(values);
    const host = stringOption(values, "host") ?? "127.0.0.1";
    const port = numberOption(values, "port") ?? 8080;
    const pollIntervalMs = numberOption(values, "poll-interval") ?? 1500;
    const token = stringOption(values, "token");
    const artifactsDir = resolve(stringOption(values, "artifacts-dir") ?? "experiments");

    const server = await startWebUiServer({
      host,
      port,
      eventLogPath: config.eventLogPath,
      defaultEnergy: config.defaultEnergy,
      artifactsDir,
      staticRoot: resolve(DEFAULT_STATIC_ROOT),
      ...(token === undefined ? {} : { token }),
      pollIntervalMs,
      onRequest: (line) => io.out(`${new Date().toISOString()} ${line}\n`),
    });

    io.out(
      `webui: serving http://${host}:${server.port} ` +
        `(token ${token === undefined ? "not required; use --token for remote access" : "required"})\n` +
        `webui: event log ${config.eventLogPath}\n` +
        `webui: artifacts ${artifactsDir}\n`,
    );

    // The server runs until the operator stops it; compose and init handle
    // signal delivery in containers, Ctrl+C covers interactive use.
    await new Promise<void>((resolveStop) => {
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.once(signal, () => resolveStop());
      }
    });
    await server.close();
    return 0;
  },
};
