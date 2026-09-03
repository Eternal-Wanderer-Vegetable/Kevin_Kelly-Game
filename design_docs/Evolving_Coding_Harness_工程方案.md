# Evolving Coding Harness
## ——基于本地 SLM 的数字生态演化实验工程方案

> 状态：初步理论设计完成，待工程落地  
> 第一阶段目标：验证“能否通过演化方法演化出真正可用的 Coding Harness”  
> 初始模型：本地 27B SLM  
> 初始 Agent：PI Agent 风格的极简 Coding Agent  
> 核心思想：固定最小 Core，让 Agent 在真实 Coding Task、资源约束和生存压力下自主修改、复制、变异与选择。

---

# 1. 项目概述

本项目尝试构建一个运行在本地计算机上的“数字生态系统”。

系统中存在若干自主 Coding Agent。所有 Agent 共享同一个本地 SLM 和同一个外部 LLM，但拥有各自独立的 Harness、Genome、Memory、工具和 Energy。

Agent 不通过传统意义上的模型训练改变 SLM 参数，而是通过：

- 自我修改（Self-Rewrite）
- 克隆（Clone）
- 变异（Mutation）
- 任务实践
- 工具创造
- 资源竞争
- 生存与繁殖

不断改变自身的软件结构。

最终实验目标不是制造“最聪明的模型”，而是验证：

> **固定一个 SLM 后，能否仅通过演化其外围 Harness，使系统逐渐形成一个真正可用、稳定、高效、适应本地硬件环境的 Coding Agent。**

---

# 2. 第一阶段的范围

第一阶段严格收紧问题范围：

> **只研究 Coding Agent。**

不追求：

- 通用智能
- 通用 Agent
- 多模态能力
- 通用现实世界任务
- 一开始就构建复杂 Multi-Agent System

任务主要来自真实的软件工程需求，由项目开发者持续提供。

任务应尽可能来自实际项目，而不是专门为了 Benchmark 人为生成。

可使用的任务类型包括：

- 编写函数
- 修复 Bug
- 增加 API
- 编写测试
- 实现工具
- 重构模块
- 设计并实现模块
- 修改已有项目
- 跨语言工程
- Rust / Python / C# 等实际工程问题
- Stella / Comes / Memory System 等真实项目需求

---

# 3. 核心实验假设

项目主要验证以下假设。

## H1：Harness 可以独立于模型发生显著进化

固定 27B SLM，不改变模型参数。

仅允许 Agent 修改：

- Plugins
- Workflows
- Policies
- 工具
- 配置
- 自身软件结构

观察其 Coding 能力是否持续提高。

---

## H2：本地化 Harness 会自然适应本地硬件

不同计算机拥有不同：

- GPU
- VRAM
- RAM
- CPU
- SSD
- SLM 推理速度

如果资源和 Energy 机制有效，那么长期演化后的 Harness 应该自然形成与硬件相适应的策略。

例如：

- 减少不必要的 SLM 调用
- 增加缓存
- 更多依赖本地工具
- 合理使用 CPU/GPU
- 只在必要时调用外部 LLM

---

## H3：工具可以成为“遗传物质”

Agent 在实际任务中产生经验。

经验经过反复验证后，可以被固化为 Plugin。

Plugin 可以被复制、修改并遗传给后代。

因此：

> Experience → Memory → Plugin → Genome → Offspring

形成能力积累链。

---

## H4：复杂的系统结构可以从简单 Agent 中涌现

初始 Agent 尽可能简单。

不预先规定：

- 专业分工
- Multi-Agent 协作
- Agent 交易
- 复杂组织结构
- 特定 Planner
- 特定 Memory System

如果这些机制最终出现，应视为实验结果，而不是人工设计结果。

---

# 4. 数字生态系统的基本世界观

可以将系统抽象为：

```text
                    Digital World
                         │
            ┌────────────┼────────────┐
            ↓            ↓            ↓
         Material      Compute    Information
            │            │            │
         Files          CPU         Memory
         Code           GPU         Knowledge
         Tools          RAM         Experience
         Storage        VRAM
                         │
                         ↓
                       Energy
                         │
                         ↓
                       Agent
                         │
                       Action
                         ↓
                    Environment
                         │
                       Tasks
                         ↓
                       Reward
                         ↓
                       Energy
```

