# Evolving Coding Harness
## 容器化与 CLI 方案

> 本文承接 `design_docs/Evolving_Coding_Harness_工程方案.md` 与 `design_docs/Evolving_Coding_Harness_落地实施方案.md`，为两项工程工作提供设计依据：将项目容器化以便他人在远程服务器部署，以及提供一个类 coding agent 的 CLI 界面以便后续实验与调试。

## 1. 背景与动机

第一阶段的工程路径已经完成，但当前形态存在两个具体障碍。

### 1.1 配置不可注入

项目零运行时依赖、无监听端口、无原生模块，容器化本身很轻。真正的障碍是配置无法从外部注入：

- `loadConfig`（`src/config.ts`）只被 `test/experiment.test.ts` 引用，生产代码中没有任何调用点。
- 全仓库除 `src/sandbox/runner.ts` 的沙箱环境白名单默认来源外，不读取 `process.env`。
- `localModelUrl` 默认 `http://127.0.0.1:8000/v1`。该地址在容器内指向容器自身，无法访问宿主或同网络的模型服务。

因此即使把镜像构建出来，部署者也没有任何途径告诉 Harness 模型服务在哪里、数据写到哪里。

### 1.2 缺少可用的实验入口

- `scripts/replay-run.ts` 与 `scripts/report.ts` 调用 `reportNotImplemented` 直接抛错，只有 `scripts/run-task.ts` 执行实际工作。
- `MockCognitionProvider`（`src/providers/mock-cognition.ts`）是唯一的 `CognitionProvider`，仓库中没有任何真实模型调用。
- `src/environment/` 只有内存实现（`MemoryEnvironment`、`MemoryToolEnvironment`），没有把 `read/search/write/exec/test` 五个工具接到真实沙箱工作区的代码。

也就是说，在补齐 Provider 与真实环境之前，任何 REPL 的 Think 与 Act 两步都是空转。这决定了实施顺序：Provider 与环境必须排在 CLI 之前。

### 1.3 目标产出

1. 一套可在远程服务器 `docker compose up` 起来的镜像与编排，含可选的 Python 变体。
2. 一个 `harness` CLI：既有可脚本化的子命令用于实验与 CI，也有 ink 驱动的交互式 REPL，能逐轮观察 Observe→Think→Act，并在真实沙箱工作区中读写文件、执行测试。

## 2. 必须守住的既有约束

- **许可证头**：每个新增 `.ts` 文件都要带 20 行 AGPL-3.0-or-later 头，与 `src/config.ts` 保持一致。
- **严格的 TypeScript 配置**：`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax` + `isolatedModules`。数组下标访问结果是 `T | undefined`；可选属性不能显式赋 `undefined`，沿用现有代码的 `...(x === undefined ? {} : { k: x })` 惯用法；类型导入必须显式 `import type`。
- **`rootDir: "."`**：构建产物落在 `dist/src/`、`dist/scripts/`、`dist/test/`。
- **`test/cli.test.ts` 是硬约束**：它以 `execFile(process.execPath, ["dist/scripts/<cmd>.js", "--help"])` 检查 run-task / replay-run / report 三个入口并正则匹配帮助文本。这三个路径与帮助文本必须继续可用。
- **契约校验使用 `assertExactKeys`**：对象字段必须严格等于声明集合，多一个字段即抛错。不要向 `ExperimentEvent`、`UsageRecord` 等结构添加字段，额外信息放入 `payload`。
- **Agent 不可修改边界**：`core / contracts / energy / evaluation / sandbox`（`src/genome/loader.ts` 的 `FORBIDDEN_DEPENDENCY_ROOTS`）。新增 Provider 置于 `src/providers/`、新环境置于 `src/environment/`、CLI 置于 `src/cli/`，均在边界之外。

## 3. 配置与真实 Provider

### 3.1 环境变量读取

不能让 `loadConfig` 无条件读取 `process.env`：`test/experiment.test.ts` 调用 `loadConfig({}, cwd)` 并断言默认值，若宿主机恰好设置了相关变量，测试会随环境漂移。

做法是把环境变量读取显式化为独立的纯函数：

```ts
export function configInputFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConfigInput
```

