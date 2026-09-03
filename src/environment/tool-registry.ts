export const TOOL_NAMES = [
  "read",
  "search",
  "write",
  "exec",
  "test",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolCall {
  readonly name: ToolName;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ToolResult {
  readonly ok: boolean;
  readonly output: Readonly<Record<string, unknown>>;
}

export type ToolHandler = (
  input: Readonly<Record<string, unknown>>,
) => Promise<ToolResult>;

export class ToolRegistry {
  private readonly handlers = new Map<ToolName, ToolHandler>();

  public register(name: ToolName, handler: ToolHandler): void {
    if (this.handlers.has(name)) {
      throw new Error(`tool ${name} is already registered`);
    }
    this.handlers.set(name, handler);
  }

  public async invoke(call: ToolCall): Promise<ToolResult> {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      throw new Error(`tool ${call.name} is not registered`);
    }
    return handler(call.input);
  }

  public has(name: ToolName): boolean {
    return this.handlers.has(name);
  }
}
