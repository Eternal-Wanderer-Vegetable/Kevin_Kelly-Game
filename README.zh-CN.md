<div align="center">

# Kevin_Kelly-Game

*“人设则滞，天演乃成”*

<p>这是一个使用 TypeScript 实现的实验性平台，用于研究 Coding Agent 是否能够在受控环境中通过 Self-Rewrite、Genome 遗传、结构化 Mutation 和独立 Evaluation，逐步改进自己的 Harness。</p>

<p>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white" alt="Node.js 24 或更高版本"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8%2B-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.8 或更高版本"></a>
  <a href="https://nodejs.org/api/esm.html"><img src="https://img.shields.io/badge/ESM-Node.js%20ESM-339933?logo=node.js&logoColor=white" alt="Node.js ESM"></a>
  <a href="https://github.com/Eternal-Wanderer-Vegetable/Kevin_Kelly-Game/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Eternal-Wanderer-Vegetable/Kevin_Kelly-Game/ci.yml?branch=main&label=CI" alt="CI 状态"></a>
</p>

[English](README.md) | 中文
</div>

本项目定位为可审计、可复现实验平台，而不是生产级自主编程系统。系统将不可修改的控制平面与 Agent 所有的资产分离，并记录复现实验和比较结果所需的状态。

## 当前状态

第一阶段工程路径已经完成，当前包含：

- TypeScript 与 ESM 工程基础
- Observe -> Think -> Act Agent Core
- 工具与环境边界
- 基于 Sandbox 的 Coding Task
- 独立 Evaluation 与不可变 Base Harness
- Resource Meter 与 Energy Ledger
- 版本化 Genome、Plugin、Workflow 和 Policy
- Individual Memory 与候选 Plugin 验证
- 带校验和安全激活的 Self-Rewrite
- Clone、结构化 Mutation 与 Embryo 资格检查
- Agent 生命周期、Population Snapshot 与共享 SLM 队列
- 参数校准实验与 holdout 泛化评估
- 使用真实 Sandbox 工作区的交互式 REPL，以及无 TTY 文本回退

仓库仍然是实验性 MVP，暂不提供分布式执行、多 Agent 协作、自动任务生成或生产级持久化层。

## 环境要求

- Node.js 24 或更高版本
- npm
- 项目依赖中的 TypeScript 工具链

Python 是可选项。Miniconda Python 可以作为 Sandbox Task 的执行运行时，但 Python 不是 Harness 控制平面的主要实现语言。

## 快速开始

```powershell
npm install
npm run typecheck
npm run build
npm test
```

测试通过 `tsx` 直接执行 TypeScript 源文件，构建结果写入 `dist/`。

## 可用命令

```text
npm run dev          启动项目入口
npm run typecheck    运行 TypeScript 类型检查，不生成文件
npm run build        将 TypeScript 编译到 dist/
npm test             运行测试套件
npm run run-task     显示任务运行器帮助
npm run run-generation
                     运行一代校准或泛化实验
npm run replay-run   显示事件重放帮助
npm run report       显示报告命令帮助
npm run harness      显示 Harness 根命令帮助
npm run harness -- repl --provider mock --goal "检查工作区"
npm run harness -- run-generation --plan ./plans/generation.json --format json
```

CLI 辅助命令目前主要提供 MVP 所需的稳定接口和帮助契约。使用
`npm run harness -- repl` 启动 Observe -> Think -> Act 交互会话。Ink 只在 TTY
渲染路径中动态加载；非交互命令、CI 和文本回退不会加载它。实验编排能力也可以
直接通过 `src/experiment/` 下的 TypeScript 模块使用。

`run-generation` 接受 schema version 1 的 JSON 计划。使用
`mode: "calibration"` 执行一次 baseline/candidate 任务对照，或使用
`mode: "generalization"` 执行 evolution、validation 和 holdout 分区，并按预先
提交的阈值判定结果。命令会把 generation 与 experiment-run 事件追加到 JSONL
事件日志；当泛化报告未通过 holdout 检查时返回状态码 1。

## 容器化部署

Docker Compose 已经封装了构建、数据目录、运行时安全边界和交互式 REPL。
在安装 Docker Desktop 或 Docker Engine + Compose 后，推荐直接执行：

```bash
./deploy.sh
```

Windows PowerShell：

```powershell
.\deploy.ps1
```

默认使用 `mock` provider 做无密钥冒烟。使用已发布镜像时：

```bash
./deploy.sh --release
./deploy.sh --release 0.1.0 --python
```

真实模型可以先复制 `.env.example` 为 `.env`，填写
`HARNESS_LOCAL_MODEL_URL`、`HARNESS_LOCAL_MODEL_KEY` 和
`HARNESS_LOCAL_MODEL_NAME`，再执行 `./deploy.sh --provider local`。
启动脚本会自动创建 `data/` 与 `experiments/`，并保留现有卷映射。

