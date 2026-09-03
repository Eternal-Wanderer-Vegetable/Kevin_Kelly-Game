# Evolving Coding Harness
## 落地实施方案

> 本文将 `design_docs/Evolving_Coding_Harness_工程方案.md` 的理论设计转换为可以逐步开发、测试和复现实验的工程流程。

## 1. 落地目标

第一阶段不追求完整生态，而是先建立一个可重复运行的实验平台，验证以下最小问题：

> 在固定本地 SLM 和固定 Core 的情况下，Agent 能否通过修改 Genome、Self-Rewrite、Clone 和结构化 Mutation，在真实 Coding Task 上逐渐形成更好的 Harness？

第一阶段必须同时满足：

1. Agent 可以在受控 Sandbox 中完成真实 Coding Task。
2. Evaluation 独立于 Agent，Agent 无法修改裁判和资源规则。
3. Base Harness 永久保留，可以作为 Generation 0 对照组。
4. 所有任务、资源、评价、Energy、繁殖和状态变化都可记录、重放和审计。
5. 演化能力逐步开放，每一步都可以独立运行和验证。

第一阶段暂不实现：

- Multi-Agent 协作和专业分工
- Agent 间资源交易
- 有性繁殖和 Genome 重组
- 自动任务生成
- 分布式集群
- 复杂社会结构

## 2. 技术选型

### 2.1 运行时

第一版采用：

- Node.js 24+
- TypeScript
- ESM 模块
- `strict` 类型检查
- Node.js 标准库优先
- `node:test` 作为测试框架

选择理由：

- 本地已有 Node.js 运行环境，且本机存在 Miniconda 封装的 Python 解释器。
- `child_process`、`fs`、`fetch`、`crypto`、`worker_threads` 可覆盖第一阶段主要需求。
- TypeScript 能为跨模块契约、生命周期状态、事件重放、Genome 版本和安全边界提供编译期约束。
- 标准库方案便于减少依赖，降低演化实验中的变量数量。
- Miniconda Python 作为 Sandbox 中 Python 项目和 Python 工具的可选执行运行时，不作为 Harness 控制面的主实现语言。

推荐工程工具链：

```text
TypeScript
+ tsx（开发和测试执行）
+ tsc（类型检查和构建）
+ node:test（测试框架）
```

推荐脚本：

```json
{
  "typecheck": "tsc --noEmit",
  "test": "tsx --test test/**/*.test.ts",
  "build": "tsc"
}
```

### 2.2 数据存储

MVP 使用两类存储：

```text
实验事件       append-only JSONL
Genome/Plugin  文件目录 + manifest
```

事件日志是事实来源，运行时状态可以通过事件重放生成。

第一阶段暂不引入数据库，原因是：

- 先验证实验流程，不提前固化分析模型。
- JSONL 便于检查、备份和跨语言读取。
- 后续可以在事件契约不变的情况下增加 SQLite 查询索引。

### 2.3 模型接口

本地 SLM 和外部 LLM 都通过 Provider 抽象访问：

```js
{
  async complete(request) {
    return {
      text,
      usage,
      provider,
      model,
      requestId
    };
  }
}
```

第一版优先兼容 OpenAI-compatible HTTP API；具体本地模型服务由配置决定，不写死在 Core 中。

## 3. 总体架构

系统分为三个边界：

```text
Control Plane
  Task / Population / Lifecycle / Evaluation / Energy / Experiment

Execution Plane
  Core / Environment Interface / Provider / Scheduler / Sandbox / Tools

Asset Plane
  Genome / Plugin / Workflow / Policy / Memory / Archive / Event Log
```

### 3.1 Control Plane

Control Plane 是实验规则的拥有者，负责：

- 创建和分发 Task
- 管理 Agent 生命周期
- 分配共享模型资源
- 运行独立评价
- 结算 Energy
- 执行繁殖资格判定
- 保存实验事件
- 生成对照报告

Agent 不得直接访问 Control Plane 的内部存储。

### 3.2 Execution Plane

Execution Plane 是 Agent 能够调用的运行环境，负责：

- 读取项目文件
- 搜索代码
- 修改工作区
- 执行允许的命令
- 运行测试
- 调用本地 SLM
- 在必要时调用外部 LLM

所有动作必须经过 Environment Interface，不能让 Agent 直接调用任意宿主 API。

