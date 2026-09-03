export interface CommandDefinition {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  readonly options: readonly string[];
}

export function formatHelp(command: CommandDefinition): string {
  return [
    `${command.name} - ${command.summary}`,
    "",
    "Usage:",
    `  ${command.usage}`,
    "",
    "Options:",
    ...command.options.map((option) => `  ${option}`),
    "",
  ].join("\n");
}

export function shouldShowHelp(args: readonly string[]): boolean {
  return args.length === 0 || args.includes("--help") || args.includes("-h");
}

export function reportNotImplemented(
  command: CommandDefinition,
  args: readonly string[],
): never {
  const received = args.length > 0 ? ` Received: ${args.join(" ")}` : "";
  throw new Error(
    `${command.name} execution is not implemented yet.${received}`,
  );
}
