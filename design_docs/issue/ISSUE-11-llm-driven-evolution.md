# ISSUE-11：Mutation/Self-Rewrite 不由 Agent 自主触发（无 LLM 驱动）

- **设计出处**：工程方案 §26（发现自身缺陷→修改 Genome）、§27（结构级变异）
- **严重度**：中
- **状态**：已修复

## 现象

7 种结构变异是外部调用方传入的指令，Self-Rewrite 的 `mutate` 回调也由外部提供。
设计要的"Agent 发现自身缺陷→自主修改 Genome"链路不存在——演化操作的发起方是
人类/脚本，不是 Agent 自身。

## 修复方案

新增 `src/evolution/mutation-planner.ts`：以 SLM 规划器（CognitionProvider）输入
agent 的失败摘要/资源使用，输出结构化 `GenomeMutation[]` 或 self-rewrite 文件编辑计划；
输出经 `assertGenomeMutation` 白名单校验，解析失败/非法操作降级为空计划（不演化），
绝不执行未校验的自由文本修改。演化循环在 Energy 足够时调用该规划器自主触发。
