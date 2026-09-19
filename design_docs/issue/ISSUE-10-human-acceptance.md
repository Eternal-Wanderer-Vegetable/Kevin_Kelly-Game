# ISSUE-10：Human Acceptance 无采集流程

- **设计出处**：工程方案 §14（Human Acceptance）、§11（人类是高价值反馈源）
- **严重度**：中
- **状态**：已修复

## 现象

契约（`HumanAcceptance`）与标注函数（`recordHumanAcceptance`）已实现，
泛化阈值也含 `minHumanAcceptanceRate`，但运行时无任何采集入口——人工验收
只能作为 plan JSON 中预填字段注入，没有"任务完成后记录人工判定"的命令。

## 修复方案

新增 CLI `harness accept --evaluation <id|latest> --verdict <accept|reject|1-5> --run <runId>`：
把人工判定作为 `HUMAN_ACCEPTANCE_RECORDED` 事件追加到事件日志，
replay/report 聚合时把同 evaluationId 的判定合并回 EvaluationResult。
