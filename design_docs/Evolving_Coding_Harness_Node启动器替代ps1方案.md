# Evolving Coding Harness — Node 启动器替代 .ps1 部署方案

> 日期：2026-09-10　分支：`codex/node-deploy-launcher`（基于 main @ 03ecf75）
> 状态：已评审通过，实施中

## 1. 背景与问题

v0.1.3 起随「一键容器部署」发布了 `deploy.ps1` / `deploy.sh` 两个原生启动脚本。
Windows 用户按文档执行 `.\deploy.ps1` 时，会被 PowerShell 执行策略拦截
（默认 `Restricted` 策略直接拒绝运行 .ps1，报 "running scripts is disabled on
this system"），一键启动在 Windows 上不可用。

关键事实：`docker.exe`、`node.exe` 是原生可执行文件，**不受** PowerShell
执行策略限制；被拦截的只有 `.ps1` 脚本本身（以及受限策略下 npm/npx 的
`.ps1` shim）。

## 2. 目标

- 淘汰 `.ps1` 启动方案；不再维护 `deploy.ps1` 与 `deploy.sh` 两份平行脚本。
- 统一为**单一跨平台 Node 启动器 `deploy.mjs`**：`node deploy.mjs` 在
  cmd / PowerShell / Git Bash / Linux / macOS 全部可用。
- 顺带给 `package.json` 增加 `bin`，发布包用户可用 `npx harness` 直启 CLI
  （替代裸敲 `node dist/scripts/harness.js`）。
- 保留 `docker compose` 直用路径（"launcher is optional" 叙事不变）。

## 3. 方案选型（已评审）

| 备选 | 结论 |
| --- | --- |
| 单一 Node 启动器（**选定**） | 保留一键体验与全部参数糖；`node.exe` 原生不受执行策略限制；三平台一份脚本。代价：主机需 Node（非 Docker 路径本就必需） |
| 纯 Compose 无脚本 | 零维护代码，但失去 `--release` 等参数糖；PowerShell 临时改 provider 需 `$env:` 语法 |
| 仅删 ps1 保留 sh | Windows 原生用户仍无一键入口；继续双脚本维护 |

## 4. 改动清单

### 4.1 新增 `deploy.mjs`（仓库根目录，与 docker-compose.yml 同级）

仅用 `node:` 内置模块，无新依赖：

- **参数**：`--release [tag]`（tag 可省略：下一个参数以 `--` 开头则不算值，
  手写解析循环复刻该语义）、`--image <image>`、`--python`、
  `--provider <kind>`、`--goal <text>`、`--no-build`、`-h/--help`。
  `--help` 不触发 Docker 预检（便于 CI 冒烟）。
- **Docker 预检**：`spawnSync` 依次检查 docker 在 PATH、daemon 运行、
  compose 可用；失败给友好提示。
- **目录**：`fs.mkdirSync(recursive)` 创建 `data/`、`experiments/`。
- **环境变量**：不污染父 shell —— 继承 `process.env` 后覆盖
  `HARNESS_BUILD_TARGET`（runtime / runtime-python）、`HARNESS_PROVIDER`、
  `HARNESS_GOAL`、`HARNESS_IMAGE`，经 spawn 的 env 传给 compose；
  compose 原生读 `.env` 的行为不变。
- **release 模式**：镜像解析顺序与原脚本一致：`--image` 参数 →
  `HARNESS_IMAGE` env → `docker compose config --images` 取非默认值 →
  默认 `ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game[-python]:<tag|latest>`；
  先 `pull harness` 再 `run`。
- **路径锚定**：`import.meta.dirname`（engines node>=24）定位脚本目录，
  `--project-directory` 与 `-f` 始终指向它（等价原 `$RootDir` / `BASH_SOURCE`）。
- **子进程**：`shell: false` + 参数数组（规避空格/引号问题）；run 阶段
  `stdio: 'inherit'` 保住 TTY（REPL 必需）；退出码透传 `process.exitCode`。

### 4.2 删除 `deploy.ps1`、`deploy.sh`

### 4.3 `package.json`

- `scripts` 增加 `"deploy": "node deploy.mjs"`。文档主推 `node deploy.mjs`：
  受限执行策略下 PowerShell 里连 `npm` 本身都会撞 `npm.ps1` 拦截。
- 新增 `"bin": { "harness": "dist/scripts/harness.js" }`。

### 4.4 `scripts/harness.ts` 顶部加 shebang

`#!/usr/bin/env node` 必须是文件第一行（位于现有 license 注释之前）；
tsc 会原样保留到 dist 产物。npm 的 bin shim 以 `node <file>` 调用，无需
chmod；`private: true` 不影响 `npm ci` 生成本地 bin。

### 4.5 `.github/workflows/release.yml`（归档清单）

`deploy.sh`、`deploy.ps1` → `deploy.mjs`。

### 4.6 `.env.example`（第 8 行注释）

"deploy.sh or deploy.ps1" → "deploy.mjs"。

### 4.7 文档（4 个文件）

- `README.md`（Container Deployment 段 + release 用法 PowerShell 片段）：
  `.\deploy.ps1` → `node deploy.mjs`，说明 cmd / PowerShell / Git Bash 通用、
  不受执行策略限制，`npm run deploy` 为别名；release 示例同步替换。
- `README.zh-CN.md`：对应中文段。
- `docs/container-deployment.md` / `docs/container-deployment.zh-CN.md`：
  「一键启动」段全量替换；保留并强化 "launcher is optional" —— 无 Node 时
  直接 `docker compose run --rm --build harness` + `.env`。
- `docs/plans/2026-09-08-gitnexus-plan-one-command-deployment.md` 为历史文档，
  不修改。

### 4.8 `.github/workflows/ci.yml`（轻量冒烟）

加一步 `node deploy.mjs --help`（不依赖 docker），防启动器回归。

## 5. 流程合规（AGENTS.md）

- 编辑前：`node .gitnexus/run.cjs impact` 预检受影响符号；结果 UNKNOWN 时
  以文本搜索确认无调用方并如实报告。
- 提交前：`node .gitnexus/run.cjs detect-changes --scope all --repo .`，
  非 0 / truncated 则修复后重跑。

## 6. 验证

1. `node deploy.mjs --help`；未知参数报错；`npm run deploy -- --help`。
2. 本机 Docker 可用时：`node deploy.mjs --provider mock` 真实 REPL 冒烟。
3. `npm pack` 出 tarball，临时目录安装后 `npx harness --help` 验证 bin。
4. `npm run typecheck && npm run build && npm test` 全绿。

## 7. 提交粒度

1. `feat: replace shell deploy launchers with cross-platform node launcher`
   （deploy.mjs、删两脚本、package.json scripts、release.yml、.env.example、ci.yml）
2. `feat: add harness bin entry`（bin 字段 + shebang）
3. `docs: update deployment docs for node launcher`（4 个文档）

## 8. 不做的事

- 不改 `src/` 下任何代码；不动 `docker-compose.yml` / `Dockerfile`；
- 不修改历史方案文档；
- 不打版本 tag、不触发发版（发版时机另行决定）。
