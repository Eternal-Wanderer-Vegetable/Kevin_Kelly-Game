import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  assertExperimentEvent,
  type ExperimentEvent,
} from "../contracts/index.js";

export class EventLog {
  public constructor(private readonly filePath: string) {}

  public async append(event: ExperimentEvent): Promise<void> {
    assertExperimentEvent(event);
    await mkdir(dirname(this.filePath), { recursive: true });
    // JSONL keeps the event history append-only and inspectable while allowing
    // replay to rebuild derived runtime state later.
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }

  public async readAll(): Promise<ExperimentEvent[]> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }

    const events: ExperimentEvent[] = [];
    for (const [index, line] of contents.split(/\r?\n/).entries()) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`event log line ${index + 1} is not valid JSON`);
      }
      assertExperimentEvent(parsed);
      events.push(parsed);
    }
    return events;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
