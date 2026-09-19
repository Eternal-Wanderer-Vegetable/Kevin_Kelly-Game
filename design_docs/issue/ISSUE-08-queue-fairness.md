# ISSUE-08：共享 SLM 队列无优先级/等待统计

- **设计出处**：实施方案 §10（共享资源不公平）、工程方案 §31
- **严重度**：中
- **状态**：已修复

## 现象

`SharedSlmQueue` 为纯 FIFO。实施方案 §10 要求记录"请求优先级、Agent 等待次数"，
否则无法区分 Harness 能力差异与调度偶然性。等待时间有记录，但无优先级字段，
无按 Agent 聚合的排队统计。

## 修复方案

`QueueRequest` 增加可选 `priority`（数值大者优先，同优先级保持 FIFO）；
`SharedSlmQueue` 增加 `statsByAgent()`：每个 agent 的 enqueue 次数、累计等待、
累计执行、超时/取消次数。新增单元测试覆盖优先级排序与统计聚合。