它将字符串环境变量转换为 `ConfigInput`，只对已定义的键产出字段，`HARNESS_DEFAULT_ENERGY` 经 `Number()` 转换后交由 `loadConfig` 现有校验拒绝非法值。`loadConfig` 自身的签名与行为完全不变。

CLI 入口显式组合，命令行参数优先级高于环境变量：

```ts
loadConfig({ ...configInputFromEnvironment(), ...cliOverrides })
```

API 密钥不进入 `HarnessConfig`。`HarnessConfig` 会被 hash 进实验记录，密钥不能落入事件日志。密钥由 Provider 在构造时单独读取。

环境变量清单：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `HARNESS_DATA_DIR` | 数据根目录 | `<cwd>/data` |
| `HARNESS_EVENT_LOG` | 事件日志路径 | `<dataDir>/runs/events.jsonl` |
| `HARNESS_DEFAULT_ENERGY` | 初始 Energy | `100` |
| `HARNESS_LOCAL_MODEL_URL` | 本地 SLM base URL | `http://127.0.0.1:8000/v1` |
| `HARNESS_EXTERNAL_MODEL_URL` | 外部 LLM base URL | 未设置 |
| `HARNESS_LOCAL_MODEL_KEY` | 本地服务密钥 | 空 |
| `HARNESS_EXTERNAL_MODEL_KEY` | 外部服务密钥 | 空 |
| `HARNESS_LOCAL_MODEL_NAME` | 本地模型名 | 由 Provider 定默认 |
| `HARNESS_EXTERNAL_MODEL_NAME` | 外部模型名 | 由 Provider 定默认 |

### 3.2 OpenAI 兼容 Provider

新增 `src/providers/openai-compatible.ts`，使用 Node 24 内建 `fetch`，不引入依赖。

```ts
export interface OpenAiCompatibleOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly tier: "local" | "external";
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly maxOutputTokens?: number;
  readonly systemPrompt?: string;
  readonly fetchImpl?: typeof fetch;
}

export class OpenAiCompatibleProvider implements CognitionProvider {
  think(request: CognitionRequest): Promise<AgentAction>;
  callCount(): { readonly localModelCalls: number; readonly externalModelCalls: number };
}
```

设计要点：

- **请求映射**：`POST {baseUrl}/chat/completions`，`messages` 为 system 与 user 两条。system 提示词从 `src/environment/tool-registry.ts` 的 `TOOL_NAMES` 生成工具清单，不另抄字符串，并要求模型只输出单个 JSON 对象 `{"type": "<tool>", "input": {...}}`。user 消息携带序列化后的 `request.observation`。
- **响应解析**：取 `choices[0].message.content`。在 `noUncheckedIndexedAccess` 下 `choices[0]` 是 `| undefined`，必须显式判空。剥离可能的代码围栏后 `JSON.parse`，校验 `type` 属于 `TOOL_NAMES` 且 `input` 为普通对象。解析失败抛错而非静默降级为 NOOP，调试期需要看到模型输出畸形；错误信息带上原始文本前缀便于定位。
- **超时**：`AbortSignal.timeout(timeoutMs)` 传入 `fetch`，捕获中止错误后转为明确的超时信息。
- **HTTP 错误**：非 2xx 时读取并截断响应体，抛出保留状态码的错误。
- **调用计数**：按 `tier` 递增，通过 `callCount()` 暴露。`ResourceMeter` 的计数是构造期参数而非事后累加，因此调用顺序为「执行完毕 → 读取 callCount → 构造 UsageRecord」。
- **不修改 `MockCognitionProvider`**，它是现有测试的基石。

配套工厂函数把配置转为 Provider：

```ts
export function createProviderFromConfig(
  config: HarnessConfig,
  tier: "local" | "external",
  env?: Readonly<Record<string, string | undefined>>,
): OpenAiCompatibleProvider
```

`tier === "external"` 且 `config.externalModelUrl` 未设置时抛出明确错误。

### 3.3 与 SharedSlmQueue 的关系