重要原则：

> Resource 与 Energy 不应混为一谈。

---

# 5. 资源系统

## 5.1 Material Resource

包括：

- 文件
- 代码
- Plugin
- 工具
- 数据
- 数据库
- 配置
- Storage

特点：

> 可以长期保存、积累和复用。

软件工具因此可以成为一种“数字资本”。

---

## 5.2 Compute Resource

包括：

- CPU 时间
- GPU 时间
- VRAM
- RAM
- 本地 SLM 推理
- 外部 LLM 调用

特点：

> 消耗后无法恢复。

尤其是共享的 27B SLM：

```text
                 Shared 27B SLM
                       │
              ┌────────┼────────┐
              ↓        ↓        ↓
           Agent A  Agent B  Agent C
```

所有 Agent 竞争同一个模型资源。

这应成为重要的进化压力。

---

## 5.3 Information Resource

包括：

- Memory
- 历史经验
- 任务记录
- 环境知识
- 失败案例
- 成功案例
- Agent 行为历史

信息可以：

- 复制
- 压缩
- 传播
- 失真
- 组合
- 污染

---

# 6. Energy 系统

Energy 不是硬件资源。

它是：

> **Agent 为进行行动、维持生命和繁殖而支付的统一生存预算。**

可以将 Energy 理解为一种生态系统中的“经济媒介”。

例如：

```text
读取文件          → 消耗少量 Energy
运行程序          → 消耗 Energy
执行复杂分析      → 消耗更多 Energy
本地 27B 推理     → 较高成本
外部 LLM          → 极高成本
繁殖              → 较高成本
```

具体数值不应在理论阶段过早固定，应通过实验校准。

---

# 7. Energy 的来源

第一版可以采用三种来源的组合。

## 7.1 基础能量

环境提供最低限度的 Energy，防止生态系统因初始错误立即全部灭绝。

---

## 7.2 Coding Task 奖励

完成真实 Coding Task 获得 Energy。

原则：

> 真正有用的工作才产生主要收益。

---

## 7.3 资源发现

允许 Agent 自己发现能够产生价值的任务或资源。

这一机制可以在第一版简化，后续再开放。

---

# 8. Energy 与真实硬件

必须严格区分：

```text
真实硬件
    ↓
CPU / GPU / RAM / VRAM / SSD
```

和：

```text
虚拟生态规则
    ↓
Energy
```

Energy 是生态层面的抽象。

真实硬件是生态系统的物理边界。

最终可以使 Energy Cost 与真实成本相关：

```text
Energy Cost
≈
计算成本
+
资源占用
+
机会成本
+
时间成本
```

而不是简单设计成“完成任务获得金币”。

---

# 9. Agent 的生命状态

第一阶段采用三个状态：

```text
ACTIVE
   ↓
DORMANT
   ↓
DEAD
```

## ACTIVE

可以：

- 思考
- 调用 SLM
- 使用工具
- 修改代码
- 修改 Genome
- 完成任务
- 创建后代
- 与环境交互

---

## DORMANT

Agent 暂时停止活动。

特点：

- 不进行主要计算
- 低或零维护成本
- 保留自身 Genome、Memory 和资产
- 在有价值任务出现时可以重新唤醒

休眠机制应允许 Agent 自己逐渐发现。

---

## DEAD

Agent 永久退出生态。

其运行状态和生存预算消失。

但其创造的：

- Plugin
- Tool
- Code
- Memory
- 其他数字资产

是否继续存在，应由资源/遗产规则决定。

建议第一版允许部分遗产继续存在。

---

# 10. 维护成本

ACTIVE Agent 应具有非常低的基础维护成本。

否则会产生：

> 什么都不做但永久占据生态位置的 Agent。

但维护成本不宜过高。

目标是让 Agent 自己权衡：

```text
继续工作
vs
暂时休眠
```

---

