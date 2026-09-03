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