`SharedSlmQueue`（`src/scheduler/shared-slm-queue.ts`）串行执行请求，正是共享本地 SLM 的语义。不把队列塞进 Provider 内部，否则 Provider 会隐式带上调度语义。改为在 CLI 层组合一层薄封装 `src/providers/queued-cognition.ts`：

```ts
export class QueuedCognitionProvider implements CognitionProvider {
  constructor(inner: CognitionProvider, queue: SharedSlmQueue);
  think(request: CognitionRequest): Promise<AgentAction>;
}
```

单 agent 调试直接使用裸 Provider，多 agent 实验再套队列。注意 `enqueue` 失败时 reject 的是 `QueueFailure` 对象而非 `Error`，封装内需转换为 `Error` 再抛出，否则上层 `error instanceof Error` 的判断会失效。

## 4. 真实沙箱工作区环境

新增 `src/environment/sandbox-tool-environment.ts`，把五个工具接到真实的 `mkdtemp` 工作区，复用 `resolveSandboxPath` / `writeSandboxFile` / `runSandboxCommand`，不重写路径校验逻辑。

```ts
export interface SandboxToolEnvironmentOptions {
  readonly workspace: SandboxWorkspace;
  readonly allowedCommands: readonly string[];
  readonly allowedEnvironment?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly goal: string;
  readonly maxSearchResults?: number;
}

export class SandboxToolEnvironment implements EnvironmentInterface {
  observe(): Promise<Observation>;
  act(action: AgentAction): Promise<Readonly<Record<string, unknown>>>;
}
```

工具映射均以 `workspace.inputRoot` 为根：

- `read`：`resolveSandboxPath` 后 `readFile`。文件缺失返回 `{ok: false, output: {error}}`，与 `memory-tools.ts` 的 failure 风格一致，不抛错。
- `search`：递归遍历工作区，按路径或内容子串匹配，返回相对路径列表，受 `maxSearchResults` 约束。
- `write`：调用 `writeSandboxFile`，越界时它自身抛错，捕获后转为 failure 结果。
- `exec`：调用 `runSandboxCommand`。命令不在白名单时它抛错，捕获后转为 failure。返回退出码、输出、超时与截断标记。
- `test`：与 `exec` 同路径，但返回 `passed: exitCode === 0 && !timedOut`，与 `memory-tools.ts` 的 `test` 契约对齐。

### 4.1 observe 的设计差异

`MemoryToolEnvironment` 从固定观察列表 `shift()`，列表耗尽即抛错。那是测试夹具语义，真实 agent 循环不能如此。这里改为从工作区状态与上一轮结果派生：

- 第一轮：`{kind: "task-start", content: {goal, files, workspaceRoot: "."}}`
- 后续轮：`{kind: "tool-outcome", content: {goal, turn, lastAction, lastOutcome, files}}`

`observe()` 因此是幂等且永不耗尽的，`act()` 负责把结果记入内部状态。文件列表需截断以避免观察量膨胀。

只向 agent 暴露相对路径，绝不把 `workspace.root` 这类绝对临时路径写入 observation，否则模型可能学会拼接绝对路径试探沙箱之外。

### 4.2 生命周期

本类不拥有 workspace，不在内部调用 `dispose()`。工作区的创建与销毁由 CLI 层以 `try/finally` 负责，与 `task-runner.ts` 的既有风格一致。

`allowedCommands` 由调用方给定。REPL 默认应给出极窄集合，不默认放开 shell。

## 5. CLI 架构

### 5.1 目录布局

```text
src/cli/
  help.ts              已存在，保留
  args.ts              parseArgs 薄封装
  commands/
    run-task.ts        run-task 实现体，供 scripts/ 与 harness 共用
    replay-run.ts      replay 的真实实现
    report.ts          report 的真实实现
    run-generation.ts  单代实验
    repl.ts            启动壳：装配 provider/env/agent，再动态 import TUI
  tui/
    app.tsx            ink 根组件
    turn-view.tsx      单轮 Observe→Think→Act 渲染
    session.ts         会话状态机，不含 ink，纯逻辑便于测试
scripts/
  run-task.ts          薄 wrapper
  replay-run.ts        薄 wrapper
  report.ts            薄 wrapper
  harness.ts           根命令，分发到 cli/commands/
```

