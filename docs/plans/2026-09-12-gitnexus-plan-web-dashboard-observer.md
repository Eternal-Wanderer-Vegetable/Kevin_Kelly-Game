# GitNexus Engineering Plan

> Task: 为 Evolving Coding Harness 新增只读 Web 仪表盘——零依赖 Node 只读 API + Vite/React SPA，部署在远程服务器时可随时在浏览器查看实验进度；token 鉴权为可选项（未配置即开放，供本地/隧道使用；远程暴露必须配置 token）。
> Evidence verified at commit `b07dbe2f019ba79f23651afa1cf919e82a3e392c`; GitNexus index fresh（indexed commit 等于 HEAD `b07dbe2`，GitNexus 1.6.11；analyzer artifact/build digest 与索引一致，仅 npx 缓存目录导致 dependencyRuntime lockfile digest 漂移，按当前图处理，`status` 的 stale 标记据此免责）。
> Evidence provenance schema 2; global dirty digest `d98f9843912a47e1462d8c06f28cec37ed6c5e75c841a7b9c43a0b6ba63cab78`; cited-path manifest 18 sorted entries; exact generated plan path excluded.

## 1. Objective

[verified] 现状下"实验进度"只有两个出口：终端 TUI/CLI（`harness repl`、`report` 命令）和落盘的 JSONL 事件日志。远程部署（`deploy.mjs` + Compose）后无法在浏览器随时查看实验进展。

本计划新增一个**旁路只读 Web 仪表盘**，已锁定的两项决策：

- **前端直接采用 Vite + React**（为后续交互开发打基础），不再走零构建静态页路线；
- **token 鉴权为可选项**：未配置 `HARNESS_WEBUI_TOKEN` 时服务完全开放（本地端口、SSH 隧道场景）；配置后所有请求（API 与静态页）必须携带 token（远程公网暴露场景）。

验收标准：

- `docker compose --profile web up -d webui`（或 `node deploy.mjs --web`）后，浏览器可看到 run 列表与 run 详情（代际进度、repair 进度、agent 生命周期/能量、事件流），实验进行中新事件经 SSE 实时追加。
- 仪表盘对 harness 核心零侵入：不修改 `src/experiment/`、`src/energy/`、`src/contracts/` 的任何既有导出；web 层只 import 既有纯函数。
- 未配置 token 时本机可直接访问；配置 token 后无 token/错 token 请求返回 401。
- `npm run typecheck`、`npm run build`、`npm test` 全绿（含新增 web 测试）；Release 归档包含 webui 源码，容器内可直接构建。

## 2. Current Behaviour

[verified] 实验全程写 append-only JSONL 事件日志（`src/experiment/event-log.ts:29-38`），默认路径 `<dataDir>/runs/events.jsonl`（`src/config.ts:92-96`），容器内为 `/app/data/runs/events.jsonl` 并挂载到宿主机 `./data`（`docker-compose.yml:12,22-24`）。事件结构 `ExperimentEvent` 含 `runId/timestamp/type/agentId?/generation?/payload`（`src/contracts/index.ts:148-157`）。

[verified] 已产生的事件类型覆盖进度所需全部信号：`GENERATION_STARTED/COMPLETED`、`EXPERIMENT_RUN_COMPLETED`、`AGENT_STATE_CHANGED`、`ENERGY_REWARDED/DEBITED`（`src/cli/commands/run-generation.ts:194-249`）；`REPAIR_STARTED/BASELINE/TURN/ACCEPTANCE/COMPLETED/ERROR`（`src/experiment/repair.ts:81,107,156,169,176,200`）。

[verified] 聚合逻辑已是纯函数：`buildRunReport`（`src/cli/commands/report.ts:107-131`）产出事件计数、agent 生命周期与能量余额，内部调用 `replayEvents`（`src/experiment/replay.ts:34-66`）与 `replayEnergyEvents`（`src/energy/ledger.ts:123-126`），能量回放失败时降级为 warning 而非报错（`report.ts:142-169`）。`report --format json` 已经输出机器可读汇总。

[verified] 可视化仅限终端：Ink TUI（`src/cli/tui/app.tsx`）只在 REPL 进程内有效；远程服务器上没有浏览器可达的界面。

[verified] 部署边界：`deploy.mjs` 校验 Docker/Compose 后 `docker compose run --rm harness` 启动 REPL；`Dockerfile` 为 `builder → runtime(/runtime-python)`，ENTRYPOINT `node dist/scripts/harness.js`，非 root 运行（`Dockerfile:18-33`）；安全基线 cap_drop ALL、no-new-privileges、pids/mem 限制（`docker-compose.yml:26-32`）。Release 归档打包 `dist/docs/src/scripts/test/tsconfig*/Dockerfile/docker-compose.yml/deploy.mjs/package*.json` 等（`.github/workflows/release.yml:60-78`）。

## 3. Relevant Architecture

[verified] 命令层采用"双入口"模式：`scripts/harness.ts` 注册子命令表（`scripts/harness.ts:37-45`），每个子命令另有独立 `scripts/*.ts` 入口（`scripts/harness.ts:32-35` 注释 + `scripts/report.ts`）；bin `harness → dist/scripts/harness.js`（`package.json`）。

[verified] 配置解析经 `resolveConfig`（`src/cli/args.ts:181-194`）：CLI 参数 > 环境变量（`HARNESS_DATA_DIR/HARNESS_EVENT_LOG/...`）> 默认值，统一走 `loadConfig` 校验；`CONFIG_OPTIONS` 已声明 `data-dir/event-log/energy` 等选项（`args.ts:142-148`）。