需要排查或运行其他 CLI 子命令时，仍可使用底层 Compose 命令：

```bash
docker compose run --rm harness --help
docker compose run --rm harness config
```

Python 变体使用 `--target runtime-python` 构建。Compose 卷映射、模型地址、
资源限制和容器安全边界见
[`docs/container-deployment.zh-CN.md`](docs/container-deployment.zh-CN.md)。

## Release 自动发布

推送 `v0.1.0` 这样的语义化版本标签后，会启动
[`.github/workflows/release.yml`](.github/workflows/release.yml)。流程会先执行
类型检查、构建和测试，再将 `runtime` 与 `runtime-python` 两个镜像发布到
GHCR，并把可运行归档附加到 GitHub Release。稳定版本会更新 `latest` 镜像标签；
例如 `v0.2.0-rc.1` 这样的预发布版本不会更新它。

## 使用 Release

下面的命令将 `v0.1.0` 作为示例，请替换为需要使用的 Release 标签。每个
Release 提供两种等价的分发方式：

### Release 归档包

归档包包含编译后的 CLI、部署文件和文档，但不包含 `node_modules`。解压后需要
安装一次生产依赖。归档包应直接通过 `dist` 运行，不需要使用面向源码的
`npm run` 脚本。

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
node dist/scripts/harness.js repl --provider mock --goal "检查工作区"
```

PowerShell 下可以这样下载和解压：

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

编译后的入口包括：

```text
node dist/scripts/harness.js <command> ...
node dist/scripts/run-task.js --task <task-spec.json>
node dist/scripts/run-generation.js --plan <plan.json>
node dist/scripts/replay-run.js --input <events.jsonl>
node dist/scripts/report.js --input <events.jsonl>
```

交互式工作流从 `repl` 开始。使用 `--provider mock` 可以执行本地冒烟测试；
使用 `--provider local` 连接 OpenAI-compatible 本地模型；使用
`--provider external` 连接已配置的外部模型端点。执行
`node dist/scripts/harness.js <command> --help` 可以查看任意命令的选项。

### GHCR 镜像

标准镜像和包含 Python 的镜像使用不同的镜像名称：

```text
ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game:<version>
ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game-python:<version>
```

例如，稳定版 `v0.1.0` 可以这样拉取和启动：

```bash
IMAGE=ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game:0.1.0
docker pull "$IMAGE"
docker run --rm "$IMAGE" --help
mkdir -p data experiments
docker run --rm -it \
  -v "$PWD/data:/app/data" \
  -v "$PWD/experiments:/app/experiments" \
  "$IMAGE" repl --provider mock --goal "检查工作区"
```

如果任务需要 `python3` 或 `python3-venv`，请使用带 `-python` 的镜像名称：

```bash
IMAGE=ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game-python:0.1.0
docker pull "$IMAGE"
docker run --rm "$IMAGE" --help
```

Python 镜像只提供解释器。任务仍必须在
`TaskSpec.allowedCommands` 中包含 `python3`。

也可以通过归档包内附带的 Compose 文件使用已发布镜像：

```bash
export HARNESS_IMAGE=ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game:0.1.0
mkdir -p data experiments
docker compose pull
docker compose run --rm -it harness repl --provider mock --goal "检查工作区"
```

PowerShell 下，先设置镜像变量，再执行相同的 Compose 命令：

```powershell
$env:HARNESS_IMAGE = "ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game:0.1.0"
New-Item -ItemType Directory -Force data, experiments | Out-Null
docker compose pull
docker compose run --rm -it harness repl --provider mock --goal "检查工作区"
```

`data` 和 `experiments` 卷映射会保留事件日志与实验产物。稳定版本会发布
`0.1.0`、`0.1` 和 `latest` 标签；预发布版本会发布完整版本标签，例如
`0.2.0-rc.1`，但不会移动 `latest`。

### 模型配置

默认的冒烟测试 provider 是 `mock`，不需要模型服务。使用本地
OpenAI-compatible 服务时，在启动 CLI 或容器前配置端点和可选凭据：

```bash
export HARNESS_LOCAL_MODEL_URL=http://127.0.0.1:8000/v1
export HARNESS_LOCAL_MODEL_KEY=replace-me
export HARNESS_LOCAL_MODEL_NAME=local-model
node dist/scripts/harness.js config
node dist/scripts/harness.js repl --provider local --goal "检查工作区"
```

在容器中使用本地模型时，设置相同的变量，然后改为调用 Compose 服务：

```bash
export HARNESS_LOCAL_MODEL_URL=http://host.docker.internal:8000/v1
export HARNESS_LOCAL_MODEL_KEY=replace-me
export HARNESS_LOCAL_MODEL_NAME=local-model
docker compose run --rm -it harness repl --provider local --goal "检查工作区"
```

使用 external tier 时，设置 `HARNESS_EXTERNAL_MODEL_URL`、
`HARNESS_EXTERNAL_MODEL_KEY`，以及可选的 `HARNESS_EXTERNAL_MODEL_NAME`，然后
使用 `--provider external`。如果模型运行在宿主机上，容器用户应使用
`http://host.docker.internal:8000/v1`；如果模型运行在同一个 Compose 项目中，
应使用 Compose 服务名。在容器内部不要用 `127.0.0.1` 指代宿主机或其他容器中的
服务。

