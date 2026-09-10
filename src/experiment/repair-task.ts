// SPDX-License-Identifier: AGPL-3.0-or-later

/** Trusted task bundle. Acceptance files never enter the agent workspace. */
export interface RepairTask {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly goal: string;
  readonly files: Readonly<Record<string, string>>;
  readonly editableFiles: readonly string[];
  readonly visibleTests: Readonly<Record<string, string>>;
  readonly acceptanceTests: Readonly<Record<string, string>>;
}

export function assertRepairTask(value: unknown): asserts value is RepairTask {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("repair task must be an object");
  }
  const task = value as Record<string, unknown>;
  const keys = ["schemaVersion", "taskId", "goal", "files", "editableFiles", "visibleTests", "acceptanceTests"];
  if (Object.keys(task).some((key) => !keys.includes(key)) || task.schemaVersion !== 1) {
    throw new TypeError("unsupported repair task schema");
  }
  for (const key of ["taskId", "goal"]) {
    if (typeof task[key] !== "string" || task[key].trim() === "") {
      throw new TypeError(`${key} must be a non-empty string`);
    }
  }
  const allPaths = new Set<string>();
  for (const key of ["files", "visibleTests", "acceptanceTests"] as const) {
    const files = task[key];
    if (typeof files !== "object" || files === null || Array.isArray(files) || Object.keys(files).length === 0) {
      throw new TypeError(`${key} must be a non-empty file map`);
    }
    for (const [path, content] of Object.entries(files)) {
      // Portable, canonical paths also exclude Windows devices, ADS and aliases.
      if (!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\.(?:mjs|json|md)$/.test(path)
        || path.split("/").some((part) => /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
        throw new TypeError(`unsupported task path: ${path}`);
      }
      if (typeof content !== "string" || Buffer.byteLength(content) > 128 * 1024) {
        throw new TypeError(`invalid or oversized task file: ${path}`);
      }
      if (allPaths.has(path.toLowerCase())) throw new TypeError(`duplicate task path: ${path}`);
      allPaths.add(path.toLowerCase());
      if (key !== "files" && !path.endsWith(".test.mjs")) {
        throw new TypeError("tests must use .test.mjs paths");
      }
    }
  }
  if (!Array.isArray(task.editableFiles) || task.editableFiles.length === 0
    || new Set(task.editableFiles).size !== task.editableFiles.length) {
    throw new TypeError("editableFiles must be a non-empty unique list");
  }
  for (const path of task.editableFiles) {
    if (typeof path !== "string" || !Object.hasOwn(task.files as object, path) || !path.endsWith(".mjs")) {
      throw new TypeError("editableFiles must name existing .mjs source files");
    }
  }
}