### 3.3 Asset Plane

Asset Plane 保存可以被复用、继承和分析的数字资产：

- Agent Genome
- Plugin
- Workflow
- Policy
- Individual Memory
- 已验证 Plugin
- 死亡 Agent 遗产
- Task History
- Performance 和 Failure Reason

## 4. 推荐目录结构

```text
Evolving_Coding_Harness/
├── package.json
├── src/
│   ├── core/
│   │   └── agent-core.ts
│   ├── contracts/
│   ├── environment/
│   ├── providers/
│   ├── resources/
│   ├── sandbox/
│   ├── tasks/
│   ├── evaluation/
│   ├── energy/
│   ├── genome/
│   ├── memory/
│   ├── evolution/
│   ├── lifecycle/
│   ├── archive/
│   └── experiment/
├── scripts/
│   ├── run-task.ts
│   ├── run-generation.ts
│   ├── replay-run.ts
│   └── report.ts
├── test/
├── experiments/
│   └── base-harness/
├── data/
│   ├── tasks/
│   ├── runs/
│   ├── agents/
│   └── archive/
└── docs/
```

其中：

- `src/core/`、`src/evaluation/`、`src/resources/`、`src/energy/`、`src/evolution/` 和 `src/sandbox/` 属于不可修改边界。
- `src/genome/`、`src/memory/` 以及 Agent 的 Plugin/Workflow/Policy 目录属于可演化边界。
- `experiments/base-harness/` 只读保存 Generation 0。
- `data/runs/` 保存实验结果，不覆盖基线资产。

## 5. 核心数据契约

所有跨模块对象都必须带 `schemaVersion` 和稳定 ID。

### 5.1 TaskSpec

```json
{
  "schemaVersion": 1,
  "taskId": "task-001",
  "level": 1,
  "title": "修复局部函数 bug",
  "repository": {
    "source": "local-path-or-archive",
    "commit": "固定版本"
  },
  "allowedCommands": ["test", "build"],
  "acceptanceCriteria": [],
  "baselineTestCommand": "..."
}
```

第一阶段只支持 Level 1，任务必须能够重新创建相同输入工作区。

### 5.2 GenomeManifest

```json
{
  "schemaVersion": 1,
  "genomeId": "genome-001",
  "agentId": "agent-001",
  "parentId": null,
  "generation": 0,
  "plugins": [],
  "workflows": [],
  "policies": [],
  "dependencies": [],
  "coreHash": "...",
  "genomeHash": "..."
}
```

Manifest 只描述组件、版本、依赖、启动方式和元数据，不直接实现 Core 或 Evaluation。

### 5.3 ExperimentEvent

事件至少包含：

```json
{
  "schemaVersion": 1,
  "eventId": "event-001",
  "runId": "run-001",
  "timestamp": "...",
  "type": "TASK_COMPLETED",
  "agentId": "agent-001",
  "generation": 0,
  "payload": {}
}
```

必须记录的事件类型包括：

- `TASK_ASSIGNED`
- `MODEL_REQUESTED`
- `MODEL_COMPLETED`
- `TOOL_CALLED`
- `SANDBOX_STARTED`
- `SANDBOX_FINISHED`
- `EVALUATION_COMPLETED`
- `ENERGY_DEBITED`
- `ENERGY_REWARDED`
- `MEMORY_RECORDED`
- `GENOME_REWRITTEN`
- `MUTATION_CREATED`
- `EMBRYO_QUALIFIED`
- `EMBRYO_REJECTED`
- `AGENT_STATE_CHANGED`
- `AGENT_DIED`
- `LEGACY_ARCHIVED`

## 6. 分阶段实施流程

## Phase 0：工程骨架与契约

### 目标

让空实验可以启动、退出并重放。

### 工作内容

1. 创建 `package.json`、`tsconfig.json` 和 ESM 入口。
2. 创建 `src/contracts/`。
3. 定义 Task、Agent、Genome、Usage、Evaluation、Fitness 和 Event schema。
4. 创建配置加载器。
5. 创建 Event Log 和 replay 骨架。
6. 创建 `run-task.ts`、`replay-run.ts`、`report.ts` 的帮助命令。

### 验收

- 配置错误能明确失败。
- 空实验可以生成 run ID。
- 事件可以写入 JSONL。
- 事件可以按顺序重放。
- `node --test` 通过。

