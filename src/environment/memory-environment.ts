import type {
  AgentAction,
  EnvironmentInterface,
  Observation,
} from "../core/agent-core.js";

export class MemoryEnvironment implements EnvironmentInterface {
  private readonly observations: Observation[];
  private readonly actions: AgentAction[] = [];

  public constructor(initialObservations: readonly Observation[]) {
    this.observations = [...initialObservations];
  }

  public async observe(): Promise<Observation> {
    const observation = this.observations.shift();
    if (!observation) {
      throw new Error("environment has no observation available");
    }
    return observation;
  }

  public async act(
    action: AgentAction,
  ): Promise<Readonly<Record<string, unknown>>> {
    this.actions.push(action);
    return { accepted: true, actionType: action.type };
  }

  public getActions(): readonly AgentAction[] {
    return [...this.actions];
  }
}