[verified] 读日志语义与写方不同：`readEventLog` 对文件缺失直接报错（`src/cli/events.ts:46-59`）；一个日志文件可含多个 run（`listRunIds`，`events.ts:61-65`），`replayEvents` 拒绝多 run 日志（`replay.ts:41-43`），因此 `report` 命令先 `selectRun` 过滤再聚合（`report.ts:91`）。

[inferred] webui 应作为**旁路观察者**接入：与 harness 容器共享宿主机 `./data` 卷、只读挂载，独立常驻服务，不进入 REPL/命令进程，不改写路径。这与项目"配置与凭据不进 Core、部署不复制 CLI 逻辑"的既有边界一致（前置计划 `docs/plans/2026-09-08-gitnexus-plan-one-command-deployment.md` §3）。

## 4. GitNexus Findings

- [graph, source-verified] `context buildRunReport --repo .` → 精确命中 `Function:src/cli/commands/report.ts:107-131`；唯一 incoming 调用方 `reportCommand.run#2`；outgoing 为 `replayBalances/countEventTypes/listAgentIds/replayEvents`。结论：web 层 import 复用不新增上游耦合。
- [graph] `impact buildRunReport --direction upstream --repo .` → `risk: LOW`，`impactedCount: 1`，d=1 直接依赖仅 `reportCommand.run#2`（1 条执行流、1 个模块）。§9 按此清单对账。
- [graph, source-verified] `context resolveConfig --repo .` → 精确命中 `src/cli/args.ts:181-194`；incoming 调用方 5 个命令（config/repl/replay-run/report/run-generation）。结论：只读复用，不修改。
- [graph] `query experiment --repo .` → 命中 `runRepairCommand.run`、`parseExperimentRunOptions`、`buildConfigReport` 等命令侧执行流；确认进度呈现的写入侧集中在命令/实验模块，读取侧（report/replay）与写入侧已解耦，webui 只接读取侧。
- [graph] 索引新鲜度：indexed commit == HEAD `b07dbe2`；`status` 的 stale 判定源于 npx 缓存目录变化（dependencyRuntime lockfile digest 不同），analyzer artifact/build digest 完全一致，故未执行刷新、按当前图使用。

## 5. Statement-Level PDG Findings

本计划不修改任何既有函数——全部服务端逻辑为新模块（`src/web/*`），复用符号均为已源码验证的小型纯函数（§2/§3 已给出语句级行为：如 `replayEvents` 的多 run 抛错分支 `replay.ts:41-43`、`readEventLog` 的 ENOENT 分支 `events.ts:49-53`、`replayEnergyEvents` 的类型过滤 `ledger.ts:129-131`）。索引未构建 PDG 层（`analyze` 未带 `--pdg`），且本次变更没有"被修改的中心函数"，故无 PDG 切片；执行阶段若需改动既有函数，按 AGENTS.md 先跑 `impact` 再动。

## 6. Proposed Changes

### 6.1 事件日志增量读取器（新文件 `src/web/tail.ts`）

- **Responsibility:** 按字节偏移增量读取 JSONL：`tailEvents(path, afterOffset, limit)` 返回 `{events, nextOffset}`；只返回以换行完整结束的行（写方半行不产出）；`statEventsFile(path)` 返回 `{size, mtimeMs}`。
- **Constraints:** 仅 `node:fs/promises` + `node:path`；不做任何写操作；坏行跳过并计数返回（不抛错，区别于 `EventLog.readAll` 的严格语义——观察者不能因一行坏数据挂掉）。
- **Implementation notes:** 轮询 stat（默认 1.5s，`--poll-interval` 可调）驱动 SSE 推送；不使用 `fs.watch`（Docker bind mount 上不可靠，Windows/网络卷行为不一）。

### 6.2 run 发现与聚合（新文件 `src/web/run-store.ts`）

- **Responsibility:** 扫描事件日志并按 `runId` 分组（复用 `listRunIds` 语义自行实现分组，不复制 `selectRun`——其耦合 `CliError/CommandDefinition`）；`summarizeRun(runId)` = 过滤该 run 事件 → 复用 `buildRunReport`（传入 `resolveConfig` 解析的 `defaultEnergy` 作 initialEnergy）；派生状态 `running | completed | error | stalled`（`EXPERIMENT_RUN_COMPLETED`/`REPAIR_COMPLETED` → completed；`REPAIR_ERROR` → error；最后事件早于 10 分钟 → stalled）；汇总结果按 `{mtimeMs, size}` 缓存失效。
- **Constraints:** **必须先按 run 过滤再调用 `buildRunReport`/`replayEvents`**（多 run 日志会使 `replayEvents` 抛错，`replay.ts:41-43`）；能量回放降级语义照抄 `report.ts:142-169`（warning 随 API 返回）。

### 6.3 HTTP 服务（新文件 `src/web/server.ts`）

- **Responsibility:** `node:http` 零依赖服务，路由：
  - `GET /api/runs` — run 列表（runId、起止时间、事件数、状态、事件类型计数）；
  - `GET /api/runs/:runId/summary` — §6.2 汇总（JSON 同 `report --format json` 结构）；
  - `GET /api/events?run=&after=&type=&limit=` — 增量事件（返回 `nextOffset` 供轮询/续传）；
  - `GET /api/stream?run=&token=` — SSE 实时推送新事件（轮询 stat 驱动；`Last-Event-ID`/`after` 续传）；
  - `GET /api/artifacts`、`GET /api/artifacts/*` — `experiments/` 目录只读浏览（限制在根内，防路径穿越）；
  - 其余 GET — 托管 `dist/webui` 静态资源（SPA fallback 到 `index.html`）。
