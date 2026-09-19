# ISSUE-07：资源发现机制完全缺失

- **设计出处**：工程方案 §7.3（允许 Agent 自己发现有价值的任务或资源）
- **严重度**：中（设计允许第一版简化，但不能完全没有）
- **状态**：已修复

## 现象

Energy 来源只有 initialEnergy + 配置化 reward，Agent 无法自主发现任务。
任务只由外部固定分发，"资源发现"这一 Energy 第三来源不存在。

## 修复方案

新增 `src/tasks/task-pool.ts` `TaskPool`：任务登记/认领/完成/释放，
同一任务不可被两个活 Agent 同时认领；演化循环在 Agent 完成分发任务后
允许其从池中认领额外任务，按 Energy policy `task-discovery` reason 结算小额奖励，
模拟"自主发现有价值工作"的最低可行形态。