## Phase 1：最小 PI Agent

### 目标

实现不可演化的最小 Agent，只验证 Observe → Think → Act。

### 工作内容

1. 实现 `AgentCore`。
2. 实现 Mock Provider。
3. 实现最小 Environment Interface。
4. 支持 read、search、write、exec 和 test 五类工具。
5. 将每个动作转成结构化事件。

### 硬边界

- Core 目录不能被 Agent 写入。
- Agent 只能通过工具接口访问任务工作区。
- Agent 不能访问 Evaluation、Energy 和 Population 数据。

### 验收

- Agent 可以通过 Mock Provider 完成固定脚本任务。
- 非法工具调用被拒绝。
- Agent 无法修改 Core 或评价器文件。

## Phase 2：Sandbox 与 Coding Task

### 目标

让 Agent 在隔离工作区处理真实 Level 1 Coding Task。

### 工作内容

1. 每个任务从固定 commit 或 fixture 创建临时 workspace。
2. 设置路径白名单和命令白名单。
3. 设置超时、输出上限和环境变量白名单。
4. 捕获进程退出码、stdout、stderr、耗时和资源使用。
5. 任务完成后保留 patch、测试结果和 workspace 元数据。

### 验收

- Agent 修改不会污染原项目。
- 禁止命令和越权路径会失败。
- 超时后进程树被清理。
- 同一 TaskSpec 可以重复生成同样的初始工作区。

## Phase 3：独立 Evaluation 与 Base Harness

### 目标

建立可信的评价和永久基线。

### 工作内容

1. 实现独立 Evaluator。
2. 执行 baseline tests、candidate tests 和 regression tests。
3. 记录 Task Success、Test Pass Rate、Regression Rate、Runtime、Resource Consumption、Stability。
4. 加入 Human Acceptance：`accept/reject` 和 1-5 分。
5. 冻结 `experiments/base-harness/`。
6. 生成 Base Harness 报告。

### 约束

Fitness 向 Agent 提供结果，不直接暴露“如何刷分”的固定公式。

### 验收

- 评价器不依赖 Agent 自己的判断。
- Agent 无法修改测试裁判和 Fitness 代码。
- Base Harness 可重复运行。
- 同一任务可以比较不同 Harness。

## Phase 4：资源计量与 Energy

### 目标

区分真实硬件资源和虚拟 Energy。

### 工作内容

1. 实现 Resource Meter。
2. 记录 wall time、CPU time、内存峰值、模型调用次数和外部调用。
3. 实现 Energy Ledger。
4. 先使用配置化 debit/reward，不固定最终数值。
5. 建立最低基础能量，避免初始种群立即灭绝。

### 验收

- 每次工具调用和模型调用都有 usage。
- Energy 结算可以通过事件重放。
- 真实资源和 Energy 是两个独立字段。
- 不同 Energy 参数可以重跑同一任务。

## Phase 5：Genome、Plugin、Workflow 和 Policy

### 目标

建立可以版本化、校验和加载的遗传资产。

### 工作内容

1. 实现 PluginManifest。
2. 实现 GenomeManifest。
3. 实现版本、依赖和 hash 校验。
4. 实现 Plugin Loader。
5. 实现 Workflow Loader。
6. 实现结构化 Policy 文件。
7. 增加 rollback。

### 验收

- 非法 manifest 被拒绝。
- 缺失依赖和循环依赖被拒绝。
- Core、Evaluator、Energy 和 Sandbox 不能作为 Genome 依赖加载。
- Genome 可以 clone、版本化和回滚。

## Phase 6：Memory 与候选 Plugin

### 目标

实现“经验先属于个体，经过验证后才进入遗传物质”。

### 工作内容

1. 保存 Individual Memory。
2. 保存任务上下文、成功摘要和失败摘要。
3. 引入 `candidate`、`verified` 两类 Plugin 状态。
4. 只有重复成功并通过验证的经验才能晋升为 verified Plugin。
5. Memory 默认不随 Clone 自动遗传。

### 验收

- 普通 Memory 不会自动进入 child Genome。
- 候选 Plugin 有来源、验证任务和成功记录。
- 验证失败时不会污染正式 Genome。

## Phase 7：Self-Rewrite

### 目标

让 Agent 修改自己的 Genome，但不能修改控制规则。

### 工作内容

