# ISSUE-01：缺少端到端演化闭环编排器

- **设计出处**：工程方案 §37 演化循环、§36 第一代生态、§44 Phase 5–8
- **严重度**：高（核心假设 H1 无法验证）
- **状态**：已修复

## 现象

设计文档要求的核心循环为：

```text
Task → Agent → Sandbox → Evaluation → Energy → Self-Rewrite/Clone+Mutation → 下一代
```

审计时各环节均为孤立服务，无任何编排器串接：

- `run-generation` 只做 baseline vs candidate/evolved 的对比评测，不产生下一代；
- `runTask` 仅在沙箱执行一条命令，不走 AgentCore 认知循环；
- `SelfRewriteService` / `CloneEmbryoService` 由外部代码传入 mutate 回调，Agent 不会自主发起。

"Agent 在生存压力下自主修改、复制、变异"的主线零件齐全但没有发动机。

## 修复方案

新增 `src/experiment/evolution-loop.ts`：按代执行 分发任务 → Agent 认知执行（有界 turn）→ 独立评价 → Energy 结算（维护费+任务奖励）→ 依 Energy 阈值触发 Self-Rewrite 或 Clone+Mutation → Embryo 资格检查 → PopulationSnapshot。新增 CLI `harness run-evolution --plan <plan.json>`，事件写入 JSONL。
