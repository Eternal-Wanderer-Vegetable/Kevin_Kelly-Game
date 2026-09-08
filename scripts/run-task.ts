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

import { defaultIo, executeCommand } from "../src/cli/command.js";
import { runTaskCommand } from "../src/cli/commands/run-task.js";

// Kept as a standalone entry point: `node dist/scripts/run-task.js` is what CI
// and the container documentation already call. The implementation lives in
// src/cli/commands so `harness run-task` runs exactly the same code.
process.exitCode = await executeCommand(
  runTaskCommand,
  process.argv.slice(2),
  defaultIo,
);
