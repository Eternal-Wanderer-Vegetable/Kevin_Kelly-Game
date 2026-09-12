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

import { open, stat, type FileHandle } from "node:fs/promises";
import {
  assertExperimentEvent,
  type ExperimentEvent,
} from "../contracts/index.js";

export interface EventsFileStatus {
  readonly size: number;
  readonly mtimeMs: number;
}

export interface EventsTailResult {
  readonly events: readonly ExperimentEvent[];
  /**
   * Byte offset just past the last complete line this call consumed. Only
   * whole newline-terminated lines advance it, so a writer caught mid-line is
   * picked up by the next call.
   */
  readonly nextOffset: number;
  /** Lines that parsed but failed the event contract, or were invalid JSON. */
  readonly skipped: number;
}

const READ_CHUNK_BYTES = 256 * 1024;

/**
 * Current size and mtime of an event log, or null when it does not exist yet.
 *
 * A dashboard starts before the first experiment does, so a missing log is a
 * normal observation, not an error.
 */
export async function statEventsFile(
  filePath: string,
): Promise<EventsFileStatus | null> {
  try {
    const stats = await stat(filePath);
    return { size: stats.size, mtimeMs: stats.mtimeMs };
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

/**
 * Reads at most `limit` newline-terminated events starting at `afterOffset`.
 *
 * The observer cannot afford EventLog.readAll's strictness: one malformed line
 * must not take down the whole dashboard, so bad lines are counted and skipped
 * while the offset still advances past them. Offsets are byte offsets, taken
 * from stat size, so they stay stable across restarts and across processes.
 *
 * An offset past EOF (a truncated or replaced log) resyncs to the new end of
 * file rather than failing.
 */
export async function tailEvents(
  filePath: string,
  afterOffset = 0,
  limit = 1000,
): Promise<EventsTailResult> {
  let handle: FileHandle;
  try {
    handle = await open(filePath, "r");
  } catch (error) {
    if (isMissingFile(error)) {
      return { events: [], nextOffset: Math.max(afterOffset, 0), skipped: 0 };
    }
    throw error;
  }

  try {
    const { size } = await handle.stat();
    let readFrom = Math.min(Math.max(afterOffset, 0), size);
    // `pending` always holds the bytes starting at absolute offset `consumed`.
    let consumed = readFrom;
    let pending = Buffer.alloc(0);
    const lines: Buffer[] = [];

    outer: while (readFrom < size) {
      const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, size - readFrom));
      const read = await handle.read(chunk, 0, chunk.length, readFrom);
      if (read.bytesRead <= 0) break;
      readFrom += read.bytesRead;
      pending =
        pending.length === 0
          ? read.buffer.subarray(0, read.bytesRead)
          : Buffer.concat([pending, read.buffer.subarray(0, read.bytesRead)]);
      for (;;) {
        const newline = pending.indexOf(0x0a);
        if (newline === -1) break;
        lines.push(pending.subarray(0, newline));
        pending = pending.subarray(newline + 1);
        consumed += newline + 1;
        if (lines.length >= limit) break outer;
      }
    }

    const events: ExperimentEvent[] = [];
    let skipped = 0;
    for (const line of lines) {
      const text = line.toString("utf8").trim();
      if (text === "") continue;
      try {
        const parsed: unknown = JSON.parse(text);
        assertExperimentEvent(parsed);
        events.push(parsed);
      } catch {
        skipped += 1;
      }
    }
    return { events, nextOffset: consumed, skipped };
  } finally {
    await handle.close();
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