# 11. Coding Task：第一阶段的环境输入

第一阶段的任务主要由人类开发者提供。

人类在这里不是传统意义上的 Agent 管理员，而是：

> **数字生态系统中的外部环境和高价值反馈源。**

基本流程：

```text
Human
  ↓
Coding Task
  ↓
Agent
  ↓
修改项目
  ↓
自动测试
  ↓
结果评估
  ↓
Human Acceptance
  ↓
Energy / Fitness
```

---

# 12. Task 分级

建议分成三个等级。

## Level 1：局部任务

例如：

- 编写函数
- 修 Bug
- 增加一个 API
- 写测试
- 实现小型工具

---

## Level 2：模块任务

例如：

- 实现插件系统
- 增加数据库模块
- 重构某个模块
- 实现完整功能组件

---

## Level 3：系统任务

例如：

- 设计完整 Router
- Python → Rust 的系统迁移
- 构建完整 IPC 架构
- 修改大型已有项目

实验初期优先 Level 1，随后逐渐加入 Level 2 和 Level 3。

---

# 13. Fitness / 评价机制

不要让 Agent 自己判断：

> “我觉得我变强了。”

必须存在独立于 Agent 的评价机制。

建议评价：

```text
Task Success
Test Pass Rate
Regression Rate
Runtime
Resource Consumption
Stability
Human Acceptance
```

最终可以形成综合 Fitness，但不必在第一版过度数学化。

重要原则：

> Fitness 应告诉 Agent “结果如何”，而不是直接告诉 Agent “应该怎么优化”。

---

# 14. Human Acceptance

可以使用非常简单的人工反馈：

```text
Accept
Reject
```

或者：

```text
1 ~ 5
```

人工评价只用于真实任务验收，不参与每一步内部思考。

目标：

> 保证 Agent 优化的是“真正可用性”，而不是测试漏洞。

---

# 15. 防止 Benchmark Gaming

不能让 Agent 知道：

> 哪种行为能够直接刷分。

例如不应该直接规定：

```text
减少 GPU 20% → +100
```

而应该提供真实结果：

```text
任务完成
消耗 120 Energy
耗时 4 分钟
测试通过
```

让 Agent 自己发现：

> 更高效的计算方式能够提升生存能力。

---

# 16. Agent 的结构：Digital Cell

第一阶段将 PI Agent 类比为“数字单细胞”。

建议结构：

```text
┌───────────────────────────────┐
│          Digital Cell         │
│                               │
│  ┌─────────────────────────┐  │
│  │          CORE           │  │
│  │   Observe / Think / Act │  │
│  └─────────────────────────┘  │
│                               │
│  ┌─────────────────────────┐  │
│  │         GENOME          │  │
│  │ Plugins                 │  │
│  │ Workflows               │  │
│  │ Policies                │  │
│  └─────────────────────────┘  │
│                               │
│  ┌─────────────────────────┐  │
│  │         MEMORY          │  │
│  │ Experience / Context    │  │
│  └─────────────────────────┘  │
│                               │
│            Energy             │
└───────────────────────────────┘
```

---

# 17. Core

Core 是 Agent 的“细胞膜/基本生命机制”。

参考 PI Agent 的极简设计。

原则：

> **Core 极小、稳定、不可修改。**

Core 负责：

- 感知环境
- 调用认知能力
- 执行动作
- 与 Environment Interface 交互
- 维持 Agent 生命周期
- 基本安全边界

具体四个模块应在工程实现阶段根据 PI Agent 的实际结构确定。

---

# 18. Genome

Genome 是真正可进化的部分。

建议包括：

```text
Genome
│
├── Plugins
├── Workflows
├── Policies
└── Manifest
```

---

# 19. Plugins：主要遗传物质

Plugin 是第一阶段最重要的遗传单元。

Plugin 应当尽量独立：

```text
plugin/
├── manifest
├── code
├── tests
├── documentation
└── version
```

Plugin 可以：

- 新增
- 删除
- 修改
- 复制
- 组合
- 重构

它类似于 Agent 的“功能基因”。

---

# 20. Workflow

Plugin 解决：