`test/cli.test.ts` 无需修改。三个 `scripts/*.ts` 继续存在并输出同样的 `formatHelp(command)` 文本，改动仅在于不再调用 `reportNotImplemented` 而是调用真实实现。`CommandDefinition` 常量保持原样，新增选项时只追加 `options` 条目，不改动已有条目的措辞。

### 5.2 参数解析

使用 `node:util` 的 `parseArgs`，属标准库，不增加依赖。在 `src/cli/args.ts` 薄封装一层，统一处理未知选项。保留 `src/cli/help.ts` 的 `CommandDefinition` / `formatHelp` / `shouldShowHelp` 约定：每个命令继续声明一个 `CommandDefinition` 常量，`parseArgs` 的配置与它并列声明。`reportNotImplemented` 保留导出，供尚未实现的命令占位使用。

### 5.3 子命令集

- `harness run-task --task <spec.json>`：现有逻辑抽出，行为不变。
- `harness replay-run --input <events.jsonl> [--format json|text]`：`EventLog.readAll()` 后交由 `replayEvents`，输出 runId、事件数与各 agent 的 lifecycle。
- `harness report --run <run-id> [--input <events.jsonl>] [--format json|text]`：读取事件日志，按 `runId` 过滤后用 `replayEnergyEvents` 重建 Energy，汇总事件类型计数与 agent 终态。注意 `replayEvents` 遇到多个 runId 会抛错，因此必须先过滤再重放。
- `harness run-generation --plan <plan.json>`：装配 `CalibrationRunner` 或 `GeneralizationRunner` 跑一代，并把 `ExperimentEvent` 追加进 `EventLog`。这是落地方案第 4 节列出但尚缺的脚本。
- `harness config`：打印解析后的 `HarnessConfig`，遮蔽密钥只显示是否已设置。部署排障的第一站。
- `harness repl [--task <spec.json>] [--goal <text>] [--provider local|external|mock]`：交互式会话。

`run-generation` 接收 schema version 1 的 JSON 计划。计划顶层包含
`schemaVersion`、`mode`、`config` 和对应的 `task` 或 `plan`；`mode` 为
`calibration` 时运行一个 baseline/candidate 对照，`mode` 为
`generalization` 时运行 evolution、validation、holdout 三个互不重叠的分区。
命令会追加 `GENERATION_STARTED`、每次运行一个
`EXPERIMENT_RUN_COMPLETED`，以及 `GENERATION_COMPLETED` 事件。校准即使
候选失败也返回 0 供继续分析；泛化会打印完整报告，并在 holdout 未通过
预提交阈值时返回 1。

### 5.4 交互式 REPL

把 ink 隔离在动态 import 之后。`src/cli/commands/repl.ts` 负责解析参数、`loadConfig`、构造 Provider、`createSandboxWorkspace`、构造 `SandboxToolEnvironment` 与 `AgentCore`，组装出纯逻辑的 `ReplSession`（位于 `src/cli/tui/session.ts`，不 import ink），然后才 `await import()` 渲染层。

这样带来三个好处：`ReplSession` 可用 `node:test` 直接测试；非交互子命令路径完全不加载 ink 与 react；无 TTY 时可在动态 import 之前检测 `process.stdout.isTTY` 并回退到逐行文本模式，这一点在容器中至关重要。

```ts
export interface ReplTurn {
  readonly index: number;
  readonly observation: Observation;
  readonly action: AgentAction;
  readonly outcome: Readonly<Record<string, unknown>>;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly error?: string;
}

export class ReplSession {
  step(): Promise<ReplTurn>;
  run(maxTurns: number): AsyncGenerator<ReplTurn>;
  turns(): readonly ReplTurn[];
}
```

`run()` 采用 async generator，渲染层以 `for await` 消费并逐轮更新，实现逐轮可见。中断通过 `AbortSignal` 完成。

斜杠命令集：

