<div align="center">

# Kevin_Kelly-Game

*Don't design the agent. Evolve it.*

<p>An experimental TypeScript platform for studying whether coding agents can improve their own harnesses through controlled self-rewrite, genome inheritance, mutation, and independent evaluation.</p>

<p>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white" alt="Node.js 24 or newer"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8%2B-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.8 or newer"></a>
  <a href="https://nodejs.org/api/esm.html"><img src="https://img.shields.io/badge/ESM-Node.js%20ESM-339933?logo=node.js&logoColor=white" alt="Node.js ESM"></a>
  <a href="https://github.com/Eternal-Wanderer-Vegetable/Kevin_Kelly-Game/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Eternal-Wanderer-Vegetable/Kevin_Kelly-Game/ci.yml?branch=main&label=CI" alt="CI status"></a>
</p>

English | [中文](README.zh-CN.md)

</div>

The project is designed as an auditable research harness rather than a production autonomous coding system. It keeps the immutable control plane separate from agent-owned assets and records the state needed to reproduce and compare experiments.

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
- Interactive REPL with a real sandbox workspace and no-TTY text fallback

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
npm run run-generation
                     Run one calibration or generalization experiment generation
npm run replay-run   Show the event replay CLI help
npm run report       Show the report CLI help
npm run harness      Show the root harness CLI help
npm run harness -- repl --provider mock --goal "inspect the workspace"
npm run harness -- run-generation --plan ./plans/generation.json --format json
```

The command-line helpers currently expose the stable interfaces and help contracts used by the MVP. Use `npm run harness -- repl` for the interactive Observe -> Think -> Act session. Ink is loaded only by the TTY renderer; non-interactive commands, CI, and the text fallback do not load it. Experiment orchestration is also available directly through the TypeScript modules under `src/experiment/`.

`run-generation` accepts a schema version 1 JSON plan. Use `mode: "calibration"`
for one baseline/candidate task, or `mode: "generalization"` for evolution,
validation, and holdout partitions with precommitted thresholds. It appends
generation and experiment-run events to the configured JSONL event log. A
generalization report that fails its holdout checks exits with status 1.

## Container Deployment

```bash
docker build --target runtime -t evolving-coding-harness:dev .
docker compose run --rm harness --help
```

The Python variant is available with `--target runtime-python`. See
[`docs/container-deployment.md`](docs/container-deployment.md) for Compose
volumes, model endpoint configuration, resource limits, and the container
security boundary.

## Release Automation

Pushing a semantic version tag such as `v0.1.0` starts
[`.github/workflows/release.yml`](.github/workflows/release.yml). The workflow
runs typecheck, build, and tests, publishes the `runtime` and `runtime-python`
images to GHCR, and attaches a runnable archive to the GitHub Release. Stable
tags also update the `latest` image tag; prerelease tags such as `v0.2.0-rc.1`
do not.

## Using a Release

Replace `v0.1.0` below with the release tag you want to use. A release provides
two equivalent distribution paths:

### Release archive

The archive contains the compiled CLI, deployment files, and documentation. It
does not contain `node_modules`, so install production dependencies once after
extracting it. The archive is intentionally run through `dist`; its source-only
`npm run` scripts are not needed in a release package.

```bash
RELEASE_TAG=v0.1.0
ARCHIVE="evolving-coding-harness-${RELEASE_TAG}.tar.gz"
curl -fL -o "$ARCHIVE" \
  "https://github.com/Eternal-Wanderer-Vegetable/Kevin_Kelly-Game/releases/download/${RELEASE_TAG}/${ARCHIVE}"
tar -xzf "$ARCHIVE"
cd "evolving-coding-harness-${RELEASE_TAG}"

npm ci --omit=dev
node dist/scripts/harness.js --help
node dist/scripts/harness.js config
node dist/scripts/harness.js repl --provider mock --goal "inspect the workspace"
```

On PowerShell, the download and extraction can be written as:

```powershell
$releaseTag = "v0.1.0"
$archive = "evolving-coding-harness-$releaseTag.tar.gz"
Invoke-WebRequest `
  -Uri "https://github.com/Eternal-Wanderer-Vegetable/Kevin_Kelly-Game/releases/download/$releaseTag/$archive" `
  -OutFile $archive
