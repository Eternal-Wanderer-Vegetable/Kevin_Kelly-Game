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

import {
  assertExperimentEvent,
  type AgentLifecycleState,
  type ExperimentEvent,
} from "../contracts/index.js";

export interface ReplayState {
  readonly runId: string | null;
  readonly eventCount: number;
  readonly agents: ReadonlyMap<string, AgentLifecycleState>;
}

export function replayEvents(events: readonly ExperimentEvent[]): ReplayState {
  const agents = new Map<string, AgentLifecycleState>();
  let runId: string | null = null;

  for (const event of events) {
    assertExperimentEvent(event);
    if (runId === null) runId = event.runId;
    if (event.runId !== runId) {
      throw new Error("event log contains multiple run IDs");
    }

    if (event.type === "AGENT_STATE_CHANGED") {
      const lifecycle = event.payload.lifecycle;
      if (
        lifecycle !== "ACTIVE" &&
        lifecycle !== "DORMANT" &&
        lifecycle !== "DEAD"
      ) {
        throw new Error(`invalid lifecycle in event ${event.eventId}`);
      }
      if (!event.agentId) {
        throw new Error(`state event ${event.eventId} is missing agentId`);
      }
      agents.set(event.agentId, lifecycle);
    }
  }

  return {
    runId,
    eventCount: events.length,
    agents,
  };
}
