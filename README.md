# Evolving Coding Harness

An experimental TypeScript platform for studying whether coding agents can improve their own harnesses through controlled self-rewrite, genome inheritance, mutation, and independent evaluation.

The project is designed as an auditable research harness rather than a production autonomous coding system. It keeps the immutable control plane separate from agent-owned assets and records the state needed to reproduce and compare experiments.

[中文说明](README.zh-CN.md)

## Current Status

The implementation currently covers the complete first-stage engineering path:

- TypeScript and ESM project foundation
- Observe -> Think -> Act agent core
- Tool and environment boundaries
- Sandbox-backed coding tasks
- Independent evaluation and immutable Base Harness
- Resource metering and Energy ledger
- Versioned Genome, Plugin, Workflow, and Policy assets
- Individual Memory and candidate Plugin verification
- Self-Rewrite with validation and rollback-safe activation
- Clone, structural Mutation, and Embryo qualification
- Agent lifecycle, Population snapshots, and shared SLM queue
- Calibration experiments and holdout generalization evaluation

The repository is still an experimental MVP. It does not yet provide distributed execution, multi-agent collaboration, automatic task generation, or a production-grade persistence layer.

## Requirements

- Node.js 24 or newer
- npm
- TypeScript toolchain installed through the project dependencies

Python is optional. A Miniconda Python interpreter may be used by sandboxed tasks, but Python is not part of the Harness control plane.

## Quick Start

```powershell
npm install
npm run typecheck
npm run build
npm test
```

Tests are executed from the TypeScript sources with `tsx`. The build output is written to `dist/`.

## Available Commands

```text
npm run dev          Start the project entry point
npm run typecheck    Run TypeScript without emitting files
npm run build        Compile TypeScript to dist/
npm test             Run the test suite
npm run run-task     Show the task runner CLI help
npm run replay-run   Show the event replay CLI help
npm run report       Show the report CLI help
```

The command-line helpers currently expose the stable interfaces and help contracts used by the MVP. Experiment orchestration is also available directly through the TypeScript modules under `src/experiment/`.

## Architecture

The system is organized around three boundaries:

```text
Control Plane
  Task / Population / Lifecycle / Evaluation / Energy / Experiment

Execution Plane
  Core / Environment / Provider / Scheduler / Sandbox / Tools

Asset Plane
  Genome / Plugin / Workflow / Policy / Memory / Archive / Event Log
```

The control plane owns experiment rules and evaluation. The execution plane is the only path through which an agent interacts with a task workspace. The asset plane stores versioned and auditable agent-owned artifacts.

Important invariants include:

- Agents cannot modify Core, Evaluation, Energy, or Sandbox control rules.
- A failed Self-Rewrite does not change the active Genome.
- A failed Embryo is archived and does not enter the active Population.
- Ordinary Individual Memory is not automatically inherited by a child.
- A candidate Plugin requires repeated successful verification before promotion.
- Base Harness assets remain immutable as the Generation 0 control group.
- Holdout tasks are kept separate from evolution and validation tasks.

## Project Layout

```text
src/
  contracts/      Shared runtime-validated contracts
  core/           Agent lifecycle and turn execution
  environment/   Agent-facing environment and tools
  evaluation/    Independent evaluation and Base Harness
  energy/         Resource and Energy accounting
  experiment/     Event logs, calibration, and generalization
  evolution/      Self-Rewrite, Clone, Mutation, and Embryo logic
  genome/         Genome revisions and asset loading
  lifecycle/      Population state and legacy archiving
  memory/         Individual Memory and candidate Plugins
  sandbox/        Workspace isolation and command execution
  scheduler/      Shared local SLM queue
  tasks/          Reproducible coding task execution

test/             Automated unit and integration tests
scripts/          CLI helper entry points
design_docs/      Architecture and implementation plans
.github/workflows Continuous integration
```

## Reproducible Experiments

Experiments should record:

- The repository commit and fixed task input commit
- TaskSpec and Core hashes
- Genome and provider configuration hashes
- Scheduler, Energy, timeout, and fitness configuration
- Random seed, when randomness is introduced
- Complete event history and evaluation output

The Phase 10 and Phase 11 experiment modules provide fixed task/configuration identity, baseline comparison, calibration change records, partitioned evolution/validation/holdout tasks, and precommitted generalization thresholds.

## Safety Scope

The sandbox is intended for controlled experiments. Do not run untrusted mutation code against production files or sensitive host resources. Keep important experiments isolated from personal and production environments until the threat model and operational controls have been reviewed.

## Documentation

- [Engineering design](design_docs/Evolving_Coding_Harness_工程方案.md)
- [Implementation plan](design_docs/Evolving_Coding_Harness_落地实施方案.md)
- [中文 README](README.zh-CN.md)

## CI

Every push and pull request runs:

1. `npm ci`
2. `npm run typecheck`
3. `npm run build`
4. `npm test`

The workflow is defined in `.github/workflows/ci.yml` and uses Node.js 24.

## License

No license has been declared yet. Treat the repository as all-rights-reserved unless a license is added.