| 命令 | 行为 |
| --- | --- |
| `/step` | 执行一轮 |
| `/run [n]` | 连续执行 n 轮 |
| `/stop` | 中断当前连续执行 |
| `/task <path>` | 载入 TaskSpec 并重建工作区 |
| `/goal <text>` | 修改任务目标，进入下一次 observation |
| `/files` | 列出当前工作区文件 |
| `/cat <path>` | 查看工作区文件内容 |
| `/patch` | 显示相对初始状态的差异 |
| `/state` | agent lifecycle、轮数与 Energy 余额 |
| `/provider` | 当前 provider 的 base URL 与模型，遮蔽密钥，含调用计数 |
| `/reset` | 丢弃工作区并重建 |
| `/help` `/quit` | 帮助与退出 |

组件结构：根组件持有会话状态，下含 Header（agent id、provider、lifecycle）、TurnList（滚动的单轮视图列表，Observe/Think/Act 三段分色）、StatusBar 与 Input。

### 5.5 引入 ink 的代价

这是本方案唯一实质性的工程摩擦点：

- `package.json` 新增运行时依赖 `react` 与 `ink`，开发依赖 `@types/react`。**这打破了当前的零运行时依赖属性。** 落地方案第 2.1 节把减少依赖作为降低演化实验变量的手段，因此需在 README 明确记录：ink 只服务于人类调试界面，不参与 agent 执行路径，非交互子命令与 CI 不加载它。
- 需要 `"jsx": "react-jsx"`。不改根 tsconfig 的 `include`，而是新增 `tsconfig.tui.json` 继承根配置、只 include TUI 目录并开启 `jsx`；根 tsconfig 的 `exclude` 加上该目录。`build` 脚本变为两次 `tsc`。理由是 `.tsx` 在 `verbatimModuleSyntax` 与 `isolatedModules` 组合下的 JSX 导入语义容易出意外，隔离配置比全局开启风险更小，也让「TUI 是可选层」在构建结构上显式化。
- `moduleResolution: NodeNext` 下 ink 是纯 ESM，与本项目的 `"type": "module"` 天然匹配，不需要 interop 补丁。
- 依赖版本钉死，不使用范围符号。

## 6. 容器化

### 6.1 多阶段镜像

```text
FROM node:24-bookworm-slim AS builder
  npm ci                    需要 devDeps 才能执行 tsc
  COPY tsconfig / src / scripts / test
  npm run typecheck && npm run build

FROM node:24-bookworm-slim AS runtime
  npm ci --omit=dev
  COPY --from=builder /app/dist ./dist
  USER node
  ENTRYPOINT ["node", "dist/scripts/harness.js"]

FROM runtime AS runtime-python
  apt-get install python3 python3-venv
```

要点与权衡：

- **从 `dist/` 运行，不用 tsx。** `tsx` 是开发依赖，`--omit=dev` 之后不存在。运行时镜像不执行 `npm test`，测试在 builder 阶段或 CI 中运行。若需要在镜像内跑测试，另加一个继承 builder 的 test target 供 CI 使用。
- 顺序必须是 builder 安装全量依赖并构建，runtime 只安装生产依赖。
- 引入 ink 后 `dependencies` 非空，`--omit=dev` 才真正有作用；在此之前它产出空的 `node_modules`，不影响正确性。
- 使用 `bookworm-slim` 而非 alpine：glibc 兼容性更省心，Python 变体装包也更顺。
- 必须以 `node` 用户运行，不用 root。

### 6.2 Python 变体

在同一个 Dockerfile 中增加一个继承 runtime 的 `runtime-python` target，不写第二个 Dockerfile，避免重复。构建时通过 `--target` 选择，compose 通过 `build.target` 选择。

需要注意：安装 `python3` 只是让沙箱有可能执行 Python 任务，实际能否执行仍取决于 `TaskSpec.allowedCommands` 是否列出 `python3`。`runSandboxCommand` 的命令白名单是硬性门槛。这一点必须写进文档，否则使用者会误以为装上即可用。

### 6.3 编排

`docker-compose.yml` 定义 harness 服务，要点：

- 环境变量注入 `HARNESS_DATA_DIR`、`HARNESS_EVENT_LOG`、`HARNESS_LOCAL_MODEL_URL`。密钥走 `.env` 或 secrets，不写进 compose 文件。
- 卷映射 `./data:/app/data` 与 `./experiments:/app/experiments`。
- `/tmp` 使用 tmpfs 并设置 size 上限，因为沙箱工作区位于 `os.tmpdir()`。
- `init: true`，理由见 6.5。
- `stdin_open` 与 `tty` 为 REPL 所需。
- 安全加固：`no-new-privileges`、`cap_drop: ALL`、`pids_limit`、`mem_limit`。