- **Auth（用户已定语义）:** `--token <t>` / `HARNESS_WEBUI_TOKEN` **未配置 → 完全开放**；配置后所有请求须带 `Authorization: Bearer <t>` 或 `?token=<t>`（SSE/EventSource 无法设 header，故支持 query），失败一律 404（不暴露 401 以外的信息面）→ 采用 401。`--host` 默认 `127.0.0.1`（裸机开发安全默认），容器内 compose 显式 `--host 0.0.0.0`，是否对外暴露由端口发布决定。
- **Constraints:** 仅 `node: builtins`；无写端点；请求日志打到 stdout（含来源与路径，不含 token）。

### 6.4 前端 SPA（新目录 `webui/`，Vite + React）

- **Files:** `webui/index.html`、`webui/src/main.tsx`、`webui/src/App.tsx`、`webui/src/api.ts`（fetch/SSE 封装）、`vite.config.ts`（根目录，`base: "./"`，`build.outDir: "dist/webui"`）、`tsconfig.webui.json`。
- **Views:** ① Runs 列表（状态徽标、最近事件时间）；② Run 详情：头部状态栏 → 代际进度（`GENERATION_STARTED/COMPLETED` 配对、每代耗时）→ Repair 进度（当前任务、`REPAIR_TURN` 轮数/max-turns 进度条、baseline/acceptance 结果、error 高亮）→ Agent 卡片（lifecycle/能量/代数）→ 事件流（类型过滤 + SSE 实时追加）；③ Artifacts 浏览（目录列表 + 文本文件预览）。
- **Dependencies（仅此四处新增 devDeps）:** `vite`、`@vitejs/plugin-react`、`react-dom`、`@types/react-dom`（`react` 已是 prod 依赖）。图表用轻量方案（uPlot 或纯 SVG），不引入重框架。

### 6.5 命令接入（沿用双入口模式）

- **Modify `package.json`:** `build` 扩展为 `tsc && tsc -p tsconfig.tui.json && vite build`（一次 build 同时产出 `dist/` 与 `dist/webui`，CI/Docker/release 无需各自记得跑 web 构建）；`typecheck` 追加 `tsc -p tsconfig.webui.json --noEmit`；新增 `webui": "tsx scripts/webui.ts"`；devDependencies 增 §6.4 四项。
- **New `src/cli/commands/webui.ts`:** `CliCommand`（`executeCommand` 模式），选项 `--host/--port/--token/--data-dir/--event-log/--poll-interval`（`--data-dir/--event-log` 复用 `CONFIG_OPTIONS` 语义与 `resolveConfig`）；`run()` 启动常驻服务，SIGINT/SIGTERM 优雅退出。
- **New `scripts/webui.ts`:** 独立入口（同 `scripts/report.ts`）。
- **Modify `scripts/harness.ts`:** `COMMANDS` 注册 `webuiCommand`（容器内 `docker compose run harness webui` 亦可用）。

### 6.6 容器与部署

- **Modify `Dockerfile`:** builder 阶段无需改动（`npm run build` 已含 vite；builder 装全量依赖）；runtime 阶段 `COPY --from=builder /app/dist ./dist` 已自动带上 `dist/webui`——确认无多余动作，若 npm ci --omit=dev 报 missing peer 再评估。
- **Modify `docker-compose.yml`:** 新增 `webui` service：`profiles: [web]`（默认部署零变化）、同一镜像、`command: [webui, --host, 0.0.0.0, --port, "8080"]`、`./data:/app/data:ro` 与 `./experiments:/app/experiments:ro` **只读**挂载、`ports: "${HARNESS_WEBUI_PORT:-8080}:8080"`、环境变量 `HARNESS_WEBUI_TOKEN`，安全基线照抄 harness service（init/no-new-privileges/cap_drop ALL/pids/mem）。
- **Modify `deploy.mjs`:** 新增 `--web [port]`：以 `--profile web up -d --build webui` 启动并打印访问 URL（含 token 提示）；其余行为不变。

### 6.7 CI / Release / 环境样例

- **Modify `.github/workflows/release.yml`:** 归档清单增加 `webui` 与 `vite.config.ts`、`tsconfig.webui.json`（这是 b07dbe2"归档必须含容器构建源"同一约束的延续，否则从 Release 归档容器构建会缺 webui 源）。
- **Modify `.github/workflows/ci.yml`:** `container-smoke` 增加一行 `docker compose --profile web config --quiet`；`verify` 无需改（`npm run build` 已含 web 构建）。
- **Modify `.env.example`:** 注释样例 `HARNESS_WEBUI_PORT`、`HARNESS_WEBUI_TOKEN`（含"远程暴露必须配置"说明）。

### 6.8 文档

- **New `docs/web-dashboard.md` + `docs/web-dashboard.zh-CN.md`:** 本地（`npm run webui`，免鉴权）、远程（compose profile + token、`ssh -L` 隧道、Caddy/nginx TLS 反代示例）、API 一览、安全边界（只读、无写端点）。
- **Modify `README.md` / `README.zh-CN.md`:** Available Commands 与 Container Deployment 小节各加 webui 条目。