> “我能做什么？”

Workflow 解决：

> “我如何使用这些能力？”

例如同样拥有：

```text
Search
Edit
Compile
Test
Git
```

不同 Agent 可以形成不同工作方式：

```text
Search
→ Edit
→ Compile
→ Test
```

或者：

```text
Search
→ Analyze
→ Generate Patch
→ Static Check
→ Compile
→ Test
→ Review
```

Workflow 应允许进化。

---

# 21. Policy

Policy 解决：

> “什么时候做什么？”

例如：

- 什么时候调用本地 SLM
- 什么时候调用外部 LLM
- 什么时候运行测试
- 什么时候创建 Plugin
- 什么时候保存 Memory
- 什么时候进入休眠
- 什么时候繁殖
- 如何分配 Energy

建议结构化保存：

```text
policy/
├── tool_selection
├── verification
├── memory
├── resource
└── reproduction
```

避免第一阶段让所有策略退化成一个巨大、不可分析的 Prompt。

---

# 22. Genome Manifest

建议每个 Agent 有一个 Manifest：

```text
genome/
├── manifest
├── plugins/
├── workflows/
└── policies/
```

Manifest 记录：

- Agent 拥有哪些组件
- 组件版本
- 组件依赖
- 启动方式
- Genome 元数据

它不直接实现能力。

作用是方便：

- Clone
- Mutation
- Boot
- Rollback
- Evaluation
- Versioning
- Experiment Tracking

---

# 23. Memory 不直接属于 Genome

Memory 应属于：

> **个体资产。**

原因：

个体经验未必适合直接遗传。

例如：

```text
Agent A
遇到特殊 Bug
↓
Memory
```

这个经验可能只适用于 A 当前的项目。

因此建议：

```text
Experience
 ↓
Memory
 ↓
Repeated Success
 ↓
Abstraction
 ↓
Plugin
 ↓
Genome
 ↓
Inheritance
```

只有经过验证、抽象和固化的经验才进入遗传物质。

---

# 24. 三种记忆

可以区分：

## Individual Memory

> “我经历过什么？”

属于 Agent。

---

## Genetic Memory

> “我的祖先发现了什么？”

由 Genome 表达。

---

## Ecological Memory

> “这个世界过去发生过什么？”

例如：

- 历史任务
- 已死 Agent
- 成功/失败 Genome
- Plugin Archive

---

# 25. 繁殖机制

第一阶段只采用：

## A. Clone + Mutation

和：

## B. Self-Rewrite

不采用有性繁殖。

原因：

- Agent 当前类似“数字单细胞”
- 有性繁殖需要复杂的 Genome 重组机制
- 第一阶段应优先研究单体生命的自我进化
- 避免过早引入 Multi-Agent 生物学复杂度

---

# 26. Self-Rewrite

Agent 可以修改自己的 Genome：

```text
Agent A
 ↓
发现自身缺陷
 ↓
修改 Genome
 ↓
Agent A'
```

这属于：

> 个体适应。

例如 Agent 发现自己经常重复执行相同操作：

```text
Experience
 ↓
发现模式
 ↓
创建 Cache Plugin
 ↓
Self-Rewrite
```

---

# 27. Clone + Mutation

Agent 可以支付 Energy 创建后代：

```text
Parent
 ↓
Clone
 ↓
Child
 ↓
Mutation
```

Mutation 不应主要采用随机字符/随机代码破坏。

更合理的是结构级变异：

- 添加 Plugin
- 删除 Plugin
- 修改 Plugin
- 复制 Plugin
- 修改 Workflow
- 修改 Policy
- 重组模块
- 创建新工具

---

# 28. Self-Rewrite 的变化应该可以遗传

例如：

```text
Agent A
 ↓
Self-Rewrite
 ↓
增加 Cache Plugin
 ↓
Clone
 ↓
Agent B
```

B 应继承 A 当前有效 Genome。

这样：

> Lifetime Adaptation → Heritable Change → Evolution

才能形成长期积累。

---

# 29. 新 Agent 的孵化

建议新 Agent 不直接进入正式生态。

