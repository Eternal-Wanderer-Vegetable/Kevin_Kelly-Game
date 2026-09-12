# Web 仪表盘

仪表盘是实验进度的**只读**浏览器视图。它以旁路服务的形式与 harness 并存，
通过共享的 `data/` 卷监视 append-only 的 JSONL 事件日志，绝不触碰实验数据：
所有挂载均为只读，任何接口都不执行写操作。

- **Runs 列表**：派生状态 `running`（进行中）、`completed`（已完成）、
  `error`（出错）、`stalled`（静默超过 10 分钟）。
- **Run 详情**：代际进度（`GENERATION_STARTED`/`COMPLETED` 配对）、repair
  进度（轮数对照 `maxTurns`、baseline/acceptance 结果）、agent 卡片
  （生命周期、能量），以及通过 Server-Sent Events 实时推送的事件流。
- **Artifacts**：浏览 `experiments/` 目录（候选源码、报告、校验和）。

## 本地快速开始

```bash
npm run build
npm run webui
# 打开 http://127.0.0.1:8080
```

不带 `--token` 时服务器**完全开放**；默认绑定 `127.0.0.1`，仅供本机或 SSH
隧道使用。可用 `--host`、`--port`、`--event-log`、`--data-dir`、
`--poll-interval` 调整；完整清单见 `harness webui --help`。

## 远程服务器

```bash
node deploy.mjs --web          # 构建 + 启动仪表盘服务（端口 8080）
node deploy.mjs --web 9000     # 自定义端口
```

等价于：

```bash
docker compose --profile web up -d --build webui
```

`webui` 服务以**只读**方式挂载 `./data` 与 `./experiments`，对外发布
`HARNESS_WEBUI_PORT`（默认 8080）。

### 鉴权

| 场景 | 要求 |
| ---- | ---- |
| 本机浏览器；`ssh -L 8080:localhost:8080 user@server` 隧道 | 无需 token |
| 受信内网发布的端口 | 建议 token |
| 公网 | **必须** token |

对外暴露端口前，在 `.env`（或 shell）中设置 token：

```bash
HARNESS_WEBUI_TOKEN=$(openssl rand -hex 16)
```

配置 token 后，所有请求必须携带 `Authorization: Bearer <token>` 或
`?token=<token>`；SPA 会自动从自身 URL 继承 token，因此可以收藏
`http://server:8080/?token=<token>`。

TLS 交给现有反向代理（Caddy/nginx）终结，并保持 token 开启。SSE 接口已发送
`X-Accel-Buffering: no`；若代理仍缓冲 SSE，页面会自动退回轮询 run 汇总。

## HTTP API

| 路由 | 用途 |
| ---- | ---- |
| `GET /api/runs` | run 列表（派生状态 + 事件类型计数） |
| `GET /api/runs/:runId/summary` | 与 `npm run report -- --format json` 相同的汇总，外加 `status` |
| `GET /api/events?after=&run=&type=&limit=` | 增量事件（`after` 为字节偏移） |
| `GET /api/stream?run=&after=` | SSE 事件批；断线后经 `Last-Event-ID` 续传 |
| `GET /api/artifacts`、`GET /api/artifacts/:path` | 只读产物列表与文本预览 |
| 其余路径 | `dist/webui` 构建产物（SPA） |

## 工作原理

实验进程把 `ExperimentEvent` 记录追加到 `data/runs/events.jsonl`
（`HARNESS_EVENT_LOG`）。仪表盘按字节偏移增量追踪该文件，按 `runId` 分组，
并复用 `report` 命令同一套纯函数（`buildRunReport`、`replayEvents`、
`replayEnergyEvents`）。服务端是纯 `node:http`——零新增运行时依赖；前端是
Vite + React 应用，构建到 `dist/webui`。

## 安全

- 只读 bind mount（`:ro`），无写端点。
- 容器沿用 harness 安全基线：`cap_drop: ALL`、`no-new-privileges`、
  `pids_limit`、`mem_limit`。
- 单行坏事件会被跳过并计数——视图可能缺一行，仪表盘本身不会崩。
