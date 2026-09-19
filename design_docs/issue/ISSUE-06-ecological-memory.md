# ISSUE-06：Ecological Memory 没有查询面与遗产继承

- **设计出处**：工程方案 §24（三种记忆）、§30（死亡与遗产）
- **严重度**：中
- **状态**：已修复

## 现象

死亡归档只写 `legacy.json` + `failure.json`，没有 Plugin Archive、历史任务索引、
成功/失败 Genome 索引。生态记忆作为信息资源对活 Agent 不可见；dead agent 的
verified plugin 仅存于内存 PopulationEntry，进程结束即丢，无遗产复用路径。

## 修复方案

新增 `src/lifecycle/ecological-memory.ts`：维护 `archive/ecology-index.jsonl`
（死亡 agent 的 genomeId、失败原因、verified plugins、performance 摘要的 append-only 索引），
`PopulationController.archiveDead` 追加索引；`inheritablePlugins()` 供演化循环
在创建新 Agent 时把已验证插件遗产注入 child Genome 候选。