模型服务默认注释掉，文档给出两种用法：取消注释启动本地服务；或保持注释并把 `HARNESS_LOCAL_MODEL_URL` 指向外部地址。后者需特别提醒不能使用 `127.0.0.1`，容器内该地址指向容器自身，这正是当前默认值在容器中失效的原因。

卷映射的宿主目录必须先存在。仓库中目前没有 `data/`，`.gitignore` 忽略了其下的 `runs`、`agents`、`archive`。应提交 `data/.gitkeep` 与 `experiments/.gitkeep`，否则 Docker 会以 root 身份创建宿主目录，容器内的 `node` 用户无法写入。这是最常见的部署踩坑。

### 6.4 构建上下文排除

`.dockerignore` 需排除 `node_modules`、`dist`、`data`、`experiments`、`.git`、`.github`、`.gitnexus`、`.claude`、`*.log`。其中 `.gitnexus/` 含 parse-cache 等大目录，务必排除。

### 6.5 容器中沙箱行为的实际变化

以下几条是容器化后行为会变的地方，不是纸面风险。

**PID 1 与僵尸回收。** `runSandboxCommand` 通过 `spawn` 启动子进程，而 `terminateProcess`（`src/sandbox/runner.ts`）只对直接子进程调用 `kill()`，**没有进程树清理**。落地方案第 10 节「Sandbox 风险」明确要求子进程树清理，这是一处与设计文档的既存偏差。在容器中 Node 是 PID 1，不使用 init 时孤儿进程无人回收会堆积。因此编排必须启用 `init`。补齐进程树清理列为已知缺口，本次不实现但显式记录，不当作已解决。

**白名单中的绝对路径。** 多处测试使用 `process.execPath` 作为白名单项。容器内 Node 路径为 `/usr/local/bin/node`，与宿主机不同。因此 TaskSpec 不应写死宿主机的解释器路径，文档需说明应使用容器内可解析的命令名或路径。

**tmpdir 与磁盘。** 沙箱工作区位于 `os.tmpdir()`，容器内即 `/tmp`。使用 tmpfs 既提速也保证容器销毁即清理，但 tmpfs 占用内存，需设置 size 上限；较大的仓库 fixture 拷贝可能撑爆，文档需提示。

**根文件系统不能只读。** 沙箱需写 `/tmp`，事件日志需写 `/app/data`。以 `cap_drop`、`no-new-privileges`、`pids_limit`、`mem_limit` 作为补偿。

**隔离强度的实话。** 落地方案第 10 节指出，威胁模型确认前不允许把不可信 Mutation 代码运行在重要宿主环境。容器提供的是一层隔离而非强隔离：变异代码在容器内以 `node` 用户执行，能读写挂载卷。文档必须明确：不要把该容器与敏感数据放在同一台机器；不要挂载宿主敏感目录；不要使用 `--privileged`；不要挂载 Docker socket。

## 7. 测试与验证

### 7.1 新增测试

沿用 `node:test` 与 `assert/strict` 风格。

- `test/config-env.test.ts`：各环境变量的转换；空环境产出空对象；非法能量值经 `loadConfig` 被拒。传入显式 env 对象，不依赖 `process.env`。
- `test/provider-openai.test.ts`：通过可注入的 fetch 假实现覆盖正常响应、带代码围栏的响应、非法 `type`、非 2xx、超时路径，以及 `callCount()` 按 tier 递增。
- `test/sandbox-tool-environment.test.ts`：真实临时工作区下，write 后 read 取回内容；read 缺失文件返回失败结果；write 越界被拒；exec 白名单外命令被拒；exec 白名单内命令返回退出码；search 命中路径与内容；`observe()` 可反复调用且第二轮带上一轮结果。`finally` 中销毁工作区。
- `test/repl-session.test.ts`：以 `MockCognitionProvider` 与 `SandboxToolEnvironment` 驱动会话，验证单轮结构、连续执行轮数与中断。不 import ink，保证在无 TTY 的 CI 中稳定。
- `test/cli.test.ts`：扩展而非重写。保留现有三个帮助文本断言，新增根命令帮助断言，以及 replay-run 对临时事件日志的端到端断言。

