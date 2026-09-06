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

import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  assertGenomeManifest,
  type GenomeManifest,
} from "../contracts/index.js";
import {
  loadPlugin,
  type LoadedPlugin,
} from "../genome/loader.js";
import {
  hashDirectory,
  GenomeRevisionStore,
  writeGenomeManifest,
  type GenomeRevision,
} from "../genome/revision-store.js";

export type CandidateMutation = (
  candidateDirectory: string,
  currentManifest: GenomeManifest,
) => Promise<void>;

export type RevisionCheck = (
  candidateDirectory: string,
  candidateManifest: GenomeManifest,
) => Promise<void>;

export interface SelfRewriteFailure {
  readonly agentId: string;
  readonly candidateGenomeId: string;
  readonly reason: string;
}

export type SelfRewriteResult =
  | {
      readonly status: "accepted";
      readonly revision: GenomeRevision;
    }
  | {
      readonly status: "rejected";
      readonly failure: SelfRewriteFailure;
    };

export class SelfRewriteService {
  private readonly rejected: SelfRewriteFailure[] = [];

  public constructor(
    private readonly revisions: GenomeRevisionStore,
    private readonly candidateRoot: string,
    private readonly bootTest: RevisionCheck = defaultPluginBootTest,
    private readonly regressionTest: RevisionCheck = async () => {},
  ) {}

  public async rewrite(
    agentId: string,
    candidateManifest: GenomeManifest,
    mutate: CandidateMutation,
  ): Promise<SelfRewriteResult> {
    const current = this.revisions.current(agentId);
    const failurePrefix = {
      agentId,
      candidateGenomeId: candidateManifest.genomeId,
    };

    try {
      if (!current) throw new Error(`agent has no active genome: ${agentId}`);
      if (candidateManifest.agentId !== agentId) {
        throw new Error("candidate genome belongs to another agent");
      }
      if (candidateManifest.parentId !== current.manifest.genomeId) {
        throw new Error("candidate genome parent does not match active genome");
      }
      assertGenomeManifest(candidateManifest);

      await mkdir(this.candidateRoot, { recursive: true });
      const candidateDirectory = await mkdtemp(
        join(this.candidateRoot, `self-rewrite-${agentId}-`),
      );
      try {
        await cp(current.directory, candidateDirectory, {
          recursive: true,
          force: false,
        });
        await mutate(candidateDirectory, current.manifest);

        const pendingManifest = {
          ...candidateManifest,
          genomeHash: "sha256:pending",
        };
        await writeGenomeManifest(candidateDirectory, pendingManifest);
        const genomeHash = await hashDirectory(candidateDirectory);
        const validatedManifest = { ...pendingManifest, genomeHash };
        assertGenomeManifest(validatedManifest);
        await writeGenomeManifest(candidateDirectory, validatedManifest);

        await this.bootTest(candidateDirectory, validatedManifest);
        await this.regressionTest(candidateDirectory, validatedManifest);
        const revision = await this.revisions.create(
          validatedManifest,
          candidateDirectory,
        );
        return { status: "accepted", revision };
      } finally {
        await rm(candidateDirectory, { recursive: true, force: true });
      }
    } catch (error) {
      const failure: SelfRewriteFailure = {
        ...failurePrefix,
        reason: error instanceof Error ? error.message : String(error),
      };
      this.rejected.push(failure);
      return { status: "rejected", failure };
    }
  }

  public failures(): readonly SelfRewriteFailure[] {
    return [...this.rejected];
  }
}

async function defaultPluginBootTest(
  candidateDirectory: string,
  candidateManifest: GenomeManifest,
): Promise<void> {
  for (const pluginManifestPath of candidateManifest.plugins) {
    const loaded: LoadedPlugin = await loadPlugin(
      candidateDirectory,
      pluginManifestPath,
    );
    if (typeof loaded.module !== "object" || loaded.module === null) {
      throw new Error(`plugin boot returned an invalid module: ${pluginManifestPath}`);
    }
  }
}
