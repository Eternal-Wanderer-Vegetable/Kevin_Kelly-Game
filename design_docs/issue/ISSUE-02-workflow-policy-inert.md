# ISSUE-02：Workflow/Policy 只是元数据，不影响 Agent 行为

- **设计出处**：工程方案 §20（Workflow）、§21（Policy）
- **严重度**：高（两类遗传变异无表型效应）
- **状态**：已修复

## 现象

- `loadWorkflow`/`loadPolicy` 在 `src/genome/loader.ts` 定义后全仓库无调用者；
- `WorkflowManifest.steps`、`PolicyDocument.rules` 仅做 schema 校验，AgentCore 的 turn 循环完全不读；
- 设计要求的结构化 policy 分类（tool_selection / verification / memory / resource / reproduction）无对应实现。

后果：`modify-workflow` / `modify-policy` 两类结构变异只改 manifest 字符串，对 Agent 行为零影响，是无效变异。

## 修复方案

新增 `src/evolution/genome-runtime.ts`：

- `derivePolicyConfig(policies)`：把 policy rules 解析为可执行决策配置（认知层 tier/升级阈值、休眠阈值、繁殖阈值等），未知 rule 原样保留供演化；
- `workflowGuidance(workflows)`：把 workflow steps 合并为观察中暴露给模型的步骤提示；
- `SandboxToolEnvironment` 接受可选 `genome` 资产，把 workflow 步骤与 policy 提示注入 observation，使 Genome 资产成为 Agent 决策输入。
