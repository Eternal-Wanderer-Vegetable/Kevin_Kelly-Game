import {
  formatHelp,
  reportNotImplemented,
  shouldShowHelp,
} from "../src/cli/help.js";

const command = {
  name: "run-task",
  summary: "Run one coding task in an isolated workspace.",
  usage: "run-task [--task <task-id>] [--agent <agent-id>]",
  options: [
    "--task <task-id>    Select a TaskSpec.",
    "--agent <agent-id>  Select the Agent.",
    "--help, -h          Show this help.",
  ],
} as const;

const args = process.argv.slice(2);
if (shouldShowHelp(args)) {
  process.stdout.write(formatHelp(command));
} else {
  reportNotImplemented(command, args);
}