## 7. Implementation Sequence

每步独立可交付、停在任何一步树均自洽：

1. **`src/web/tail.ts` + `test/web-tail.test.ts`** — 纯函数层，无路由。
2. **`src/web/run-store.ts` + `test/web-run-store.test.ts`** — run 分组/汇总/缓存；先用临时 JSONL 驱动。
3. **`src/web/server.ts`（API + auth + 静态托管）+ `test/web-server.test.ts`** — 端到端 HTTP 测试（临时端口 + 临时日志文件）。
4. **`src/cli/commands/webui.ts` + `scripts/webui.ts` + `scripts/harness.ts` 注册 + `package.json`（scripts/devDeps）** — CLI 可用（此步起 `npm run webui` 冒烟）。
5. **`webui/` SPA + `vite.config.ts` + `tsconfig.webui.json` + `build`/`typecheck` 扩展** — 浏览器可用的完整面板。
6. **`docker-compose.yml`（webui service）+ `deploy.mjs --web` + `.env.example`** — 部署路径打通。
7. **`Dockerfile` 核验（预计零改动）+ `release.yml` 归档清单 + `ci.yml` smoke 行** — 发布链路完整。
8. **文档四件（`docs/web-dashboard(.zh-CN).md`、双语 README 小节）**。
9. **收尾：** `detect-changes --scope all`（AGENTS.md 硬性要求）→ 分步提交。

## 8. Test Strategy

沿用 `tsx --test "test/**/*.test.ts"`（`package.json:17`）。全部为新增测试文件，既有测试零改动（既有模块行为不变）。

- **`test/web-tail.test.ts`**（新）：临时文件写入 3 事件 → tail 全量返回且 `nextOffset` 正确；再 append 2 事件 → 仅返回增量；写入半行（无换行）→ 不返回，补换行后返回；中间夹坏行 → 跳过且计数。
- **`test/web-run-store.test.ts`**（新）：多 run 混合日志 → 分组正确；`summarizeRun` 输出与 `buildRunReport` 对同 run 单独执行的结果一致（交叉验证复用）；`REPAIR_ERROR` → `error` 状态、`EXPERIMENT_RUN_COMPLETED` → `completed`、10 分钟无事件 → `stalled`；能量初始值不匹配 → 汇总带 warning 而非失败。
- **`test/web-server.test.ts`**（新，覆盖 auth）：随机端口起服务 → `GET /api/runs` 200；`/api/events?after=` 增量正确；append 后 SSE 在轮询间隔内收到帧；未配置 token → 一切开放；配置 token → 无/错 token 401、Bearer 与 `?token=` 均通过；未知路由 404；`dist/webui` 存在时 `/` 返回 index.html，缺失时返回带提示的 503；`/api/artifacts/..%2f..` 穿越被拒。
- **边界与失败路径：** 日志文件不存在（服务启动 OK、API 返回空 run 列表——观察者先于写方启动是常态）；空文件；超大 limit 截断；SSE 客户端断开停止轮询。
- **验证命令（均已存在可运行）：** `npm run typecheck`（ci.yml:53-54）、`npm run build`（ci.yml:56-57）、`npm test`（ci.yml:59-60）、`node deploy.mjs --help`（ci.yml:47-48 smoke）、`docker compose --profile web config --quiet`。

## 9. Risk and Impact Analysis

- **复用符号影响对账（§4 impact 结果）：** `buildRunReport` d=1 直接依赖仅 `reportCommand.run#2`，本计划不修改该函数，只 import——现有 report 命令行为零变化；`resolveConfig` 的 5 个命令调用方同样不受影响。风险评级 LOW 与图一致。
- **高约束正确性风险：** 多 run 日志未过滤先聚合会触发 `replayEvents` 抛错（`replay.ts:41-43`）——已作为 §6.2 硬约束 + §8 交叉验证测试。
- **性能：** JSONL 随实验增长；tail 按字节偏移不全量重读；summary 按 `{mtime,size}` 缓存；事件流分页 limit。单文件数千事件量级下无压力；数百万行再引入 SQLite/预聚合（§12 延后）。
- **安全：** 只读挂载（`:ro`）+ 无写端点 + 可选 token + `--host` 默认 127.0.0.1 + artifacts 路径穿越防护；webui 容器沿用 cap_drop ALL 等基线。token 走 query 的场景仅限 SSE，文档提示其会进访问日志、生产建议反代加 TLS。
- **兼容性：** `build` 脚本语义扩展（追加 vite）——所有既有调用方（Dockerfile:16、ci.yml:57、release.yml:41）自动获得 `dist/webui`，无破坏；compose 默认（无 profile）行为不变。
- **可观测性：** webui 进程 stdout 访问日志；面板 stalled 状态本身就是"实验进程挂了"的远程信号。

## 10. Files Expected to Change

