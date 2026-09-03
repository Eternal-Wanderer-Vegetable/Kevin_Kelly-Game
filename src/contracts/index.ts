export const CONTRACT_SCHEMA_VERSION = 1 as const;

export type AgentLifecycleState = "ACTIVE" | "DORMANT" | "DEAD";
export type TaskLevel = 1 | 2 | 3;
export type HumanAcceptance = "accept" | "reject" | 1 | 2 | 3 | 4 | 5;

export interface TaskSpec {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly taskId: string;
  readonly level: TaskLevel;
  readonly title: string;
  readonly repository: {
    readonly source: string;
    readonly commit: string;
  };
  readonly allowedCommands: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly baselineTestCommand: string;
}

export interface GenomeManifest {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly genomeId: string;
  readonly agentId: string;
  readonly parentId: string | null;
  readonly generation: number;
  readonly plugins: readonly string[];
  readonly workflows: readonly string[];
  readonly policies: readonly string[];
  readonly dependencies: readonly string[];
  readonly coreHash: string;
  readonly genomeHash: string;
}

export interface UsageRecord {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly usageId: string;
  readonly agentId: string;
  readonly wallTimeMs: number;
  readonly cpuTimeMs: number;
  readonly memoryPeakBytes: number;
  readonly localModelCalls: number;
  readonly externalModelCalls: number;
}

export interface EvaluationResult {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly evaluationId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly taskSuccess: boolean;
  readonly testPassRate: number;
  readonly regressionRate: number;
  readonly runtimeMs: number;
  readonly resourceConsumption: UsageRecord;
  readonly stability: number;
  readonly humanAcceptance?: HumanAcceptance;
}

export interface ExperimentEvent {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly eventId: string;
  readonly runId: string;
  readonly timestamp: string;
  readonly type: string;
  readonly agentId?: string;
  readonly generation?: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type AgentState = {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly agentId: string;
  readonly generation: number;
  readonly lifecycle: AgentLifecycleState;
  readonly energy: number;
  readonly genomeId: string;
};

export function assertTaskSpec(value: unknown): asserts value is TaskSpec {
  assertObject(value, "TaskSpec");
  assertExactKeys(value, [
    "schemaVersion",
    "taskId",
    "level",
    "title",
    "repository",
    "allowedCommands",
    "acceptanceCriteria",
    "baselineTestCommand",
  ]);
  assertSchemaVersion(value, "TaskSpec");
  assertString(value.taskId, "taskId");
  if (value.level !== 1 && value.level !== 2 && value.level !== 3) {
    throw new TypeError("TaskSpec.level must be 1, 2, or 3");
  }
  assertString(value.title, "title");
  assertObject(value.repository, "TaskSpec.repository");
  assertExactKeys(value.repository, ["source", "commit"]);
  assertString(value.repository.source, "repository.source");
  assertString(value.repository.commit, "repository.commit");
  assertStringArray(value.allowedCommands, "allowedCommands");
  assertStringArray(value.acceptanceCriteria, "acceptanceCriteria");
  assertString(value.baselineTestCommand, "baselineTestCommand");
}

export function assertGenomeManifest(
  value: unknown,
): asserts value is GenomeManifest {
  assertObject(value, "GenomeManifest");
  assertExactKeys(value, [
    "schemaVersion",
    "genomeId",
    "agentId",
    "parentId",
    "generation",
    "plugins",
    "workflows",
    "policies",
    "dependencies",
    "coreHash",
    "genomeHash",
  ]);
  assertSchemaVersion(value, "GenomeManifest");
  assertString(value.genomeId, "genomeId");
  assertString(value.agentId, "agentId");
  if (value.parentId !== null) assertString(value.parentId, "parentId");
  assertNonNegativeInteger(value.generation, "generation");
  assertStringArray(value.plugins, "plugins");
  assertStringArray(value.workflows, "workflows");
  assertStringArray(value.policies, "policies");
  assertStringArray(value.dependencies, "dependencies");
  assertString(value.coreHash, "coreHash");
  assertString(value.genomeHash, "genomeHash");
}

export function assertAgentState(value: unknown): asserts value is AgentState {
  assertObject(value, "AgentState");
  assertExactKeys(value, [
    "schemaVersion",
    "agentId",
    "generation",
    "lifecycle",
    "energy",
    "genomeId",
  ]);
  assertSchemaVersion(value, "AgentState");
  assertString(value.agentId, "agentId");
  assertNonNegativeInteger(value.generation, "generation");
  if (!["ACTIVE", "DORMANT", "DEAD"].includes(String(value.lifecycle))) {
    throw new TypeError("AgentState.lifecycle is invalid");
  }
  assertFiniteNumber(value.energy, "energy");
  assertString(value.genomeId, "genomeId");
}

export function assertExperimentEvent(
  value: unknown,
): asserts value is ExperimentEvent {
  assertObject(value, "ExperimentEvent");
  const allowedKeys = [
    "schemaVersion",
    "eventId",
    "runId",
    "timestamp",
    "type",
    "agentId",
    "generation",
    "payload",
  ] as const;
  const actualKeys = Object.keys(value);
  const unknownKey = actualKeys.find(
    (key) => !allowedKeys.includes(key as (typeof allowedKeys)[number]),
  );
  if (unknownKey) {
    throw new TypeError(`ExperimentEvent contains unknown field: ${unknownKey}`);
  }
  assertSchemaVersion(value, "ExperimentEvent");
  assertString(value.eventId, "eventId");
  assertString(value.runId, "runId");
  assertString(value.timestamp, "timestamp");
  assertString(value.type, "type");
  if ("agentId" in value) assertString(value.agentId, "agentId");
  if ("generation" in value) {
    assertNonNegativeInteger(value.generation, "generation");
  }
  assertObject(value.payload, "payload");
}

function assertObject(
  value: unknown,
  name: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (
    actual.length !== allowed.length ||
    actual.some((key, index) => key !== allowed[index])
  ) {
    throw new TypeError("contract contains unknown or missing fields");
  }
}

function assertSchemaVersion(
  value: Record<string, unknown>,
  name: string,
): void {
  if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    throw new TypeError(`${name}.schemaVersion is unsupported`);
  }
}

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertStringArray(
  value: unknown,
  name: string,
): asserts value is readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  value.forEach((item, index) => assertString(item, `${name}[${index}]`));
}

function assertNonNegativeInteger(
  value: unknown,
  name: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}

function assertFiniteNumber(
  value: unknown,
  name: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}