ink 组件不写单元测试，逻辑已全部落在 `ReplSession` 中被覆盖，组件只做渲染。

### 7.2 镜像验证

```bash
docker build --target runtime -t harness:dev .
docker build --target runtime-python -t harness:python .
docker run --rm harness:dev --help
docker run --rm harness:dev config
mkdir -p data experiments
docker compose run --rm harness run-task --task /app/data/tasks/example.json
docker compose run --rm -it harness repl --goal "..."
docker compose run --rm harness repl --goal "..." < /dev/null
```

最后一条尤为重要。ink 在无 TTY 环境下的行为是引入该依赖带来的真实风险，回退路径必须真正验证过。

### 7.3 分期实施

每期结束时 typecheck、build、test 三项均需通过。

**Phase 0 方案归档。** 本文档，并在两份 README 的文档小节加上链接。

**Phase 1 配置与 Provider。** `configInputFromEnvironment`、`OpenAiCompatibleProvider`、`QueuedCognitionProvider`、工厂函数及对应测试。此期结束仓库仍零运行时依赖。

**Phase 2 沙箱环境。** `SandboxToolEnvironment` 与测试。此期结束 agent 已能在真实工作区中动手，但仅能从 TypeScript 调用。

**Phase 3 非交互 CLI。** `args.ts`、`commands/` 下各命令、`scripts/harness.ts`，三个旧脚本改为 wrapper，扩展 `test/cli.test.ts`。此期结束即已是可用的实验 CLI，且仍零运行时依赖，是一个有价值的中间交付点。

> 注：Phase 3 已完成。（2026-09-08）

**Phase 4 容器化。** Dockerfile 三个 target、`.dockerignore`、`docker-compose.yml`、目录占位文件、部署文档。安排在 ink 之前，使镜像先在零依赖状态下验证通过，避免 ink 引入的问题与容器问题相互纠缠。

> 注：Phase 4 已完成。（2026-09-08）

**Phase 5 交互式 REPL。** 先实现并测试纯逻辑的 `ReplSession`，再加 `tsconfig.tui.json` 与依赖，然后是渲染组件、动态 import 与无 TTY 回退，最后更新镜像构建步骤并重新验证。

> 注：Phase 5 已完成。（2026-09-08）

**Phase 6 单代实验命令。** 装配校准与泛化运行器，补齐落地方案第 4 节列出的缺失脚本。

> 注：Phase 6 已完成。（2026-09-08）

**Phase 7 自动发布 CI。** 由 GitHub Actions 监听 `v*.*.*` 标签，先执行
typecheck、build 和 test，再构建并推送 `runtime` 与 `runtime-python` 两个
GHCR 镜像，最后创建 GitHub Release 并附加运行时归档。稳定标签维护
`latest`，预发布标签不覆盖 `latest`。

> 注：Phase 7 已完成。（2026-09-08）

## 8. 两项工作之间的冲突点

1. **ink 需要 TTY，容器默认没有。** 在动态 import 之前检查 `process.stdout.isTTY`，无 TTY 时走逐行文本模式；编排中提供 `stdin_open` 与 `tty`；验证清单显式覆盖无 TTY 路径。
2. **零依赖属性与 ink 冲突。** ink 只在 REPL 路径动态加载，子命令与 CI 不触及；README 记录该取舍。
3. **`--omit=dev` 与 tsx 冲突。** 运行时镜像从 `dist/` 运行，测试放在 builder 阶段与 CI，不在生产镜像中执行。
4. **`test/cli.test.ts` 锁定了三个脚本路径与帮助文本。** 三个脚本保留为 wrapper，`CommandDefinition` 措辞不改，只追加选项。
5. **进程树清理缺口与容器 PID 1。** 本次以 `init` 缓解，并将 `runner.ts` 未实现落地方案要求的子进程树清理作为已知缺口显式记录。
