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

import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  assertGenomeManifest,
  type GenomeManifest,
} from "../contracts/index.js";

export interface GenomeRevision {
  readonly revisionId: string;
  readonly manifest: GenomeManifest;
  readonly directory: string;
}

export class GenomeRevisionStore {
  private readonly revisions = new Map<string, GenomeRevision>();
  private readonly history = new Map<string, GenomeRevision[]>();
  private readonly active = new Map<string, string>();

  public constructor(private readonly root: string) {}

  public async create(
    manifest: GenomeManifest,
    sourceDirectory: string,
  ): Promise<GenomeRevision> {
    assertGenomeManifest(manifest);
    const directory = join(resolve(this.root), manifest.genomeId);
    await mkdir(resolve(this.root), { recursive: true });
    await cp(sourceDirectory, directory, { recursive: true, force: false });
    await writeGenomeManifest(directory, manifest);
    const actualHash = await hashDirectory(directory);
    if (manifest.genomeHash !== actualHash) {
      await rm(directory, { recursive: true, force: true });
      throw new Error(`genome hash mismatch: ${manifest.genomeId}`);
    }
    const revision = {
      revisionId: `revision-${randomUUID()}`,
      manifest,
      directory,
    };
    this.revisions.set(manifest.genomeId, revision);
    const revisions = this.history.get(manifest.agentId) ?? [];
    revisions.push(revision);
    this.history.set(manifest.agentId, revisions);
    this.active.set(manifest.agentId, manifest.genomeId);
    return revision;
  }

  public async clone(
    parentGenomeId: string,
    childManifest: GenomeManifest,
  ): Promise<GenomeRevision> {
    const parent = this.revisions.get(parentGenomeId);
    if (!parent) throw new Error(`unknown genome revision: ${parentGenomeId}`);
    const staging = join(
      resolve(this.root),
      `.staging-${childManifest.genomeId}-${randomUUID()}`,
    );
    await cp(parent.directory, staging, { recursive: true, force: false });
    try {
      await writeGenomeManifest(staging, childManifest);
      const genomeHash = await hashDirectory(staging);
      return await this.create(
        { ...childManifest, genomeHash },
        staging,
      );
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  public async rollback(
    agentId: string,
    revisionId: string,
  ): Promise<GenomeRevision> {
    const revision = this.history
      .get(agentId)
      ?.find((candidate) => candidate.revisionId === revisionId);
    if (!revision) throw new Error(`unknown genome revision: ${revisionId}`);
    const manifest = JSON.parse(
      await readFile(join(revision.directory, "manifest.json"), "utf8"),
    ) as unknown;
    assertGenomeManifest(manifest);
    this.active.set(agentId, manifest.genomeId);
    return revision;
  }

  public current(agentId: string): GenomeRevision | null {
    const genomeId = this.active.get(agentId);
    return genomeId === undefined ? null : this.revisions.get(genomeId) ?? null;
  }

  public async remove(genomeId: string): Promise<void> {
    const revision = this.revisions.get(genomeId);
    if (!revision) return;
    await rm(revision.directory, { recursive: true, force: true });
    this.revisions.delete(genomeId);
    for (const [agentId, revisions] of this.history) {
      const remaining = revisions.filter(
        (candidate) => candidate.manifest.genomeId !== genomeId,
      );
      if (remaining.length === 0) this.history.delete(agentId);
      else this.history.set(agentId, remaining);
      if (this.active.get(agentId) === genomeId) {
        const replacement = remaining.at(-1);
        if (replacement === undefined) this.active.delete(agentId);
        else this.active.set(agentId, replacement.manifest.genomeId);
      }
    }
  }
}

export async function hashDirectory(directory: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  ) as unknown;
  assertGenomeManifest(manifest);
  const files = await collectFiles(directory);
  const hash = createHash("sha256");
  for (const file of files) {
    const content = await readFile(join(directory, file));
    if (file === "manifest.json") {
      hash.update(JSON.stringify({ ...manifest, genomeHash: "" }));
    } else {
      hash.update(file);
      hash.update(content);
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

export function hashGenomeManifest(manifest: GenomeManifest): string {
  const candidate = {
    ...manifest,
    genomeHash: manifest.genomeHash || "sha256:pending",
  };
  assertGenomeManifest(candidate);
  const canonical = JSON.stringify({ ...candidate, genomeHash: "" });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export async function writeGenomeManifest(
  directory: string,
  manifest: GenomeManifest,
): Promise<void> {
  assertGenomeManifest(manifest);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function collectFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(directory, relativePath)));
    } else if (entry.isFile()) {
      files.push(relative(directory, join(directory, relativePath)));
    }
  }
  return files.sort();
}
