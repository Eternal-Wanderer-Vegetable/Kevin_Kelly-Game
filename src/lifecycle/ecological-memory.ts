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

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertPluginManifest,
  type PluginManifest,
} from "../contracts/index.js";

/**
 * Ecological memory: what the world remembers after an agent dies.
 *
 * Individual memory dies with the agent by design; the ecological index is
 * the complementary store — an append-only record of every dead agent's
 * genome, death reason and verified plugins. Living agents (and the
 * evolution loop) can read it to inherit proven assets, which is how "death
 * itself becomes an information resource".
 */
export interface EcologicalRecord {
  readonly schemaVersion: 1;
  readonly agentId: string;
  readonly genomeId: string;
  readonly generation: number;
  readonly deathReason: string;
  readonly archiveDirectory: string;
  readonly verifiedPlugins: readonly PluginManifest[];
  readonly recordedAt: string;
}

export class EcologicalMemoryIndex {
  private readonly records: EcologicalRecord[] = [];

  public constructor(private readonly indexPath: string) {}

  public async recordDeath(entry: {
    readonly agentId: string;
    readonly genomeId: string;
    readonly generation: number;
    readonly deathReason: string;
    readonly archiveDirectory: string;
    readonly verifiedPlugins: readonly PluginManifest[];
  }): Promise<EcologicalRecord> {
    for (const plugin of entry.verifiedPlugins) {
      assertPluginManifest(plugin);
    }
    const record: EcologicalRecord = {
      schemaVersion: 1,
      agentId: entry.agentId,
      genomeId: entry.genomeId,
      generation: entry.generation,
      deathReason: entry.deathReason,
      archiveDirectory: entry.archiveDirectory,
      verifiedPlugins: [...entry.verifiedPlugins],
      recordedAt: new Date().toISOString(),
    };
    this.records.push(record);
    await mkdir(dirname(this.indexPath), { recursive: true });
    await appendFile(this.indexPath, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  public all(): readonly EcologicalRecord[] {
    return [...this.records];
  }

  /**
   * Verified plugins left by dead agents, deduplicated by pluginId. A new
   * generation may adopt these into a candidate genome — the inheritance
   * path for proven digital assets that outlived their creator.
   */
  public inheritablePlugins(): readonly PluginManifest[] {
    const seen = new Set<string>();
    const plugins: PluginManifest[] = [];
    for (const record of this.records) {
      for (const plugin of record.verifiedPlugins) {
        if (seen.has(plugin.pluginId)) continue;
        seen.add(plugin.pluginId);
        plugins.push(plugin);
      }
    }
    return plugins;
  }

  public async load(): Promise<readonly EcologicalRecord[]> {
    let contents: string;
    try {
      contents = await readFile(this.indexPath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    for (const line of contents.split(/\r?\n/).filter(Boolean)) {
      const parsed = JSON.parse(line) as EcologicalRecord;
      if (parsed.schemaVersion !== 1) {
        throw new Error(`unsupported ecological record schema: ${parsed.schemaVersion}`);
      }
      this.records.push(parsed);
    }
    return [...this.records];
  }
}

export function defaultEcologyIndexPath(archiveRoot: string): string {
  return join(archiveRoot, "ecology-index.jsonl");
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
