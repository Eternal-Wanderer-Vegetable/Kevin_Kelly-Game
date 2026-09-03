import type {
  AgentAction,
  EnvironmentInterface,
  Observation,
} from "../core/agent-core.js";
import {
  TOOL_NAMES,
  type ToolName,
  type ToolRegistry,
} from "./tool-registry.js";

export interface MemoryToolEnvironmentOptions {
  readonly observations: readonly Observation[];
}

export class MemoryToolEnvironment implements EnvironmentInterface {
  private readonly observations: Observation[];

  public constructor(
    private readonly tools: ToolRegistry,
    options: MemoryToolEnvironmentOptions,
  ) {
    this.observations = [...options.observations];
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
    if (!isToolName(action.type)) {
      throw new Error(`unknown tool action: ${action.type}`);
    }

    const result = await this.tools.invoke({
      name: action.type,
      input: action.input,
    });
    return { ok: result.ok, ...result.output };
  }
}

function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}