流程：

```text
Parent
 ↓
Clone + Mutation
 ↓
Embryo
 ↓
Sandbox
 ↓
Boot Test
 ↓
Basic Coding Test
 ↓
正式出生 / 死亡
```

测试：

- 能否启动
- Core 是否完整
- Genome 是否合法
- Plugin 是否可加载
- 是否存在无限循环
- 基础 Coding Task 是否可完成
- 是否违反不可修改边界

注意：

> 这是资格检查，不是人工帮助 Agent 修复。

失败则自然死亡。

---

# 30. 死亡与遗产

Agent 死亡后：

```text
Agent       ❌
```

但其：

```text
Plugin      ?
Code        ?
Memory      ?
Knowledge   ?
```

可以继续存在。

第一版建议允许优秀资产留在生态中。

例如：

```text
/archive/dead/
```

保存：

- Genome
- Task History
- Failure Reason
- Performance
- Plugin

死亡本身也成为信息资源。

---

# 31. 资源竞争

所有 Agent 共享：

```text
Local 27B SLM
External LLM
CPU
GPU
RAM
VRAM
Storage
```

特别是：

> **所有 Agent 请求同一个 27B SLM。**

因此需要一个共享 Scheduler / Queue。

例如：

```text
             Shared 27B
                  │
          ┌───────┼───────┐
          ↓       ↓       ↓
       Agent A Agent B Agent C
```

谁能用更少的 SLM 推理完成更多工作，谁具有更强竞争力。

---

# 32. 外部 LLM

外部 LLM 可以作为极高价值的认知资源。

原则：

```text
Local 27B
    ↓
相对便宜

External LLM
    ↓
非常昂贵
```

Agent 应逐渐学习：

```text
本地可以解决
→ 不调用外部 LLM

本地不确定
→ 先尝试

本地无法解决
→ 支付高昂成本调用外部 LLM
```

这样可以观察是否会自然出现：

> “认知资源调度策略”。

---

# 33. 工具与基础设施

Agent 可以创造外部工具：

```text
Agent
 ↓
Tool
```

工具可以被其他 Agent 使用。

如果某个工具越来越重要，可能自然形成：

> 生态基础设施。

不要在第一阶段人为规定：

- 公共工具
- 私有工具
- 交易工具
- 基础设施

这些可以作为后续实验观察对象。

---

# 34. 不允许 Agent 修改的内容

第一阶段建议至少锁定：

```text
Environment Core
Resource Rules
Energy Rules
Evaluation Rules
Evolution Rules
Sandbox Boundary
Core Agent Modules
```

Agent 可以修改：

```text
Plugins
Workflows
Policies
Memory
Tools
Genome
```

目的：

> 防止 Agent 通过修改“裁判”获得虚假的进化优势。

---

# 35. 初始 Agent 应尽可能简单

建议从：

> PI Agent 风格的极简 Coding Agent

开始。

不要在初始版本中塞入：

- 复杂 Planner
- 大型 Memory System
- 多层 Router
- 大量预置工具
- Multi-Agent
- 复杂自动优化器

否则无法判断：

> 后来的能力究竟来自初始设计，还是演化。

---

# 36. 推荐的第一代生态

例如：

```text
Generation 0
│
├── Agent A
├── Agent B
├── Agent C
├── Agent D
└── ...
```

它们共享：

```text
27B SLM
External LLM
Environment
Task Pool
Evaluation
```

但拥有独立：

```text
Genome
Memory
Energy
Task History
```

---

# 37. 演化循环

核心循环：

```text
┌─────────────────────┐
│      Environment    │
└──────────┬──────────┘
           │
        Coding Task
           ↓
┌─────────────────────┐
│        Agent        │
└──────────┬──────────┘
           │
        Action
           ↓
┌─────────────────────┐
│       Sandbox       │
└──────────┬──────────┘
           │
      Test / Result
           ↓
┌─────────────────────┐
│     Evaluation      │
└──────────┬──────────┘
           │
        Fitness
           ↓
        Energy
           │
     ┌─────┴─────┐
     ↓           ↓
   Survive     Reproduce
     │           │
     ↓           ↓
 Self-Rewrite  Mutation
     │           │
     └─────┬─────┘
           ↓
      Next Generation
```

