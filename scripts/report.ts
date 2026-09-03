import {
  formatHelp,
  reportNotImplemented,
  shouldShowHelp,
} from "../src/cli/help.js";

const command = {
  name: "report",
  summary: "Generate a summary for an experiment run.",
  usage: "report [--run <run-id>] [--format <json|text>]",
  options: [
    "--run <run-id>          Select an experiment run.",
    "--format <json|text>    Choose the report format.",
    "--help, -h              Show this help.",
  ],
} as const;

const args = process.argv.slice(2);
if (shouldShowHelp(args)) {
  process.stdout.write(formatHelp(command));
} else {
  reportNotImplemented(command, args);
}
