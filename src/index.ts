import { pathToFileURL } from "node:url";

export const projectName = "evolving-coding-harness";

export function createRunId(now = new Date()): string {
  return `run-${now.toISOString().replaceAll(/[-:.TZ]/g, "").slice(0, 14)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${projectName} ${createRunId()}\n`);
}