## 架构

系统分为三个边界：

```text
Control Plane
  Task / Population / Lifecycle / Evaluation / Energy / Experiment

Execution Plane
  Core / Environment / Provider / Scheduler / Sandbox / Tools

Asset Plane
  Genome / Plugin / Workflow / Policy / Memory / Archive / Event Log
```

Control Plane 拥有实验规则和评价逻辑。Execution Plane 是 Agent 与任务工作区交互的唯一通道。Asset Plane 保存版本化、可审计的 Agent 资产。

主要不变量包括：

- Agent 不能修改 Core、Evaluation、Energy 或 Sandbox 控制规则。
- Self-Rewrite 失败不会改变当前激活的 Genome。
- Embryo 失败会被归档，不会进入正式 Population。
- 普通 Individual Memory 不会自动遗传给 Child。
- 候选 Plugin 需要经过多次成功验证后才能晋升。
- Base Harness 作为 Generation 0 对照组保持不可变。
- Holdout Task 与演化集、验证集保持分离。

## 项目结构

```text
src/
  contracts/      共享且运行时校验的契约
  core/           Agent 生命周期和回合执行
  environment/   Agent 可访问的环境与工具
  evaluation/    独立评价与 Base Harness
  energy/        资源与 Energy 结算
  experiment/    事件日志、校准与泛化实验
  evolution/      Self-Rewrite、Clone、Mutation 和 Embryo
  genome/         Genome revision 与资产加载
  lifecycle/      Population 状态与遗产归档
  memory/         Individual Memory 与候选 Plugin
  sandbox/        工作区隔离与命令执行
  scheduler/      共享本地 SLM 队列
  tasks/          可复现 Coding Task 执行

test/             自动化单元和集成测试
scripts/          CLI 辅助入口
design_docs/      架构与落地方案
.github/workflows 持续集成配置
```

## 可复现实验

### 跑一次真实模型修复实验

`run-repair` 已接通模型驱动的代码修复、固定原版对照、Docker 独立验收及完整实验记录：

```powershell
docker pull node:24-alpine
# 先设置 HARNESS_EXTERNAL_MODEL_URL、HARNESS_EXTERNAL_MODEL_NAME 和模型密钥环境变量。
npm run run-repair -- --task examples/repair/median.json --output experiments/repair --max-turns 12
```

需要 Node.js 24+ 和可用的 Docker 引擎。完整配置、产物说明、验证命令和适用范围见
[第一次真实模型修复实验](docs/first-repair-experiment.zh-CN.md)。该实验验证单任务修复能力，尚不证明多代演化提升。

实验应记录：

- 仓库 commit 与固定任务输入 commit
- TaskSpec 与 Core hash
- Genome 与 Provider 配置 hash
- Scheduler、Energy、timeout 和 fitness 配置
- 引入随机性时使用的随机 seed
- 完整事件历史与 Evaluation 输出

Phase 10 和 Phase 11 的实验模块提供固定任务/配置身份、Base 对照、参数变更记录、演化集/验证集/holdout 分区，以及预先确定的泛化阈值。

## 安全范围

Sandbox 用于受控实验。不要让不可信 Mutation 代码直接操作生产文件或敏感宿主资源。在威胁模型和运行控制完成审查前，请将实验环境与个人及生产环境隔离。

## 文档

- [工程方案](design_docs/Evolving_Coding_Harness_工程方案.md)
- [落地实施方案](design_docs/Evolving_Coding_Harness_落地实施方案.md)
- [容器化与 CLI 方案](design_docs/Evolving_Coding_Harness_容器化与CLI方案.md)
- [English README](README.md)

## CI

每次 push 和 Pull Request 都会执行：

1. `npm ci`
2. `npm run typecheck`
3. `npm run build`
4. `npm test`

CI 配置位于 `.github/workflows/ci.yml`，使用 Node.js 24。

## 许可证

本项目采用 GNU Affero General Public License v3.0 或更高版本（AGPL-3.0-or-later）授权。完整协议文本请参阅 [LICENSE](LICENSE)。