| File | Symbols | Reason |
| ---- | ------- | ------ |
| `src/web/tail.ts` (新) | `tailEvents`, `statEventsFile` | 字节偏移增量 JSONL 读取 |
| `src/web/run-store.ts` (新) | `listRuns`, `summarizeRun` | run 分组/状态派生/汇总缓存 |
| `src/web/server.ts` (新) | `startWebUiServer` | node:http 路由、SSE、auth、静态托管 |
| `src/cli/commands/webui.ts` (新) | `webuiCommand` | CliCommand 常驻服务入口 |
| `scripts/webui.ts` (新) | — | 独立入口（双入口模式） |
| `scripts/harness.ts` | `COMMANDS` | 注册 webui 子命令 |
| `webui/*`、`vite.config.ts`、`tsconfig.webui.json` (新) | — | Vite+React SPA |
| `package.json` | `build`/`typecheck`/`webui` scripts、devDeps | web 构建/类型检查/入口 |
| `docker-compose.yml` | `webui` service | profile web、只读卷、token |
| `deploy.mjs` | `--web [port]` | 一键启动面板 |
| `Dockerfile` | （核验，预计零改动） | dist/webui 随既有 COPY 带入 |
| `.github/workflows/release.yml` | 归档清单 | 归档含 webui 源（b07dbe2 同约束） |
| `.github/workflows/ci.yml` | container-smoke | web profile 配置校验 |
| `.env.example` | — | HARNESS_WEBUI_PORT/TOKEN 样例 |
| `docs/web-dashboard.md`/`.zh-CN.md`、`README(.zh-CN).md` (新/改) | — | 使用与安全文档 |
| `test/web-tail.test.ts`、`test/web-run-store.test.ts`、`test/web-server.test.ts` (新) | — | §8 场景 |

## 11. Reusable Implementation Context

