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

import { readFile } from "node:fs/promises";
import { platform } from "node:os";

export interface ChildProcessUsage {
  readonly cpuTimeMs: number;
  readonly memoryPeakBytes: number;
}

/**
 * Samples a child's real CPU ticks and peak RSS from /proc. Returns null on
 * non-Linux hosts or when the process already exited — callers must keep the
 * controller-process reading rather than fabricating numbers.
 */
export interface ChildUsageSampler {
  sample(pid: number): Promise<ChildProcessUsage | null>;
}

/** Jiffies → milliseconds. USER_HZ is 100 on effectively every Linux. */
const JIFFY_MS = 10;

export function createProcfsSampler(
  procRoot = "/proc",
): ChildUsageSampler | null {
  if (platform() !== "linux") return null;
  let peakBytes = 0;
  return {
    async sample(pid: number): Promise<ChildProcessUsage | null> {
      let cpuTimeMs = 0;
      try {
        const stat = await readFile(`${procRoot}/${pid}/stat`, "utf8");
        // Field layout: pid (comm) state ppid ... utime(14) stime(15).
        // comm may contain spaces, so split after the last ')'.
        const tail = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
        const utime = Number.parseInt(tail[11] ?? "0", 10);
        const stime = Number.parseInt(tail[12] ?? "0", 10);
        if (Number.isFinite(utime) && Number.isFinite(stime)) {
          cpuTimeMs = (utime + stime) * JIFFY_MS;
        }
      } catch {
        return null;
      }
      try {
        const status = await readFile(`${procRoot}/${pid}/status`, "utf8");
        const match = status.match(/^VmHWM:\s+(\d+)\s+kB$/m);
        if (match !== null && match[1] !== undefined) {
          peakBytes = Math.max(peakBytes, Number.parseInt(match[1], 10) * 1024);
        }
      } catch {
        // Status may be gone while stat still worked; keep the CPU sample.
      }
      return { cpuTimeMs, memoryPeakBytes: peakBytes };
    },
  };
}

/**
 * Drives a sampler over a child pid until stopped. `finish()` returns the
 * last good sample so a dead child still reports what was observed.
 */
export class ChildUsageMonitor {
  private last: ChildProcessUsage | null = null;
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly sampler: ChildUsageSampler,
    private readonly pid: number,
    private readonly intervalMs = 100,
  ) {}

  public start(): void {
    this.timer = setInterval(() => {
      void this.sampler.sample(this.pid).then((usage) => {
        if (usage !== null) this.last = usage;
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  public async finish(): Promise<ChildProcessUsage | null> {
    if (this.timer !== undefined) clearInterval(this.timer);
    const final = await this.sampler.sample(this.pid);
    if (final !== null) this.last = final;
    return this.last;
  }
}