1. 在候选 revision workspace 中进行修改。
2. 运行 manifest 校验、Plugin Boot Test 和回归测试。
3. 成功后生成新 Genome revision。
4. 失败时销毁候选 revision 并保留 failure reason。
5. 当前 Agent 只切换到通过验证的 revision。

### 验收

- 失败 Self-Rewrite 不改变当前 Agent。
- 成功 Self-Rewrite 可以被后续 Clone 继承。
- Core、Evaluator 和 Sandbox 文件永远不会被修改。

## Phase 8：Clone、Mutation 与 Embryo

### 目标

实现结构级遗传和新 Agent 资格检查。

### 工作内容

1. Parent 支付 Energy 创建 child。
2. 复制当前有效 Genome。
3. 应用结构级 Mutation：
   - 添加 Plugin
   - 删除 Plugin
   - 复制 Plugin
   - 修改 Plugin
   - 修改 Workflow
   - 修改 Policy
   - 创建工具
4. Child 进入 Embryo。
5. 执行 Boot Test、Manifest Test、Plugin Load Test、基础 Coding Test。
6. 通过后正式出生，失败则死亡并归档。

### 验收

- Child 不能反向修改 Parent。
- 非法 Child 不进入正式 Population。
- Mutation 有完整 lineage。
- 失败 Child 保存失败原因和 Genome 快照。

## Phase 9：生命周期、Population 与 Scheduler

### 目标

形成最小数字生态循环。

### 工作内容

1. 实现 ACTIVE、DORMANT、DEAD 状态机。
2. 实现维护成本和 Energy 不足策略。
3. 实现 Population Controller。
4. 实现共享本地 SLM Queue。
5. 实现公平性、超时、取消和失败恢复。
6. 保存每代 Population Snapshot。
7. 实现死亡 Agent 遗产归档。

### 验收

- 非法状态转换被拒绝。
- 至少 4 个 Agent 可以竞争同一个 Mock SLM。
- 队列失败不会造成事件丢失。
- DEAD Agent 不再运行，但 verified Plugin 可以保留。

## Phase 10：真实任务试验与参数校准

### 目标

使用真实工程任务校准规则，而不是凭理论固定参数。

### 工作内容

1. 收集真实 Level 1 任务。
2. 固定任务输入 commit。
3. 运行 Base Harness。
4. 运行少量 Self-Rewrite 和 Mutation 实验。
5. 记录成功率、回归率、耗时、资源和人类验收。
6. 校准 Energy、timeout、queue 和 Fitness 配置。

### 约束

- 只调整配置，不修改裁判逻辑来迎合结果。
- 每次参数变更都必须记录。
- 不用演化任务直接作为最终泛化测试。

## Phase 11：陌生项目泛化

### 目标

确认 Agent 获得的是可迁移 Coding 能力，而不是对演化任务过拟合。

### 工作内容

1. 冻结 Base Harness。
2. 冻结任务协议和 Evaluator。
3. 建立演化集、验证集和 holdout 集。
4. 使用演化期间未出现的项目、语言和问题类型。
5. 比较 Base Harness 与 evolved generation。

### 通过条件

需要在实验开始前预先确定：

- 最低任务成功率提升
- 最大回归率
- 可接受资源消耗
- 最低人类接受率
- 最小样本数量

不能在看到结果后修改通过标准。

## 7. 最小可行版本

如果需要进一步压缩，MVP 只实现：

```text
固定 SLM 或 Mock SLM
+ 一个 PI Agent
+ Plugin Loader
+ Sandbox
+ Level 1 Coding Task
+ 自动测试
+ 独立 Evaluation
+ Event Log
+ Energy
+ Clone
+ Mutation
```

MVP 暂不实现：

- DORMANT 的复杂唤醒策略
- 外部 LLM 自动决策
- 复杂 Memory 抽象
- 大规模 Population
- SQLite 分析层
- Multi-Agent 协作

MVP 的成功标准是：

> 一个 Agent 可以在固定 Core 下，通过 Self-Rewrite 或 Clone + Mutation 产生至少一个可重复验证、可回滚、在真实任务上表现更好的 Harness revision。

## 8. 测试分层

### 单元测试

- Contract schema
- Event Log
- Energy Ledger
- Genome hash
- Manifest dependency
- State Machine
- Mutation
- Fitness 计算

### 安全边界测试

