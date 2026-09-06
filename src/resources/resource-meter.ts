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

import { randomUUID } from "node:crypto";
import type { UsageRecord } from "../contracts/index.js";

export interface ResourceMeterOptions {
  readonly agentId: string;
  readonly usageId?: string;
  readonly localModelCalls?: number;
  readonly externalModelCalls?: number;
}

export class ResourceMeter {
  private readonly startedAt = Date.now();
  private readonly resourceBefore = process.resourceUsage();

  public constructor(private readonly options: ResourceMeterOptions) {
    validateModelCallCount(options.localModelCalls, "localModelCalls");
    validateModelCallCount(options.externalModelCalls, "externalModelCalls");
  }

  public finish(): UsageRecord {
    const resourceAfter = process.resourceUsage();
    return {
      schemaVersion: 1,
      usageId: this.options.usageId ?? `usage-${randomUUID()}`,
      agentId: this.options.agentId,
      wallTimeMs: Date.now() - this.startedAt,
      cpuTimeMs:
        (resourceAfter.userCPUTime - this.resourceBefore.userCPUTime +
          resourceAfter.systemCPUTime -
          this.resourceBefore.systemCPUTime) /
        1000,
      memoryPeakBytes: Math.max(
        this.resourceBefore.maxRSS,
        resourceAfter.maxRSS,
      ) * 1024,
      localModelCalls: this.options.localModelCalls ?? 0,
      externalModelCalls: this.options.externalModelCalls ?? 0,
    };
  }
}

function validateModelCallCount(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}
