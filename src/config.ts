import { resolve } from "node:path";

export interface HarnessConfig {
  readonly dataDirectory: string;
  readonly eventLogPath: string;
  readonly defaultEnergy: number;
  readonly localModelUrl: string;
  readonly externalModelUrl?: string;
}

export interface ConfigInput {
  readonly dataDirectory?: string;
  readonly eventLogPath?: string;
  readonly defaultEnergy?: number;
  readonly localModelUrl?: string;
  readonly externalModelUrl?: string;
}

export function loadConfig(
  input: ConfigInput = {},
  cwd = process.cwd(),
): HarnessConfig {
  const dataDirectory = resolve(cwd, input.dataDirectory ?? "data");
  const eventLogPath = resolve(
    cwd,
    input.eventLogPath ?? `${input.dataDirectory ?? "data"}/runs/events.jsonl`,
  );
  const defaultEnergy = input.defaultEnergy ?? 100;

  if (!Number.isFinite(defaultEnergy) || defaultEnergy < 0) {
    throw new TypeError("defaultEnergy must be a non-negative finite number");
  }

  // Keep provider details in configuration so the immutable Core does not
  // contain machine-specific endpoints or credentials.
  const localModelUrl = input.localModelUrl ?? "http://127.0.0.1:8000/v1";
  if (!isHttpUrl(localModelUrl)) {
    throw new TypeError("localModelUrl must be an HTTP or HTTPS URL");
  }
  if (input.externalModelUrl !== undefined && !isHttpUrl(input.externalModelUrl)) {
    throw new TypeError("externalModelUrl must be an HTTP or HTTPS URL");
  }

  return {
    dataDirectory,
    eventLogPath,
    defaultEnergy,
    localModelUrl,
    ...(input.externalModelUrl === undefined
      ? {}
      : { externalModelUrl: input.externalModelUrl }),
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
