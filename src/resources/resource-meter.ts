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