---

# 38. 第一阶段最重要的实验对照

必须永久保留：

> **Generation 0 / Base Harness**

它作为固定基准。

然后比较：

```text
Base Harness
vs
Evolved Generation N
```

核心指标：

- Coding Task 成功率
- 测试通过率
- Regression Rate
- 平均完成时间
- 本地 SLM 调用次数
- 外部 LLM 调用次数
- CPU/GPU 消耗
- Energy 消耗
- 人类接受率
- 对未知项目的泛化能力

---

# 39. 最重要的最终实验

不能只测试 Agent 熟悉的项目。

演化阶段：

```text
Stella
Comes
Memory System
Rust
Python
C#
```

测试阶段：

> 使用它从未见过的项目。

例如完全陌生的：

- C++
- Java
- 新型 Rust 工程
- 新代码库
- 未出现过的问题类型

目的：

> 判断它到底获得了真正的 Coding 能力，还是仅仅对训练/演化环境过拟合。

---

# 40. 第一阶段的核心成功标准

不要定义为：

> “产生一个很聪明的 Agent。”

而定义为：

> **在固定 SLM 和固定 Core 的情况下，经过多代演化后，得到一个在真实 Coding Task 上明显优于 Base Harness、资源消耗更合理、并且能够泛化到陌生项目的 Harness。**

如果成功，这将支持：

> **复杂 Agent 能力的一部分可以通过系统结构的长期演化获得，而不一定需要改变底层模型参数。**

---

# 41. 第二阶段以后可以考虑的方向

第一阶段成功后，再逐渐开放：

## Multi-Agent

允许 Agent 创建 Agent，并观察是否出现：

- 分工
- 协作
- 专业化
- 组织

---

## Agent 间资源交易

例如：

```text
Tool
Knowledge
Compute
Energy
```

可以交换。

---

## Agent 间合作

允许多个 Agent 共同解决大型 Coding Task。

---

## Genome 重组

在确认 Clone + Mutation 有效后，再考虑类似“有性繁殖”的机制。

---

## 自动任务生成

最终才考虑：

> Agent 自己寻找或创造值得解决的问题。

否则过早开放容易产生：

- 自我刷分
- 任务循环
- 无意义任务
- 生态闭环作弊

---

# 42. 一个非常重要的设计原则

整个实验应尽量遵循：

> **规则少，边界硬，结果开放。**

也就是说：

我们规定：

```text
Core
Environment
Resources
Energy
Evaluation
Evolution Boundary
```

但尽量不规定：

```text
最优工具
最优 Workflow
最优 Memory
最优 Planner
最优组织结构
最优协作方式
```

最终真正值得观察的是：

> **系统自己发现了什么。**

---

# 43. 项目哲学

整个项目可以用一句话概括：

> **不要教 Agent 如何成为优秀的 Coding Agent，而是创造一个环境，让优秀的 Coding Agent 更容易生存。**

或者更进一步：

> **我们不直接设计最终系统，而是设计一个能够产生系统的生态。**

这也是本项目与普通 Agent Engineering 最大的区别。

---

# 44. 工程实现阶段建议优先顺序

不要一开始实现全部机制。

建议：

```text
Phase 0
最小 PI Agent
        ↓
Phase 1
Sandbox + Coding Task
        ↓
Phase 2
资源监控 + Energy
        ↓
Phase 3
Genome / Plugin
        ↓
Phase 4
Self-Rewrite
        ↓
Phase 5
Clone + Mutation
        ↓
Phase 6
Population / Scheduler
        ↓
Phase 7
Selection / Survival
        ↓
Phase 8
长期演化实验
        ↓
Phase 9
未知项目泛化测试
```

每一步都应该可以独立运行和验证。

---

# 45. 第一版最小可行系统（MVP）

如果需要极度压缩范围，第一版甚至只需要：