```json
{
  "task_summary": "新增只读 Web 仪表盘：零依赖 node:http API（runs/summary/events/SSE/artifacts + 静态托管 dist/webui）+ Vite/React SPA；旁路只读共享 data 卷；token 鉴权可选（未配置=开放，配置=全站 Bearer/?token=）；compose profile web + deploy.mjs --web；CI/Release 归档同步。",
  "acceptance_criteria": [
    "docker compose --profile web up -d webui 或 node deploy.mjs --web 后浏览器可看 run 列表/详情，新事件经 SSE 实时追加",
    "不改 src/experiment|energy|contracts 既有导出；web 层仅 import 纯函数",
    "未配置 token 本机直连可用；配置后无/错 token 返回 401",
    "npm run typecheck/build/test 全绿；Release 归档含 webui 源；远程部署文档（双语）齐全"
  ],
  "evidence_provenance": {
  "schema_version": 2,
  "head_commit": "b07dbe2f019ba79f23651afa1cf919e82a3e392c",
  "generated_plan_path": "docs/plans/2026-09-12-gitnexus-plan-web-dashboard-observer.md",
  "global_dirty_digest": {
    "algorithm": "sha256",
    "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
    "value": "d98f9843912a47e1462d8c06f28cec37ed6c5e75c841a7b9c43a0b6ba63cab78"
  },
  "cited_path_manifest": [
    {
      "path": ".github/workflows/ci.yml",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:fedeb45718f6c69f0f66828fce36d1e55b3f8f49f925398b279568802678b5fe",
      "index_digest": "sha256:fedeb45718f6c69f0f66828fce36d1e55b3f8f49f925398b279568802678b5fe",
      "worktree_digest": "sha256:15a2cfbc7318a770eedeaa2a4753f04b873e50b74b70154f25bd7d84bf06a4d5",
      "untracked_digest": "absent"
    },
    {
      "path": ".github/workflows/release.yml",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:15182bd485d14562687c35d4118c22ace608f5b0ab05d082bc3b32f3de11229a",
      "index_digest": "sha256:15182bd485d14562687c35d4118c22ace608f5b0ab05d082bc3b32f3de11229a",
      "worktree_digest": "sha256:15182bd485d14562687c35d4118c22ace608f5b0ab05d082bc3b32f3de11229a",
      "untracked_digest": "absent"
    },
    {
      "path": "Dockerfile",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:281884abfd20ffefec7a5259d5d7ccfb03d4c4d27a8cd452bcb5841e65a5382f",
      "index_digest": "sha256:281884abfd20ffefec7a5259d5d7ccfb03d4c4d27a8cd452bcb5841e65a5382f",
      "worktree_digest": "sha256:281884abfd20ffefec7a5259d5d7ccfb03d4c4d27a8cd452bcb5841e65a5382f",
      "untracked_digest": "absent"
    },
    {
      "path": "deploy.mjs",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:4611efb26bce9a9e8e402930e96dfe845df20617cddf1cf70f1748710d77a68c",
      "index_digest": "sha256:4611efb26bce9a9e8e402930e96dfe845df20617cddf1cf70f1748710d77a68c",
      "worktree_digest": "sha256:4611efb26bce9a9e8e402930e96dfe845df20617cddf1cf70f1748710d77a68c",
      "untracked_digest": "absent"
    },
    {
      "path": "docker-compose.yml",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:14c2b7da3fc432278e20185338a40f12e00065b102996afcc1e9b139c86bb5af",
      "index_digest": "sha256:14c2b7da3fc432278e20185338a40f12e00065b102996afcc1e9b139c86bb5af",
      "worktree_digest": "sha256:14c2b7da3fc432278e20185338a40f12e00065b102996afcc1e9b139c86bb5af",
      "untracked_digest": "absent"
    },
    {
      "path": "package.json",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:46af9de604ff9c6106b998809fa240f090ed7128ee2c1f7f3ed9c9380f345dd5",
      "index_digest": "sha256:46af9de604ff9c6106b998809fa240f090ed7128ee2c1f7f3ed9c9380f345dd5",
      "worktree_digest": "sha256:4f8240500bbb41bea046715749969c413e6a61a037657cd9882384343b0af506",
      "untracked_digest": "absent"
    },
    {
      "path": "scripts/harness.ts",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:880e1ba88a85723ff63e856fa7e1659caf7c0084fc6817b2a9c7aca1ede5a0e1",
      "index_digest": "sha256:880e1ba88a85723ff63e856fa7e1659caf7c0084fc6817b2a9c7aca1ede5a0e1",
      "worktree_digest": "sha256:c71825dee653d00520d132ac2706a62ad140b4ddeebfd628a34ff387c84adef4",
      "untracked_digest": "absent"
    },
    {
      "path": "scripts/report.ts",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:f55dc44d92116862de4ac86c9de939ea83b74d653183ab8e2076b326cf748047",
      "index_digest": "sha256:f55dc44d92116862de4ac86c9de939ea83b74d653183ab8e2076b326cf748047",
      "worktree_digest": "sha256:f55dc44d92116862de4ac86c9de939ea83b74d653183ab8e2076b326cf748047",
      "untracked_digest": "absent"
    },
    {
      "path": "src/cli/args.ts",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:52e4db9aaf93b867a44262f59da074fd0d7c243e582d88330a9bb7592b41273a",
      "index_digest": "sha256:52e4db9aaf93b867a44262f59da074fd0d7c243e582d88330a9bb7592b41273a",
      "worktree_digest": "sha256:52e4db9aaf93b867a44262f59da074fd0d7c243e582d88330a9bb7592b41273a",
      "untracked_digest": "absent"
    },
    {
      "path": "src/cli/commands/report.ts",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:87a88d683d0340d904b1438b146cd8772c9758ad09b2e790cd7ba858e56c4d5b",
      "index_digest": "sha256:87a88d683d0340d904b1438b146cd8772c9758ad09b2e790cd7ba858e56c4d5b",
      "worktree_digest": "sha256:87a88d683d0340d904b1438b146cd8772c9758ad09b2e790cd7ba858e56c4d5b",
      "untracked_digest": "absent"
    },
    {
      "path": "src/cli/commands/run-generation.ts",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:3409db79921b1dd8f80e4acdb2ae477b35baa4cb23dfbe8c4e41061b350e3fbf",
      "index_digest": "sha256:3409db79921b1dd8f80e4acdb2ae477b35baa4cb23dfbe8c4e41061b350e3fbf",
      "worktree_digest": "sha256:3409db79921b1dd8f80e4acdb2ae477b35baa4cb23dfbe8c4e41061b350e3fbf",
      "untracked_digest": "absent"
    },
    {
      "path": "src/cli/events.ts",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:04cebd7949562343fb131e1372ee385221fa4a7337e0be4df87b5a518da40f02",
      "index_digest": "sha256:04cebd7949562343fb131e1372ee385221fa4a7337e0be4df87b5a518da40f02",
      "worktree_digest": "sha256:04cebd7949562343fb131e1372ee385221fa4a7337e0be4df87b5a518da40f02",
      "untracked_digest": "absent"
    },
    {
      "path": "src/config.ts",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:760b05a79bfc12559557517f2e1d6878a642cedc40510a024090404a5cc2b89f",
      "index_digest": "sha256:760b05a79bfc12559557517f2e1d6878a642cedc40510a024090404a5cc2b89f",
      "worktree_digest": "sha256:45038e3b0f87a318cc7868792234d6755cdcf17710107d1d31bddd8688dd6195",
      "untracked_digest": "absent"
    },
    {
      "path": "src/contracts/index.ts",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:17643d8f9fef2dca20e168701901c0c379a1f17e5cc42430b6030f643961f62f",
      "index_digest": "sha256:17643d8f9fef2dca20e168701901c0c379a1f17e5cc42430b6030f643961f62f",
      "worktree_digest": "sha256:cc3b0fea57c81b0fff1a80d2f77141ad30f0924b5addb5a325c46f69a4dbc0b2",
      "untracked_digest": "absent"
    },
    {
      "path": "src/energy/ledger.ts",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:bc50234fc80fec8c4661c207222e0478a6327fedb30f86e3a8b95d1dcbb23687",
      "index_digest": "sha256:bc50234fc80fec8c4661c207222e0478a6327fedb30f86e3a8b95d1dcbb23687",
      "worktree_digest": "sha256:084e7d95e80e983ff000f879c503c9e73dcad8fee1f116ec207cd99501013d1c",
      "untracked_digest": "absent"
    },
    {
      "path": "src/experiment/event-log.ts",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:f14312c8d5aef92017e5865011fb7c0580d7927c91ca59788e5e4b9c56efc509",
      "index_digest": "sha256:f14312c8d5aef92017e5865011fb7c0580d7927c91ca59788e5e4b9c56efc509",
      "worktree_digest": "sha256:99040889d4f372a0ddd5fe04ef2a5e89614fa89cab8ee012aa5e324e16f29288",
      "untracked_digest": "absent"
    },
    {
      "path": "src/experiment/repair.ts",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:7cdb46aa9535db1705c2351616660139479520cdda388dcc8547675870a9bf8d",
      "index_digest": "sha256:7cdb46aa9535db1705c2351616660139479520cdda388dcc8547675870a9bf8d",
      "worktree_digest": "sha256:fd5b41b83501b79ae34959827b12af4096f1b0940c263b1f0ff90929dc9890ab",
      "untracked_digest": "absent"
    },
    {
      "path": "src/experiment/replay.ts",
      "object_kind": {
        "head": "regular",
        "index": "regular",
        "worktree": "regular",
        "untracked": "absent"
      },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:d5bffeaddb01acf351e9b07680a48aa39db4e5af772a70af8a89ade1825ae740",
      "index_digest": "sha256:d5bffeaddb01acf351e9b07680a48aa39db4e5af772a70af8a89ade1825ae740",
      "worktree_digest": "sha256:a69c855b5d4d7bb2dd47571300027078932d2ce01f1a2f636652bca56050e0c3",
      "untracked_digest": "absent"
    }
  ]
},
  "primary_symbols": [
    {"symbol": "buildRunReport", "file": "src/cli/commands/report.ts", "lines": "107-131", "role": "复用：run 级汇总（事件计数/生命周期/能量余额），上游 impact LOW、d=1 仅 reportCommand.run"},
    {"symbol": "resolveConfig", "file": "src/cli/args.ts", "lines": "181-194", "role": "复用：webui 的 --data-dir/--event-log/--energy 与 HARNESS_* 环境变量同源解析"}
  ],
  "related_symbols": [
    {"symbol": "replayEvents", "relationship": "IMPORTS", "relevance": "agent 生命周期回放；多 run 日志抛错（replay.ts:41-43）→ 必须先按 run 过滤"},
    {"symbol": "listRunIds", "relationship": "IMPORTS", "relevance": "run 发现语义（events.ts:61-65）"},
    {"symbol": "listAgentIds/countEventTypes", "relationship": "IMPORTS", "relevance": "经 buildRunReport 间接复用"},
    {"symbol": "readEventLog", "relationship": "IMPORTS", "relevance": "reader 语义参考：文件缺失即错（events.ts:46-59）；web 层改用 tail 增量读"},
    {"symbol": "replayEnergyEvents", "relationship": "IMPORTS", "relevance": "能量回放；降级为 warning 的包装参考 report.ts:142-169"},
    {"symbol": "EventLog", "relationship": "REFERENCE", "relevance": "JSONL 追加格式事实来源（event-log.ts:29-38）"},
    {"symbol": "selectRun", "relationship": "DISCARDED", "relevance": "耦合 CliError/CommandDefinition，web 层自行过滤，不复用"}
  ],
  "execution_path": [
    "实验命令/run-repair 写 JSONL（data/runs/events.jsonl）→ webui 容器只读挂载同卷",
    "tail.ts 按 afterOffset 增量读 → run-store 按 runId 分组/派生状态 → buildRunReport 汇总",
    "server.ts 暴露 REST + SSE（stat 轮询驱动推送）→ React SPA 拉列表/详情并订阅流"
  ],
  "pdg_constraints": [],
  "architectural_patterns": [
    {"pattern": "双入口命令（harness 子命令 + scripts/*.ts 独立入口）", "example_location": "scripts/harness.ts:32-45 与 scripts/report.ts", "usage_guidance": "webui 照此接入"},
    {"pattern": "append-only JSONL 事件溯源 + 纯函数回放/聚合", "example_location": "src/experiment/event-log.ts:29-38、src/cli/commands/report.ts:107-131", "usage_guidance": "web 层只读消费，不触碰写路径"},
    {"pattern": "容器安全基线（init/no-new-privileges/cap_drop ALL/pids/mem）", "example_location": "docker-compose.yml:26-32", "usage_guidance": "webui service 原样沿用，卷加 :ro"},
    {"pattern": "compose profile 隔离可选服务", "example_location": "docker-compose.yml 新增 webui（profiles: [web]）", "usage_guidance": "默认部署零变化"}
  ],
  "files_to_modify": [
    {"file": "src/web/tail.ts", "symbols": ["tailEvents", "statEventsFile"], "intended_change": "新增"},
    {"file": "src/web/run-store.ts", "symbols": ["listRuns", "summarizeRun"], "intended_change": "新增"},
    {"file": "src/web/server.ts", "symbols": ["startWebUiServer"], "intended_change": "新增"},
    {"file": "src/cli/commands/webui.ts", "symbols": ["webuiCommand"], "intended_change": "新增"},
    {"file": "scripts/webui.ts", "symbols": [], "intended_change": "新增独立入口"},
    {"file": "scripts/harness.ts", "symbols": ["COMMANDS"], "intended_change": "注册 webuiCommand"},
    {"file": "package.json", "symbols": ["build", "typecheck", "webui"], "intended_change": "脚本扩展 + devDeps(vite/@vitejs/plugin-react/react-dom/@types/react-dom)"},
    {"file": "webui/", "symbols": [], "intended_change": "新增 SPA（index.html/src/*、vite.config.ts、tsconfig.webui.json）"},
    {"file": "docker-compose.yml", "symbols": ["webui"], "intended_change": "新增 profile web 只读服务"},
    {"file": "deploy.mjs", "symbols": [], "intended_change": "新增 --web [port]"},
    {"file": ".github/workflows/release.yml", "symbols": [], "intended_change": "归档清单加 webui、vite.config.ts、tsconfig.webui.json"},
    {"file": ".github/workflows/ci.yml", "symbols": [], "intended_change": "container-smoke 加 --profile web config 校验"},
    {"file": ".env.example", "symbols": [], "intended_change": "HARNESS_WEBUI_PORT/TOKEN 样例"},
    {"file": "docs/web-dashboard.md + .zh-CN.md + README(.zh-CN).md", "symbols": [], "intended_change": "新增/增补"}
  ],
  "tests": [
    {"file": "test/web-tail.test.ts", "scenarios": ["3 事件全量 tail + nextOffset 正确", "append 后仅增量", "半行不返回、补换行后返回", "坏行跳过并计数"]},
    {"file": "test/web-run-store.test.ts", "scenarios": ["多 run 分组", "summarizeRun 与 buildRunReport 单 run 结果一致", "completed/error/stalled 状态派生", "能量初值不匹配降级为 warning"]},
    {"file": "test/web-server.test.ts", "scenarios": ["/api/runs 200", "/api/events?after 增量", "SSE 收到 append 帧", "token 未配置=开放/配置=401+Bearer+?token", "未知路由 404", "dist/webui 缺失 503 带提示", "artifacts 路径穿越被拒", "日志文件缺失=空列表不崩"]}
  ],
  "verification_commands": ["npm run typecheck", "npm run build", "npm test", "node deploy.mjs --help", "docker compose --profile web config --quiet"],
  "risks": [
    "多 run 日志先过滤再聚合（replayEvents 抛错约束）",
    "fs.watch 在 bind mount 不可靠 → stat 轮询",
    "build 脚本语义扩展影响 Dockerfile/ci/release 三处调用方（自动获益，需回归一次）",
    "release 归档缺 webui 源会使 Release 归档容器构建失败（b07dbe2 同类问题）"
  ],
  "assumptions": [
    {"what": "web 构建并入根 package.json（不建 webui/package.json 子包）", "how": "执行时确认 npm ci --omit=dev 在 runtime 阶段不含 vite 仍可启动 dist/webui 静态服务；否则再评估拆包"},
    {"what": "同一 runtime 镜像承载 webui（无新 Dockerfile stage）", "how": "构建后检查 dist/webui 已随 COPY --from=builder /app/dist 进入镜像"},
    {"what": "面板只读即可满足'查看进度'", "how": "若用户后续要求页面发起实验，走新的写路径计划"}
  ],
  "open_questions": [
    "远程 TLS 由用户选择 Caddy/nginx/网关，文档给示例不落地实现",
    "企业代理缓冲 SSE 时的前端降级轮询间隔取值",
    "超长日志（百万行级）的预聚合/SQLite 化时机"
  ],
  "avoid": [
    "Do not repeat full repository discovery",
    "Do not replace established patterns without evidence",
    "不得修改 src/experiment/*、src/energy/*、src/contracts/* 的既有导出——web 层只 import",
    "不得在按 run 过滤之前调用 buildRunReport/replayEvents（多 run 日志抛错）",
    "不得把 selectRun/CliError 带进 web 层（CLI 专用错误类型）",
    "服务端不得引入 node: builtins 之外的新运行时依赖；新增依赖仅限 §6.4 四项 devDeps",
    "webui 容器卷一律只读（:ro），不得出现写端点",
    "编辑任何既有符号前必须按 AGENTS.md 跑 impact；提交前必须跑 detect-changes --scope all"
  ]
}
```

