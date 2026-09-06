import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertGenomeManifest,
  type EnergyTransaction,
  type GenomeManifest,
} from "../contracts/index.js";
import { loadPlugin } from "../genome/loader.js";
import {
  hashDirectory,
  GenomeRevisionStore,
  writeGenomeManifest,
  type GenomeRevision,
} from "../genome/revision-store.js";
import { EnergyLedger } from "../energy/ledger.js";

export type GenomeMutation =
  | { readonly kind: "add-plugin"; readonly plugin: string }
  | { readonly kind: "delete-plugin"; readonly plugin: string }
  | {
      readonly kind: "copy-plugin";
      readonly source: string;
      readonly target: string;
    }
  | {
      readonly kind: "modify-plugin";
      readonly plugin: string;
      readonly replacement: string;
    }
  | { readonly kind: "modify-workflow"; readonly workflow: string }
  | { readonly kind: "modify-policy"; readonly policy: string }
  | { readonly kind: "create-tool"; readonly tool: string };

export interface MutationRecord {
  readonly mutationId: string;
  readonly parentGenomeId: string;
  readonly childGenomeId: string;
  readonly kind: GenomeMutation["kind"];
  readonly details: Readonly<Record<string, string>>;
}

export interface EmbryoFailure {
  readonly childAgentId: string;
  readonly childGenomeId: string;
  readonly reason: string;
  readonly archiveDirectory: string;
}

export type EmbryoResult =
  | {
      readonly status: "born";
      readonly revision: GenomeRevision;
      readonly payment: EnergyTransaction;
      readonly mutations: readonly MutationRecord[];
    }
  | {
      readonly status: "dead";
      readonly failure: EmbryoFailure;
      readonly payment: EnergyTransaction;
      readonly mutations: readonly MutationRecord[];
    };

export type EmbryoCheck = (
  candidateDirectory: string,
  candidateManifest: GenomeManifest,
) => Promise<void>;

export class CloneEmbryoService {
  private readonly failuresList: EmbryoFailure[] = [];

  public constructor(
    private readonly revisions: GenomeRevisionStore,
    private readonly energy: EnergyLedger,
    private readonly candidateRoot: string,
    private readonly archiveRoot: string,
    private readonly manifestTest: EmbryoCheck = async (_directory, manifest) => {
      assertGenomeManifest(manifest);
    },
    private readonly bootTest: EmbryoCheck = defaultPluginLoadTest,
    private readonly pluginLoadTest: EmbryoCheck = defaultPluginLoadTest,
    private readonly codingTest: EmbryoCheck = async () => {},
  ) {}