tar -xzf $archive
Set-Location "evolving-coding-harness-$releaseTag"

npm ci --omit=dev
node dist/scripts/harness.js --help
```

The compiled entry points are:

```text
node dist/scripts/harness.js <command> ...
node dist/scripts/run-task.js --task <task-spec.json>
node dist/scripts/run-generation.js --plan <plan.json>
node dist/scripts/replay-run.js --input <events.jsonl>
node dist/scripts/report.js --input <events.jsonl>
```

For the interactive workflow, start with `repl`. Use
`--provider mock` for a local smoke test, `--provider local` for an
OpenAI-compatible local model, or `--provider external` for a configured
external endpoint. Run `node dist/scripts/harness.js <command> --help` for the
options of any command.

### GHCR images

The standard and Python-enabled images are published under separate image
names:

```text
ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game:<version>
ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game-python:<version>
```

For example, the stable `v0.1.0` release can be pulled and started with:

```bash
IMAGE=ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game:0.1.0
docker pull "$IMAGE"
docker run --rm "$IMAGE" --help
mkdir -p data experiments
docker run --rm -it \
  -v "$PWD/data:/app/data" \
  -v "$PWD/experiments:/app/experiments" \
  "$IMAGE" repl --provider mock --goal "inspect the workspace"
```

Use the `-python` image name when tasks need `python3` or `python3-venv`:

```bash
IMAGE=ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game-python:0.1.0
docker pull "$IMAGE"
docker run --rm "$IMAGE" --help
```

The Python image only provides the interpreter. A task must still include
`python3` in `TaskSpec.allowedCommands`.

To use the published image through the included Compose file:

```bash
export HARNESS_IMAGE=ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game:0.1.0
mkdir -p data experiments
docker compose pull
docker compose run --rm -it harness repl --provider mock --goal "inspect the workspace"
```

On PowerShell, set the image before running the same Compose commands:

```powershell
$env:HARNESS_IMAGE = "ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game:0.1.0"
New-Item -ItemType Directory -Force data, experiments | Out-Null
docker compose pull
docker compose run --rm -it harness repl --provider mock --goal "inspect the workspace"
```

The `data` and `experiments` mounts preserve event logs and experiment
artifacts. Stable releases publish `0.1.0`, `0.1`, and `latest` tags; a
prerelease publishes its full version tag, such as `0.2.0-rc.1`, but does not
move `latest`.

### Model configuration

The default smoke-test provider is `mock` and does not need a model service.
For a local OpenAI-compatible service, configure the endpoint and optional
credentials before starting the CLI or container:

```bash
export HARNESS_LOCAL_MODEL_URL=http://127.0.0.1:8000/v1
export HARNESS_LOCAL_MODEL_KEY=replace-me
export HARNESS_LOCAL_MODEL_NAME=local-model
node dist/scripts/harness.js config
node dist/scripts/harness.js repl --provider local --goal "inspect the workspace"
```

For a containerized local-model session, set the same variables and invoke the
Compose service instead:

```bash
export HARNESS_LOCAL_MODEL_URL=http://host.docker.internal:8000/v1
export HARNESS_LOCAL_MODEL_KEY=replace-me
export HARNESS_LOCAL_MODEL_NAME=local-model
docker compose run --rm -it harness repl --provider local --goal "inspect the workspace"
```

For the external tier, set `HARNESS_EXTERNAL_MODEL_URL`,
`HARNESS_EXTERNAL_MODEL_KEY`, and optionally `HARNESS_EXTERNAL_MODEL_NAME`, then
use `--provider external`. Container users should use
`http://host.docker.internal:8000/v1` for a model running on the host, or the
Compose service name for a model running in the same Compose project. Do not
use `127.0.0.1` to refer to either of those services from inside a container.

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
- [Containerization and CLI plan](design_docs/Evolving_Coding_Harness_容器化与CLI方案.md)
- [中文 README](README.zh-CN.md)

## CI

Every push and pull request runs:

1. `npm ci`
2. `npm run typecheck`
3. `npm run build`
4. `npm test`

The workflow is defined in `.github/workflows/ci.yml` and uses Node.js 24.

## License

This project is licensed under the GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE) for the full text.
