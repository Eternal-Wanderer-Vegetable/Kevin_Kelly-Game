/*
 * Copyright (C) 2026 Vegetable
 *
 * This file is part of Evolving Coding Harness.
 *
 * Evolving Coding Harness is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Evolving Coding Harness is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Evolving Coding Harness. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertPluginManifest,
  assertPolicyDocument,
  assertWorkflowManifest,
  type PluginManifest,
  type PolicyDocument,
  type WorkflowManifest,
} from "../contracts/index.js";

export interface LoadedPlugin {
  readonly manifest: PluginManifest;
  readonly module: Record<string, unknown>;
}

export interface GenomeAssetSet {
  readonly plugins: readonly PluginManifest[];
  readonly workflows: readonly WorkflowManifest[];
  readonly policies: readonly PolicyDocument[];
}

const FORBIDDEN_DEPENDENCY_ROOTS = new Set([
  "core",
  "contracts",
  "energy",
  "evaluation",
  "sandbox",
]);

export async function loadPlugin(
  root: string,
  manifestPath: string,
): Promise<LoadedPlugin> {
  const manifest = await readJson(
    resolveInside(root, manifestPath),
    assertPluginManifest,
  );
  validateDependencies(manifest.pluginId, manifest.dependencies);
  const entrypoint = resolveInside(root, manifest.entrypoint);
  const actualHash = await hashFile(entrypoint);
  if (manifest.pluginHash !== actualHash) {
    throw new Error(`plugin hash mismatch: ${manifest.pluginId}`);
  }
  const module = await import(pathToFileURL(entrypoint).href);
  return { manifest, module: module as Record<string, unknown> };
}

export async function loadWorkflow(
  root: string,
  manifestPath: string,
): Promise<WorkflowManifest> {
  const workflow = await readJson(
    resolveInside(root, manifestPath),
    assertWorkflowManifest,
  );
  validateDependencies(workflow.workflowId, workflow.dependencies);
  return workflow;
}

export async function loadPolicy(
  root: string,
  policyPath: string,
): Promise<PolicyDocument> {
  return readJson(resolveInside(root, policyPath), assertPolicyDocument);
}

export function validateDependencyGraph(
  dependencies: Readonly<Record<string, readonly string[]>>,
): void {
  for (const [id, items] of Object.entries(dependencies)) {
    validateDependencies(id, items);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`cyclic genome dependency: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies[id] ?? []) {
      if (dependencies[dependency] === undefined) {
        throw new Error(`missing genome dependency: ${dependency}`);
      }
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of Object.keys(dependencies)) visit(id);
}

function validateDependencies(id: string, dependencies: readonly string[]): void {
  for (const dependency of dependencies) {
    const segments = dependency.toLowerCase().split(/[/:]/);
    if (segments.some((segment) => FORBIDDEN_DEPENDENCY_ROOTS.has(segment))) {
      throw new Error(`forbidden genome dependency: ${id} -> ${dependency}`);
    }
  }
}

async function readJson<T>(
  path: string,
  assert: (value: unknown) => asserts value is T,
): Promise<T> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  assert(parsed);
  return parsed;
}

async function hashFile(path: string): Promise<string> {
  const content = await readFile(path);
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function resolveInside(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error(`asset path must be relative: ${path}`);
  const base = resolve(root);
  const candidate = resolve(base, path);
  const remainder = relative(base, candidate);
  if (remainder === ".." || remainder.startsWith(`..${sep}`) || isAbsolute(remainder)) {
    throw new Error(`asset path escapes genome root: ${path}`);
  }
  return candidate;
}
