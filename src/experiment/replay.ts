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
