# 第一次真实模型修复实验

新增 `run-repair` 命令把 AgentCore、模型接口、工作区、容器测试和事件日志接成一次完整实验。
它验证的是“模型自主修复一个项目并通过独立验收”。这还不是 Genome 自改写或跨任务、多代演化效果的证明。

## 运行

需要 Node.js 24+、npm、正在运行的 Docker 引擎，以及可用的 OpenAI-compatible 模型端点。
在项目根目录执行：

```powershell
npm ci
npm run typecheck
npm run build
docker pull node:24-alpine

$env:HARNESS_EXTERNAL_MODEL_URL = "https://your-provider.example/v1"
$env:HARNESS_EXTERNAL_MODEL_NAME = "your-model"
# 通过当前会话环境或密钥管理器提供 HARNESS_EXTERNAL_MODEL_KEY。
# 不要把真实密钥写进任务 JSON、源码或版本控制。

npm run run-repair -- --task examples/repair/median.json --output experiments/repair --max-turns 12
```

也可以使用统一入口：

```powershell
npm run harness -- run-repair --task examples/repair/median.json
node dist/scripts/harness.js run-repair --task examples/repair/median.json
```

命令只使用显式提供的模型配置，不自动复用其他应用的凭据。它输出 JSON 报告，进度写入 stderr。
验收通过返回 0；未通过、超出轮数且未修复、模型或基础设施错误返回 1。每次运行创建新的目录，不覆盖旧结果。
容器镜像在运行开始前解析为不可变的 image ID，原版、公开测试和最终验收使用同一个镜像。

## 实验过程

1. 对固定原始源码执行独立验收，确认任务确实存在失败。
2. 向模型提供任务说明、源码和公开测试，保留多轮操作历史。
3. 模型只能读取、搜索、改写 `editableFiles` 中已有的源码，以及请求执行固定公开测试。
4. 有源码修改且公开测试通过时停止；否则最多执行 `--max-turns` 轮（默认 12，每轮最多一次模型调用）。
5. 从固定原始文件重新构建验收工作区，仅带入允许修改的源码，用框架保存的独立测试验收一次。
6. 保存原版结果、候选结果、修改前后内容、全部回合和哈希校验记录。

每个模型请求最多等待 60 秒、最多生成 2048 tokens。每次测试最多等待 30 秒，并限制输出大小。
模型可以观察公开测试的结果；最终独立验收内容和结果不参与这次运行的模型反馈。

## 实验产物

`experiments/repair/repair-<UUID>/` 中包括：

| 文件 | 内容 |
| --- | --- |
| `report.json` | 成败、原版/候选测试结果、模型调用数、执行时间、任务与候选哈希、Docker 镜像 ID |
| `events.jsonl` | 任务开始、原版验收、每轮观察/动作/结果、最终验收和完成事件 |
| `task.json` | 完整固定任务，包括独立验收测试，供实验结束后审计 |
| `candidate.json` | 最终候选源码文件映射 |
| `changes.json` | 各修改文件的修改前后全文 |
| `checksums.json` | 上述产物的 SHA-256 校验值 |

`sourceCommit` 记录运行时所在 checkout 的 HEAD；开发中的未提交修改不包含在该 commit 中，交付源码包应与报告一起保留。
模型随机性及远端模型版本变化意味着重新调用模型未必产生相同补丁；保存的候选源码和测试可用于重验结果。

## 自定义任务

复制 `examples/repair/median.json` 并修改以下内容：

- `files`：原始源码等文件内容；目前面向小型、无需安装依赖的 JavaScript ESM 项目。
- `editableFiles`：允许修改的现有 `.mjs` 文件。
- `visibleTests`：模型可以阅读和请求运行的 `.test.mjs` 文件。
- `acceptanceTests`：单独保管、最终验收的 `.test.mjs` 文件。
- `goal`：包含所有公开行为要求，避免用未告知的需求评判模型。

任务文件来自操作者，应在运行前审核。路径必须规范、相对且没有重名；测试不能同时出现在源码列表里。
此版本不自动拉取任意 Git 仓库、不安装任务依赖，也不允许模型选择命令或网络访问。

## 隔离与适用范围

生成的程序只在 Docker 容器中运行：禁用网络、只读工作区、非 root 用户、移除 capabilities、限制进程数/内存/CPU。
模型密钥留在控制进程，不注入容器。超时后强制删除本次创建的容器。
Agent 的文件工具在控制进程中工作，但仅接受工作区路径；模型没有主机命令执行工具。

这是受控任务实验边界，不是对抗性程序的完整评测系统：候选代码与 Node 测试仍在同一测试运行环境中，
刻意操纵测试运行器或输出的恶意程序需要更强的外部判分机制。独立验收主要防止修改测试、替换命令和公开样例过拟合。

## 验证

```powershell
npm run typecheck
npm run build
npm test

# 额外执行真实 Docker 集成测试和超时清理测试，无需模型密钥。
$env:HARNESS_TEST_DOCKER = "1"
node --import tsx --test test/repair.test.ts
```

普通测试包含修复成功、未修复、篡改测试、替换命令、公开测试过拟合、轮数限制、服务错误和任务路径校验。
Docker 集成测试在未设置开关时显式跳过。
