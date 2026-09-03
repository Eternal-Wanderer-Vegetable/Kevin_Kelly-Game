import type {
  AgentAction,
  CognitionProvider,
  CognitionRequest,
} from "../core/agent-core.js";

export class MockCognitionProvider implements CognitionProvider {
  private readonly requests: CognitionRequest[] = [];

  public constructor(
    private readonly action: AgentAction = {
      type: "NOOP",
      input: {},
    },
  ) {}

  public async think(request: CognitionRequest): Promise<AgentAction> {
    this.requests.push(request);
    return this.action;
  }

  public getRequests(): readonly CognitionRequest[] {
    return [...this.requests];
  }
}
