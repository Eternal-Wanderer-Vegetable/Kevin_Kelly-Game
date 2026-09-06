import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import {
  assertCandidatePlugin,
  assertIndividualMemory,
  type CandidatePlugin,
  type IndividualMemory,
  type PluginManifest,
} from "../contracts/index.js";

export interface MemoryInput {
  readonly taskId: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly summary: string;
  readonly outcome: IndividualMemory["outcome"];
  readonly recordedAt?: string;
}

export class IndividualMemoryStore {
  private readonly memories: IndividualMemory[] = [];

  public constructor(private readonly agentId: string) {}

  public record(input: MemoryInput): IndividualMemory {
    const memory: IndividualMemory = {
      schemaVersion: 1,
      memoryId: `memory-${randomUUID()}`,
      agentId: this.agentId,
      taskId: input.taskId,
      context: input.context,
      summary: input.summary,
      outcome: input.outcome,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
    };
    assertIndividualMemory(memory);
    this.memories.push(memory);
    return memory;
  }

  public all(): readonly IndividualMemory[] {
    return [...this.memories];
  }

  // Memory is individual state; a child starts with an empty memory store.
  public cloneForChild(agentId: string): IndividualMemoryStore {
    return new IndividualMemoryStore(agentId);
  }

  public async save(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const contents = this.memories.map((memory) => JSON.stringify(memory)).join("\n");
    await appendFile(filePath, contents ? `${contents}\n` : "", "utf8");
  }

  public async load(filePath: string): Promise<readonly IndividualMemory[]> {
    const contents = await readFile(filePath, "utf8");
    const loaded: IndividualMemory[] = [];
    for (const line of contents.split(/\r?\n/).filter(Boolean)) {
      const parsed: unknown = JSON.parse(line);
      assertIndividualMemory(parsed);
      if (parsed.agentId !== this.agentId) {
        throw new Error(`memory belongs to another agent: ${parsed.memoryId}`);
      }
      loaded.push(parsed);
    }
    this.memories.push(...loaded);
    return [...loaded];
  }
}

export interface CandidatePluginInput {
  readonly plugin: PluginManifest;
  readonly sourceMemoryIds: readonly string[];
  readonly verificationTaskIds: readonly string[];
}

export class CandidatePluginRegistry {
  private readonly candidates = new Map<string, CandidatePlugin>();

  public constructor(private readonly agentId: string) {}

  public create(input: CandidatePluginInput): CandidatePlugin {
    const candidate: CandidatePlugin = {
      schemaVersion: 1,
      candidateId: `candidate-${randomUUID()}`,
      agentId: this.agentId,
      plugin: input.plugin,
      sourceMemoryIds: [...input.sourceMemoryIds],
      verificationTaskIds: [...input.verificationTaskIds],
      successfulVerificationTaskIds: [],
      successfulVerificationCount: 0,
      status: "candidate",
    };
    assertCandidatePlugin(candidate);
    this.candidates.set(candidate.candidateId, candidate);
    return candidate;
  }

  public recordVerification(
    candidateId: string,
    taskId: string,
    succeeded: boolean,
  ): CandidatePlugin {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) throw new Error(`unknown candidate plugin: ${candidateId}`);
    if (!candidate.verificationTaskIds.includes(taskId)) {
      throw new Error(`task is not registered for candidate verification: ${taskId}`);
    }
    const successfulVerificationTaskIds = succeeded &&
        !candidate.successfulVerificationTaskIds.includes(taskId)
      ? [...candidate.successfulVerificationTaskIds, taskId]
      : [...candidate.successfulVerificationTaskIds];
    const successfulVerificationCount = successfulVerificationTaskIds.length;
    const status =
      successfulVerificationCount >= 2 ? "verified" : "candidate";
    const updated: CandidatePlugin = {
      ...candidate,
      successfulVerificationTaskIds,
      successfulVerificationCount,
      status,
    };
    assertCandidatePlugin(updated);
    this.candidates.set(candidateId, updated);
    return updated;
  }

  public get(candidateId: string): CandidatePlugin {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) throw new Error(`unknown candidate plugin: ${candidateId}`);
    return candidate;
  }

  public verifiedPlugins(): readonly PluginManifest[] {
    return [...this.candidates.values()]
      .filter((candidate) => candidate.status === "verified")
      .map((candidate) => candidate.plugin);
  }
}
