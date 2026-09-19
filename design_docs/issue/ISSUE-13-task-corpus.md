# ISSUE-13：真实任务语料几乎为空

- **设计出处**：实施方案 Phase 10（收集真实 Level 1 任务）、工程方案 §12
- **严重度**：低
- **状态**：已修复

## 现象

契约支持 Level 1–3，但 `examples/` 下只有一个 `median.json` repair 任务。
校准与泛化需要的任务集（evolution/validation/holdout 分区）没有语料支撑。

## 修复方案

新增 `examples/tasks/` 目录，提供若干可重现的 Level 1 TaskSpec
（含 inputFiles、allowedCommands、baselineTestCommand），覆盖
修 bug/补函数/写测试三种类型，作为校准与 holdout 演示语料。
真实工程任务的持续收集仍是运维工作，不在代码层解决。
