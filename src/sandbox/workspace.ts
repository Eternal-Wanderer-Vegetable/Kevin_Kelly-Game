import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

export interface SandboxWorkspace {
  readonly root: string;
  readonly inputRoot: string;
  readonly outputRoot: string;
  dispose(): Promise<void>;
}

export async function createSandboxWorkspace(
  prefix = "evolving-harness-",
): Promise<SandboxWorkspace> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const inputRoot = join(root, "input");
  const outputRoot = join(root, "output");
  await mkdir(inputRoot);
  await mkdir(outputRoot);

  let disposed = false;
  return {
    root,
    inputRoot,
    outputRoot,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function resolveSandboxPath(
  workspaceRoot: string,
  requestedPath: string,
): string {
  if (requestedPath.trim() === "") {
    throw new Error("sandbox path must not be empty");
  }

  const root = resolve(workspaceRoot);
  const candidate = resolve(root, requestedPath);
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.startsWith(rootWithSeparator)) {
    throw new Error(`sandbox path escapes workspace: ${requestedPath}`);
  }
  return candidate;
}

export async function writeSandboxFile(
  workspaceRoot: string,
  requestedPath: string,
  content: string,
): Promise<string> {
  const filePath = resolveSandboxPath(workspaceRoot, requestedPath);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

export function relativeSandboxPath(
  workspaceRoot: string,
  absolutePath: string,
): string {
  const relativePath = relative(resolve(workspaceRoot), resolve(absolutePath));
  resolveSandboxPath(workspaceRoot, relativePath || ".");
  return relativePath;
}