  public async clone(
    parentAgentId: string,
    childAgentId: string,
    childManifest: GenomeManifest,
    mutations: readonly GenomeMutation[],
  ): Promise<EmbryoResult> {
    const payment = this.energy.debit(parentAgentId, "clone");
    const mutationRecords: MutationRecord[] = [];
    const parent = this.revisions.current(parentAgentId);
    const failurePrefix = {
      childAgentId,
      childGenomeId: childManifest.genomeId,
    };

    try {
      if (payment.amount > payment.balanceBefore) {
        throw new Error("parent lacks sufficient energy for clone");
      }
      if (!parent) throw new Error(`parent has no active genome: ${parentAgentId}`);
      if (childManifest.agentId !== childAgentId) {
        throw new Error("child genome belongs to another agent");
      }
      if (childManifest.parentId !== parent.manifest.genomeId) {
        throw new Error("child genome parent does not match parent genome");
      }
      const mutatedManifest = applyMutations(
        childManifest,
        parent.manifest.genomeId,
        mutations,
        mutationRecords,
      );
      assertGenomeManifest(mutatedManifest);

      await mkdir(this.candidateRoot, { recursive: true });
      await mkdir(this.archiveRoot, { recursive: true });
      const candidateDirectory = await mkdtemp(
        join(this.candidateRoot, `embryo-${childAgentId}-`),
      );
      try {
        await cp(parent.directory, candidateDirectory, {
          recursive: true,
          force: false,
        });
        const pendingManifest = {
          ...mutatedManifest,
          genomeHash: "sha256:pending",
        };
        await writeGenomeManifest(candidateDirectory, pendingManifest);
        const genomeHash = await hashDirectory(candidateDirectory);
        const validatedManifest = { ...pendingManifest, genomeHash };
        await writeGenomeManifest(candidateDirectory, validatedManifest);

        await this.manifestTest(candidateDirectory, validatedManifest);
        await this.bootTest(candidateDirectory, validatedManifest);
        await this.pluginLoadTest(candidateDirectory, validatedManifest);
        await this.codingTest(candidateDirectory, validatedManifest);

        const revision = await this.revisions.create(
          validatedManifest,
          candidateDirectory,
        );
        return {
          status: "born",
          revision,
          payment,
          mutations: mutationRecords,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const archiveDirectory = join(
          this.archiveRoot,
          `${childAgentId}-${childManifest.genomeId}-${randomUUID()}`,
        );
        await cp(candidateDirectory, archiveDirectory, {
          recursive: true,
          force: false,
        });
        const failure: EmbryoFailure = {
          ...failurePrefix,
          reason,
          archiveDirectory,
        };
        await writeFile(
          join(archiveDirectory, "failure.json"),
          `${JSON.stringify(failure, null, 2)}\n`,
          "utf8",
        );
        this.failuresList.push(failure);
        return {
          status: "dead",
          failure,
          payment,
          mutations: mutationRecords,
        };
      } finally {
        await rm(candidateDirectory, { recursive: true, force: true });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const archiveDirectory = join(
        this.archiveRoot,
        `${childAgentId}-${childManifest.genomeId}-${randomUUID()}`,
      );
      await mkdir(archiveDirectory, { recursive: true });
      const failure: EmbryoFailure = {
        ...failurePrefix,
        reason,
        archiveDirectory,
      };
      await writeFile(
        join(archiveDirectory, "failure.json"),
        `${JSON.stringify(failure, null, 2)}\n`,
        "utf8",
      );
      this.failuresList.push(failure);
      return {
        status: "dead",
        failure,
        payment,
        mutations: mutationRecords,
      };
    }
  }

  public failures(): readonly EmbryoFailure[] {
    return [...this.failuresList];
  }
}

export function applyMutations(
  manifest: GenomeManifest,
  parentGenomeId: string,
  mutations: readonly GenomeMutation[],
  records: MutationRecord[] = [],
): GenomeManifest {
  const next = {
    ...manifest,
    plugins: [...manifest.plugins],
    workflows: [...manifest.workflows],
    policies: [...manifest.policies],
    dependencies: [...manifest.dependencies],
  };
  for (const mutation of mutations) {
    switch (mutation.kind) {
      case "add-plugin":
        addUnique(next.plugins, mutation.plugin);
        break;
      case "delete-plugin":
        removeValue(next.plugins, mutation.plugin);
        break;
      case "copy-plugin":
        addUnique(next.plugins, mutation.target);
        break;
      case "modify-plugin":
        replaceValue(next.plugins, mutation.plugin, mutation.replacement);
        break;
      case "modify-workflow":
        addUnique(next.workflows, mutation.workflow);
        break;
      case "modify-policy":
        addUnique(next.policies, mutation.policy);
        break;
      case "create-tool":
        addUnique(next.dependencies, `tool:${mutation.tool}`);
        break;
    }
    records.push({
      mutationId: `mutation-${randomUUID()}`,
      parentGenomeId,
      childGenomeId: manifest.genomeId,
      kind: mutation.kind,
      details: mutationDetails(mutation),
    });
  }
  return next;
}

async function defaultPluginLoadTest(
  candidateDirectory: string,
  candidateManifest: GenomeManifest,
): Promise<void> {
  for (const plugin of candidateManifest.plugins) {
    await loadPlugin(candidateDirectory, plugin);
  }
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function removeValue(values: string[], value: string): void {
  const index = values.indexOf(value);
  if (index >= 0) values.splice(index, 1);
}

function replaceValue(values: string[], from: string, to: string): void {
  const index = values.indexOf(from);
  if (index < 0) throw new Error(`mutation target is missing: ${from}`);
  values[index] = to;
}

function mutationDetails(mutation: GenomeMutation): Record<string, string> {
  if (mutation.kind === "copy-plugin") {
    return { source: mutation.source, target: mutation.target };
  }
  if (mutation.kind === "modify-plugin") {
    return { plugin: mutation.plugin, replacement: mutation.replacement };
  }
  if ("plugin" in mutation) return { plugin: mutation.plugin };
  if ("workflow" in mutation) return { workflow: mutation.workflow };
  if ("policy" in mutation) return { policy: mutation.policy };
  return { tool: mutation.tool };
}
