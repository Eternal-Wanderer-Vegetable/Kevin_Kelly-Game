# ISSUE-05：子进程真实资源计量缺失（GPU/VRAM 无数据）

- **设计出处**：工程方案 §5.2（Compute Resource）、§8（真实硬件是物理边界）、H2
- **严重度**：中（H2 硬件适应假设缺少观测数据）
- **状态**：部分修复

## 现象

`runSandboxCommand` 的 `resourceUsage.scope` 为 `"controller-process"`，注释明确
child-process 计量超出本阶段。CPU time / 内存峰值只反映控制器自身，沙箱内跑的真实
任务进程不产生数据；GPU/VRAM 完全无计量。

## 修复方案

新增 `src/resources/child-usage.ts`：Linux 下按间隔采样 `/proc/<pid>/stat`（utime+stime）
与 `/proc/<pid>/status`（VmHWM 峰值），聚合为 `childProcess` scope 的 cpuTimeMs/memoryPeakBytes；
非 Linux 平台返回 null，scope 保持 `controller-process` 并如实标注——不伪造数据。
GPU/VRAM 计量依赖具体推理后端，本阶段不实现，保留 UsageRecord 字段扩展位。
