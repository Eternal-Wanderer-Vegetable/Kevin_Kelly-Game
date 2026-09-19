# ISSUE-03：Plugin 加载后不接入 Agent 行为

- **设计出处**：工程方案 §19（Plugin 为主要遗传物质）、H3（Experience→Memory→Plugin→Genome→Offspring）
- **严重度**：高（唯一真正可演化的遗传物质不表达）
- **状态**：已修复

## 现象

`loadPlugin` 返回 `{manifest, module}`，但无任何代码把 plugin module 挂进 ToolRegistry 或认知链路。
Agent 运行时只能用内置五工具（read/search/write/exec/test）。verified plugin 虽能进入
PopulationEntry，却不改变后代能力，H3 能力积累链断裂在最后一环。

## 修复方案

新增 `src/evolution/plugin-runtime.ts`：约定 plugin module 可导出
`register(registry)` 函数或 `tools` 记录表，把插件工具合并进环境的 ToolRegistry；
`SandboxToolEnvironment` 增加可选 `plugins` 参数并调用注册。插件工具与内置工具同名冲突时拒绝加载，防止插件覆盖硬边界工具。
