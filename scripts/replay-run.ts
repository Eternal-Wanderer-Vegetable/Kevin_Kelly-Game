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

import {
  formatHelp,
  reportNotImplemented,
  shouldShowHelp,
} from "../src/cli/help.js";

const command = {
  name: "replay-run",
  summary: "Replay an experiment event log.",
  usage: "replay-run [--input <events.jsonl>]",
  options: [
    "--input <path>  Read an append-only event log.",
    "--help, -h       Show this help.",
  ],
} as const;

const args = process.argv.slice(2);
if (shouldShowHelp(args)) {
  process.stdout.write(formatHelp(command));
} else {
  reportNotImplemented(command, args);
}