- Core 写入拦截
- Evaluator 写入拦截
- Sandbox 路径逃逸
- 禁止命令
- 子进程超时
- 输出上限
- 环境变量泄漏

### 集成测试

- Mock Provider + Sandbox + Task Runner
- Evaluator + Human Acceptance
- Parent + Mutation + Embryo
- Population + Shared Scheduler
- Event Replay + Crash Recovery

### 实验测试

- Base Harness 重复运行
- 固定 seed 重放
- 不同 Energy 配置对比
- 不同 Scheduler 策略对比
- 演化集与陌生 holdout 集对比

## 9. 运行与操作流程

### 单任务

```text
录入 TaskSpec
  ↓
创建固定输入 workspace
  ↓
启动 Agent
  ↓
执行模型和工具调用
  ↓
运行测试
  ↓
独立 Evaluation
  ↓
记录 Event / Usage / Fitness
  ↓
人工 Accept 或 Reject
```

### 单代实验

```text
读取 Population Snapshot
  ↓
分发 Coding Task
  ↓
竞争共享 SLM
  ↓
执行 Sandbox
  ↓
Evaluation
  ↓
Energy Settlement
  ↓
Self-Rewrite 或 Clone + Mutation
  ↓
Embryo Qualification
  ↓
生成下一代 Snapshot
```

### 崩溃恢复

```text
读取最后一个完整事件
  ↓
检查未完成任务
  ↓
清理或标记孤儿 Sandbox
  ↓
重放状态
  ↓
继续运行或安全终止
```

## 10. 关键风险控制

### Sandbox 风险

第一阶段默认实验机与个人生产环境隔离。Sandbox 必须具备：

- 临时工作区
- 路径白名单
- 命令白名单
- 超时
- 输出限制
- 子进程树清理
- 环境变量白名单

在威胁模型确认前，不允许把不可信 Mutation 代码直接运行在重要宿主环境。

### 评价器污染

Evaluation、Fitness、Energy、Evolution Rules 和测试输入必须位于 Agent 不可写目录。

### 共享资源不公平

Scheduler 至少记录：

- 排队时间
- 执行时间
- 请求优先级
- Agent 等待次数
- 超时和取消

否则无法区分 Harness 能力差异和调度偶然性。

### Benchmark Gaming

不要将单一资源指标直接映射成高额奖励。首先记录真实结果，再通过多指标分析确认是否产生有效改进。

### 实验不可复现

每次 Run 必须记录：

- Git commit
- TaskSpec hash
- Core hash
- Genome hash
- Provider 配置 hash
- Scheduler 配置
- Energy 配置
- 随机 seed
- 完整 Event Log

## 11. 开发顺序总结

```text
Phase 0  工程骨架与契约
   ↓
Phase 1  最小 PI Agent
   ↓
Phase 2  Sandbox + Coding Task
   ↓
Phase 3  Independent Evaluation + Base Harness
   ↓
Phase 4  Resource Meter + Energy
   ↓
Phase 5  Genome + Plugin + Workflow + Policy
   ↓
Phase 6  Memory + Candidate Plugin
   ↓
Phase 7  Self-Rewrite
   ↓
Phase 8  Clone + Mutation + Embryo
   ↓
Phase 9  Lifecycle + Population + Scheduler
   ↓
Phase 10 真实任务试验与校准
   ↓
Phase 11 陌生项目泛化
```

任何阶段都必须满足：

1. 有明确输入和输出。
2. 有自动化测试。
3. 有失败回滚或安全终止路径。
4. 有事件记录。
5. 不破坏 Base Harness。
6. 在修改共享模块前执行 GitNexus impact analysis。
7. 在提交前执行 GitNexus `detect_changes`。

## 12. 第一阶段完成定义

第一阶段完成，不等于已经证明“演化成功”。它只表示实验基础设施可信：

- 至少一个真实 Level 1 Coding Task 可以运行。
- Sandbox 能阻止越权访问和失控进程。
- Base Harness 可以重复运行。
- Evaluation 独立且不可由 Agent 修改。
- Usage、Energy、Fitness、Lineage 和 Event Log 完整。
- Self-Rewrite 和 Clone + Mutation 可回滚。
- Embryo 失败不会进入 Population。
- 固定 seed 可以重放核心控制决策。
- 已建立演化集与 holdout 集。

只有在这些条件满足后，才可以讨论 Generation N 是否优于 Generation 0。