## 12. Assumptions and Open Questions

**假设（执行前廉价复核）：**

- [assumed] vite 仅进 devDependencies，`npm run build` 在 builder 阶段产出 `dist/webui`，runtime 阶段 `npm ci --omit=dev` 不需要 vite——执行时以容器构建验证，失败再评估拆独立 `webui/package.json`。
- [assumed] 同一 `runtime` 镜像承载 webui（无独立 stage/镜像）——静态资源随 `dist/` 进入，无镜像膨胀；若后续要最小化 attack surface 再加独立 target。
- [assumed] token 是唯一鉴权形态（单操作者场景），不做多用户/会话管理。

**开放问题：**

- 远程暴露的 TLS 终结点（Caddy/nginx/云网关）由部署者选择，本期仅文档化（含 `ssh -L 8080:localhost:8080` 零配置替代）。
- SSE 经企业代理可能被缓冲——前端保留降级轮询，间隔取值实测后定。
- 超长 JSONL（百万行级）的预聚合或 SQLite 化，当前量级不需要，显式延后。

**显式延后的相邻工作（本次不做）：**

- 从页面发起/停止实验（写路径 + 队列 + 并发控制）——等只读面板落地后单独立项。
- 多实验对比视图、历史趋势库。
- `EXPERIMENT_RUN_COMPLETED` 之外的 run 生命周期事件丰富化（属 harness 核心演进）。

## 13. Definition of Done

- [ ] `npm run typecheck && npm run build && npm test` 全绿，含三个新测试文件的全部场景。
- [ ] 本地 `npm run webui`（免 token）打开面板：mock 或真实 run 的列表/详情/事件流可用；运行中实验新事件经 SSE 实时出现。
- [ ] 配置 token 后无/错 token 请求 401，Bearer 与 `?token=` 均通过；`--host` 默认 127.0.0.1。
- [ ] `node deploy.mjs --web` 一键启动面板；`docker compose` 无 profile 时默认部署行为与改动前一致。
- [ ] Release 归档含 `webui/`、`vite.config.ts`、`tsconfig.webui.json`；从归档可完成容器构建（含 dist/webui）。
- [ ] 双语 `docs/web-dashboard(.zh-CN).md` 与 README 小节交付，覆盖本地/远程/token/隧道/反代。
- [ ] 提交前 `node .gitnexus/run.cjs detect-changes --scope all --repo .` 无未映射变更；编辑既有符号前有 impact 记录。
