// SPDX-License-Identifier: AGPL-3.0-or-later
import { executeCommand } from "../src/cli/command.js";
import { runRepairCommand } from "../src/cli/commands/run-repair.js";
process.exitCode = await executeCommand(runRepairCommand, process.argv.slice(2));
