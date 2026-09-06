<div align="center">

# Kevin_Kelly-Game

<p>这是一个使用 TypeScript 实现的实验性平台，用于研究 Coding Agent 是否能够在受控环境中通过 Self-Rewrite、Genome 遗传、结构化 Mutation 和独立 Evaluation，逐步改进自己的 Harness。</p>

<p>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white" alt="Node.js 24 或更高版本"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8%2B-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.8 或更高版本"></a>
  <a href="https://nodejs.org/api/esm.html"><img src="https://img.shields.io/badge/ESM-Node.js%20ESM-339933?logo=node.js&logoColor=white" alt="Node.js ESM"></a>
  <a href="https://github.com/Eternal-Wanderer-Vegetable/Kevin_Kelly-Game/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Eternal-Wanderer-Vegetable/Kevin_Kelly-Game/ci.yml?branch=main&label=CI" alt="CI 状态"></a>
</p>

<p><a href="README.md">English README</a></p>
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
npm run replay-run   显示事件重放帮助
npm run report       显示报告命令帮助
```

CLI 辅助命令目前主要提供 MVP 所需的稳定接口和帮助契约。实验编排能力也可以直接通过 `src/experiment/` 下的 TypeScript 模块使用。

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
