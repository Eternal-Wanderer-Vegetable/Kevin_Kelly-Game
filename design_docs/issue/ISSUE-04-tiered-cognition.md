# ISSUE-04：Agent 不做本地/外部模型调度决策

- **设计出处**：工程方案 §32（外部 LLM 为极昂贵认知资源）、§21（policy：何时调本地/外部）
- **严重度**：高（认知资源调度策略这一关键观察对象无法涌现）
- **状态**：已修复

## 现象

`--provider local|external|mock` 由操作者在 CLI 选择，Agent 运行时无法在两层模型间切换。
设计期望观察的"本地能解决就不调外部 LLM"的 emergent 策略无从发生。

## 修复方案

新增 `src/providers/tiered-cognition.ts` `TieredCognitionProvider`：默认走 local；
当 policy 配置 `cognition.escalateToExternal` 或 local 调用失败超过
`cognition.externalAfterFailures` 次时升级到 external tier，按调用记录
`tier` 供 UsageRecord 计量（external 成本显著高于 local，由 Energy policy 定价）。
