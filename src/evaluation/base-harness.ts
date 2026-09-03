import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  assertEvaluationResult,
  assertTaskSpec,
  type EvaluationResult,
  type TaskSpec,
} from "../contracts/index.js";

export interface BaseHarnessSnapshot {
  readonly schemaVersion: 1;
  readonly harnessId: "base-harness";
  readonly coreHash: string;
  readonly task: TaskSpec;
  readonly evaluation: EvaluationResult;
}

export async function freezeBaseHarness(
  filePath: string,
  snapshot: BaseHarnessSnapshot,
): Promise<void> {
  validateSnapshot(snapshot);
  await mkdir(dirname(filePath), { recursive: true });

  // Generation 0 is an immutable control group; never silently overwrite it.
  if (await exists(filePath)) {
    throw new Error(`base harness snapshot already exists: ${filePath}`);
  }

  await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function readBaseHarness(
  filePath: string,
): Promise<BaseHarnessSnapshot> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  validateSnapshot(parsed);
  return parsed;
}

function validateSnapshot(value: unknown): asserts value is BaseHarnessSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("BaseHarnessSnapshot must be an object");
  }
  const snapshot = value as Record<string, unknown>;
  const expectedKeys = [
    "schemaVersion",
    "harnessId",
    "coreHash",
    "task",
    "evaluation",
  ];
  const actualKeys = Object.keys(snapshot).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys.sort()[index])
  ) {
    throw new TypeError("BaseHarnessSnapshot contains unknown or missing fields");
  }
  if (snapshot.schemaVersion !== 1) {
    throw new TypeError("BaseHarnessSnapshot.schemaVersion is unsupported");
  }
  if (snapshot.harnessId !== "base-harness") {
    throw new TypeError("BaseHarnessSnapshot.harnessId is invalid");
  }
  if (typeof snapshot.coreHash !== "string" || snapshot.coreHash.length === 0) {
    throw new TypeError("BaseHarnessSnapshot.coreHash must be a non-empty string");
  }
  assertTaskSpec(snapshot.task);
  assertEvaluationResult(snapshot.evaluation);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
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
