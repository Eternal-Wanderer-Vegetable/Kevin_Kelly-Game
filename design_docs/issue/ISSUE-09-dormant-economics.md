# ISSUE-09：DORMANT 无差异维护费率，休眠无收益

- **设计出处**：工程方案 §9（DORMANT 低/零维护成本）、§10（让 Agent 权衡工作 vs 休眠）
- **严重度**：中（休眠机制名存实亡）
- **状态**：已修复

## 现象

状态机支持 ACTIVE↔DORMANT，但 `PopulationController.maintain()` 对两种状态都按
`"maintenance"` reason 全额扣费。休眠没有任何 Energy 收益，理性 Agent 永远不会
主动休眠——设计要的"工作 vs 休眠"权衡压力不存在。

## 修复方案

`EnergyPolicy` 支持 `maintenance` 与 `dormant-maintenance` 两个独立 reason；
`maintain()` 按生命周期状态选择费率，DORMANT 默认费率显著低于 ACTIVE
（可由配置设为 0）。Agent 可自主调用 `enterDormant()`/`revive()` 参与权衡。