```text
固定 27B SLM
+
一个极简 PI Agent
+
Plugin 系统
+
Sandbox
+
Coding Task
+
自动测试
+
Energy
+
Clone
+
Mutation
```

暂时不需要：

- Multi-Agent
- Agent 交易
- 自动任务生成
- 复杂 Memory
- 有性繁殖
- 复杂生态经济
- 高级社会结构

只验证：

> **一个 Agent 能否通过 Self-Rewrite + Clone + Mutation，逐渐产生更好的 Coding Harness。**

---

# 46. 最终架构概念图

```text
                           HUMAN
                             │
                        Coding Tasks
                             │
                             ↓
                 ┌─────────────────────┐
                 │     ENVIRONMENT     │
                 │                     │
                 │ Task System         │
                 │ Evaluation          │
                 │ Resource Rules      │
                 │ Energy Rules        │
                 │ Evolution Rules     │
                 │ Sandbox             │
                 └──────────┬──────────┘
                            │
              ┌─────────────┼─────────────┐
              ↓             ↓             ↓
           Agent A       Agent B       Agent C
              │             │             │
       ┌──────┴──────┐      │      ┌──────┴──────┐
       │             │      │      │             │
      Core         Genome   │     Core         Genome
       │             │      │      │             │
       │       ┌─────┼─────┐│      │       ┌─────┼─────┐
       │       ↓     ↓     ↓│      │       ↓     ↓     ↓
       │    Plugins Workflow Policy│   Plugins Workflow Policy
       │                          │
       └──────────────┬───────────┘
                      │
                    Memory
                      │
                      ↓
               Shared Resources
                      │
           ┌──────────┴──────────┐
           ↓                     ↓
       Local 27B             External LLM
           │                     │
           └──────────┬──────────┘
                      ↓
                 Computation
                      │
                      ↓
                  Real Tasks
                      │
                      ↓
                  Evaluation
                      │
                      ↓
                   Energy
                      │
              ┌───────┴────────┐
              ↓                ↓
            Survive         Reproduce
              │                │
              ↓                ↓
        Self-Rewrite       Clone + Mutation
              │                │
              └───────┬────────┘
                      ↓
                 Next Generation
```

---

# 47. 当前阶段的结论

理论设计暂时可以在这里冻结。

目前已经确定的核心原则：

1. **第一阶段只研究 Coding Agent。**
2. **任务主要由人类提供真实工程问题。**
3. **底层 27B SLM 固定，不进行参数训练。**
4. **所有 Agent 共享同一个本地 SLM 和外部 LLM。**
5. **PI Agent 风格的最小 Core 不可修改。**
6. **Plugin 是主要遗传物质。**
7. **Workflow 和 Policy 作为辅助遗传物质。**
8. **Memory 属于个体，经过验证后才可固化为可遗传 Plugin。**
9. **采用 Self-Rewrite + Clone + Mutation。**
10. **第一阶段不引入有性繁殖。**
11. **Energy 是生存预算，不等同于真实硬件资源。**
12. **真实计算资源构成生态系统的物理边界。**
13. **Agent 可以 ACTIVE / DORMANT / DEAD。**
14. **死亡 Agent 的部分遗产可以继续存在。**
15. **评价必须独立于 Agent，不能允许其修改裁判。**
16. **不预设 Multi-Agent、专业分工等高级结构。**
17. **如果复杂结构自然出现，应作为实验结果记录。**
18. **Base Harness 必须永久保留作为对照组。**
19. **最终必须使用陌生项目测试泛化能力。**
20. **项目的最终目标不是“造一个更聪明的模型”，而是验证“能否通过演化产生真正可用的系统”。**

---

# 48. 最终研究问题

整个项目最终可以归结为一个问题：

> ## **如果给一个能力有限但稳定的本地 SLM，只提供一个不可变的最小生命核心，再给予它真实的 Coding 环境、有限的计算资源、生存压力、自我修改和繁殖能力，那么一个真正可用的 Coding Harness 能否从这个生态系统中自然演化出来？**

如果答案是肯定的，那么下一步才真正有意义：

> **让这个数字单细胞走出 Coding World，进入更加开放的数字生态系统。**
