# GitNexus Engineering Plan

> Task: 将现有 Coding Agent CLI 的容器部署收敛为跨平台的一键启动流程。
> Evidence verified at commit `2ebad228b8d61e0f39297547e06372c6ef7f193c`; GitNexus index is 1 commit behind HEAD (`e54807d`), refresh skipped because the local runner failed during dependency installation on Windows (`cmd.exe ENOENT`), so graph claims are navigation evidence only and current source is authoritative.
> Evidence provenance schema 2; global dirty digest `0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd`; cited-path manifest 19 sorted entries; exact generated plan path excluded.

## 1. Objective

[verified] 让用户在已安装 Docker Compose 的前提下，用一条命令启动可交互的 Harness REPL；默认可无密钥完成 mock 冒烟，配置真实 local/external provider 时只需准备 `.env`，不再手动创建目录、选择 build target、pull/build 镜像和拼接 `docker compose run` 参数。

[inferred] 第一阶段的“一键部署”范围是“从源码 checkout 或 Release 归档启动”；从零环境通过 `curl | sh` 下载安装器属于后续增强，不纳入本次最小改造。

验收标准：

- Linux/macOS 可执行 `./deploy.sh` 启动 mock REPL；Windows PowerShell 可执行 `./deploy.ps1` 完成同等流程。
- 首次运行自动确保 `data/`、`experiments/` 存在，并通过 `docker compose config` 发现配置错误。
- 默认本地模式构建当前 checkout；显式 `--release` 时拉取指定或默认稳定镜像，不重复本地构建。
- `--python` 可选择 `runtime-python`；provider、goal、image、release tag 可通过参数或 `.env` 覆盖。
- 保留现有 `harness` 子命令、环境变量、数据卷、安全约束和无 TTY 文本回退。

## 2. Current Behaviour

[verified] 源码开发路径要求 `npm install`、`npm run typecheck`、`npm run build`，再通过 `npm run harness -- repl` 启动 CLI（`README.zh-CN.md:49-80`, `package.json:9-18`）。

[verified] 本地容器路径需要先手动 `docker build`，Compose 再手动 `run --rm -it harness repl ...`；文档明确 `docker compose up` 运行的是默认根命令帮助并退出，而不是长期 daemon（`docs/container-deployment.zh-CN.md:21-36`）。

[verified] Release 使用路径还需要下载/解压归档并执行 `npm ci --omit=dev`，或手动设置 `HARNESS_IMAGE`、创建卷目录、`docker compose pull`，最后拼接 REPL 命令（`README.zh-CN.md:107-145`, `README.zh-CN.md:162-215`）。

[verified] Dockerfile 已提供 `builder`、`runtime`、`runtime-python` 三个 target，runtime 以非 root `node` 用户运行 `dist/scripts/harness.js`（`Dockerfile:3-42`）。Compose 已具备数据卷、模型地址、TTY、tmpfs、capability drop、进程数和内存限制（`docker-compose.yml:1-34`）。

[verified] `replCommand.run` 已支持 `mock|local|external`、`.env`/环境变量解析、TTY Ink 与无 TTY 文本回退；因此部署简化不需要重新设计 CLI 运行时（`src/cli/commands/repl.ts:72-130`）。

## 3. Relevant Architecture

[verified] 部署边界由 Dockerfile、Compose、Release workflow 和中英文部署文档组成；运行边界由 `scripts/harness.ts` 分发到 `src/cli/commands/*`，Provider 配置经 `resolveConfig` 进入 `loadConfig`，Provider key 由 `createProviderFromConfig` 单独读取，不进入 `HarnessConfig`（`scripts/harness.ts:22-84`, `src/cli/args.ts:181-194`, `src/config.ts:40-122`, `src/providers/openai-compatible.ts:222-252`）。

[inferred] 最小风险的部署方案应停留在 Docker/脚本/文档/CI 边界，不把首次一键化变成新的 TypeScript 命令，也不改变现有配置模型；这样可以复用已验证的 REPL 和 provider 行为。

[verified] `docker-compose.yml` 当前同时包含 `build` 与可替换 `image`，因此可以用同一编排文件支持“当前源码构建”和“已发布镜像拉取”两种模式；启动脚本只需选择 build/pull 策略。

## 4. GitNexus Findings

- [graph, source-verified] `query({search_query: "CLI entrypoint startup configuration environment variables Docker container deployment"})` 命中 `replCommand`、`resolveConfig`、`configCommand`、`docs/container-deployment.md` 和 `scripts/harness.ts`，说明部署链路横跨 Commands、CLI、Provider 与容器文档。
- [graph, source-verified] `context({name: "resolveConfig", file_path: "src/cli/args.ts"})` 显示直接调用方为 `configCommand`、`replCommand`、`replayRunCommand`、`reportCommand`、`runGenerationCommand` 共 5 个命令。
- [graph, source-verified] `impact({target: "resolveConfig", direction: "upstream", maxDepth: 3, summaryOnly: true})` 返回 `risk: CRITICAL`、d=1 为 5、影响 8 条执行流、5 个模块；`loadConfig` 的 impact 也返回 `risk: CRITICAL`、4 个直接调用方、8 条执行流、4 个模块。
- [graph, source-verified] `context({name: "executeCommand", file_path: "src/cli/command.ts"})` 显示五个 standalone script 与 `scripts/harness.ts` 共用统一执行/错误处理入口；部署脚本应调用现有容器 CLI，不复制 CLI 分发逻辑。
- [graph, source-verified] `impact` 对 `replCommand` 和 `configCommand` 返回 `risk: UNKNOWN` 且无解析调用方；AGENTS.md 规定 UNKNOWN 不能视为安全，源码搜索已确认两者由 `scripts/harness.ts` 直接注册，故本计划不把该空结果当作无影响证据。
- [graph] 索引比 HEAD 落后 1 个 commit；落后提交只新增 README 文档，未发现当前实现文件的索引/源码冲突，但执行阶段应在编辑前重新分析或至少复核图新鲜度。

## 5. Statement-Level PDG Findings

- [graph, source-verified] `pdg_query({mode: "controls", target: "loadConfig"})` 返回 7 条控制边：能量非负校验在 `src/config.ts:99-100`，local URL HTTP 校验在 `src/config.ts:106-107`，external URL 校验在 `src/config.ts:109-110`；这些 guard 失败会提前抛错。
- [graph, source-verified] `pdg_query({mode: "flows", target: "configInputFromEnvironment", variable: "dataDirectory"})` 显示环境变量读取结果从 `src/config.ts:71` 流入返回对象 `src/config.ts:77`。
- [inferred] 部署脚本应只设置环境变量和 Compose 参数，不绕过 `resolveConfig`/`loadConfig` 校验；否则错误会从 operator-facing `CliError` 退化为不可诊断的容器启动问题。
- [verified] 当前配置默认数据目录为 `<cwd>/data`，容器 Compose 显式改为 `/app/data`，事件日志为 `/app/data/runs/events.jsonl`；脚本创建宿主目录而不是改写运行时路径（`src/config.ts:88-122`, `docker-compose.yml:10-22`）。

## 6. Proposed Changes

### 6.1 新增统一启动脚本

- **Files:** `deploy.sh`, `deploy.ps1`。
- **Responsibility:** 封装 Docker/Compose preflight、目录初始化、Compose 配置校验、local build 或 release pull、REPL 参数拼接。
- **Behaviour:** 默认 `runtime + mock + current checkout build`；支持 `--release [tag]`、`--python`、`--provider`、`--goal`、`--image`、`--no-build`/等价的显式模式；将未知参数和 Docker 缺失转成带修复提示的错误。
- **Constraints:** 不写密钥、不修改 `src/config.ts`、不在脚本中复制 provider URL 规则；优先读取 `.env`，保留 Compose 对现有 `HARNESS_*` 变量的处理。
- **Implementation note:** 两个脚本共享同一参数语义；`deploy.sh` 使用 `docker compose run --rm --build -it harness repl ...`，Release 模式先 `docker compose pull harness` 再 `run`，避免发布镜像被本地重建。

### 6.2 固化 Compose 的默认启动契约

- **File:** `docker-compose.yml`。
- **Symbols:** `harness` service definition。
- **Responsibility:** 让无额外命令的 `docker compose run --rm -it harness` 直接进入 REPL，同时保留显式命令覆盖能力。
- **Behaviour:** 增加可由环境变量覆盖的默认 provider/goal 或等价的默认 `repl` command；保留 `build.target`、`image`、卷、TTY、安全限制和 host model 地址。
- **Constraints:** 不把 Compose 改成 daemon；不删除 `docker compose run harness --help/config/run-task/...` 的现有用法；不默认注入真实模型密钥。

### 6.3 提供非敏感配置模板

- **File:** `.env.example`。
- **Responsibility:** 展示 provider、image/release tag、model URL/name、energy 等可选配置，明确密钥只由本地 `.env` 或 shell 注入。
- **Behaviour:** mock 模式开箱可用；local/external 模式通过复制模板并填写对应变量启用。
- **Constraints:** 模板不得包含真实 secret；Compose 对空字符串仍按当前 `readEnvironmentValue` 语义处理。

### 6.4 对齐 Release 产物与文档

- **Files:** `.github/workflows/release.yml`、`README.md`、`README.zh-CN.md`、`docs/container-deployment.md`、`docs/container-deployment.zh-CN.md`。
- **Responsibility:** 将一键脚本和 `.env.example` 纳入 Release archive，并把“一条命令启动”放到部署文档首屏；手工 build/pull/run 降为高级排障路径。
- **Behaviour:** 同时给出 checkout/archive 的 local build 入口和 `--release` 入口；明确默认 mock 仅用于冒烟，真实模型需要 endpoint/key；保留安全边界、Python allowlist、数据卷和无 TTY 说明。
- **Constraints:** 不承诺 Compose service 是长期 daemon；不把 `curl | sh` 作为本期默认安装方式。

### 6.5 增加容器级验收

- **Files:** `.github/workflows/ci.yml`，可选新增 `test/deployment.test.ts` 仅做脚本参数/配置契约测试。
- **Responsibility:** 在 CI 验证一键路径实际可运行，而不是只验证 TypeScript。
- **Behaviour:** 构建 `runtime`，执行 `docker compose config`、`harness --help`、`harness config` 和无 TTY 的 `repl --provider mock`；另验证 `runtime-python` 至少能启动并报告版本/帮助。
- **Constraints:** 不在 CI 中调用真实模型、不上传 secret、不依赖宿主个人目录；若 Docker 在某类 runner 不可用，明确把该 job 标为容器验证而不是静默跳过。

## 7. Implementation Sequence

1. **重新锚定图与工作区。** 执行 `node .gitnexus/run.cjs analyze --index-only` 或可用 runner；若 Windows runner 仍失败，记录失败并对所有共享符号重新做 MCP impact。编辑前重点复核 `resolveConfig`/`loadConfig` 的 CRITICAL 风险。
2. **确定参数契约。** 写出 bash/PowerShell 的同构选项和退出码：默认 local build、显式 release pull、runtime-python、provider、goal、image/tag；禁止隐式把本地模型 key 写入文件。
3. **实现脚本 preflight。** 先检查 Docker daemon 与 Compose 版本，再创建 `data`/`experiments`，执行 `docker compose config --quiet`；失败时不启动容器。
4. **实现 local/release 两条执行分支。** local 分支使用当前 checkout 的 `runtime`/`runtime-python` build；release 分支设置镜像变量、pull 指定 tag，再通过同一 Compose service 运行 REPL。
5. **固化 Compose 默认 command。** 让脚本和裸 `docker compose run --rm -it harness` 共享一个默认 REPL 契约；逐项回归现有显式命令和安全配置。
6. **接入 `.env.example` 与 Release archive。** 更新发布 workflow 的复制清单，确保归档解压后可以直接使用部署脚本。
7. **更新中英文文档。** 首屏只保留一条推荐命令，随后给出 real provider 配置、Python 变体和高级手工命令；说明 `docker compose up` 仍不是 daemon 部署。
8. **加入容器 CI smoke。** 完成 build、config、help、mock REPL 无 TTY、Python target 验收；本地运行同一组命令。
9. **编辑完成后运行 GitNexus `detect_changes({scope: "all"})`。** 若 `partial` 或 `truncated`，按 AGENTS.md 要求重跑并检查受影响流程；重点审阅 Commands、Cli、Tui、Experiment 模块。

## 8. Test Strategy

- **Existing regression:** `npm run typecheck`、`npm run build`、`npm test`；现有 `test/cli.test.ts` 继续验证 standalone entrypoint 与 root dispatch，`test/config-env.test.ts` 继续验证环境变量和 URL/energy 校验。
- **Compose validation:** `docker compose config --quiet`；确保缺失/非法环境变量不会生成静默错误配置。
- **Local container:** `docker compose run --rm --build harness --help`、`config`、`repl --provider mock --goal "smoke" < /dev/null`；预期分别返回 0、脱敏配置、无 TTY 文本回退并正常退出。
- **Release container:** 设置 `HARNESS_IMAGE` 后执行 `docker compose pull` 与同样 smoke；确认 release 分支不触发本地 build。
- **Script scenarios:** 空目录首次启动；已存在数据目录；Docker 不可用；Compose 配置错误；`--python`；local provider 缺 URL/key；external provider 缺 URL；goal 含空格；未知选项；中断后无残留长期服务。
- **Data persistence:** mock REPL/实验结束后，宿主 `data/` 与 `experiments/` 可写，事件日志路径仍为 Compose 约定的 `/app/data/runs/events.jsonl`。
- **Security regression:** 容器仍以 `node` 用户运行，保留 `no-new-privileges`、`cap_drop: ALL`、`pids_limit`、`mem_limit`、tmpfs；脚本不引入 Docker socket、`--privileged` 或敏感宿主挂载。
- **Recommended command set:** `npm run typecheck`; `npm run build`; `npm test`; `docker compose config --quiet`; `docker compose build harness`; `docker compose run --rm harness --help`; `docker compose run --rm harness config`; `docker compose run --rm harness repl --provider mock --goal smoke < /dev/null`。

## 9. Risk and Impact Analysis

- [graph] `resolveConfig` / `loadConfig` 为 CRITICAL 共享入口，直接波及 `repl`、`config`、`run-generation`、`replay-run`、`report` 及 TUI/文本回退流程；本方案明确不修改它们。
- [graph] `replCommand`/`configCommand` 的 upstream 结果为 UNKNOWN，不应解读为无调用；源码确认 root dispatcher 注册了它们，部署脚本通过容器 CLI 间接调用。
- [inferred] Compose 默认 command 变化可能影响用户把 `docker compose up` 当作帮助命令的习惯；文档和测试必须把“run 启动交互 REPL、显式 command 覆盖默认值”写清楚。
- [inferred] Release 镜像与当前 checkout 可能版本不一致；`--release` 必须显式选择，默认 local 模式不得自动拉远程 `latest`。
- [inferred] `.env` 中的 key 会通过 Compose 环境传入容器；脚本和文档不能打印 key，`config` 只能显示 set/unset，沿用 `buildConfigReport` 约束。
- [inferred] `runtime-python` 只提供解释器，`TaskSpec.allowedCommands` 仍是硬边界；一键脚本只能选择镜像 target，不能承诺 Python 任务自动获准执行。
- [inferred] Docker daemon、Compose、TTY、跨平台 shell 行为是主要兼容风险；必须同时验证 bash、PowerShell、TTY 和 no-TTY。
- [deferred] 子进程树清理、生产级 daemon/service 管理、远程零安装 bootstrap、Web UI 和 secrets manager 不纳入本次范围。

## 10. Files Expected to Change

| File | Symbols | Reason |
| ---- | ------- | ------ |
| `deploy.sh` | new script | Linux/macOS one-command local/release launcher |
| `deploy.ps1` | new script | Windows PowerShell equivalent |
| `.env.example` | new config template | Non-sensitive provider/image defaults |
| `docker-compose.yml` | `harness` service | Default REPL command and env contract |
| `.github/workflows/ci.yml` | CI jobs | Container smoke verification |
| `.github/workflows/release.yml` | archive copy list | Ship deployment scripts/template |
| `README.md` / `README.zh-CN.md` | deployment sections | Promote recommended command |
| `docs/container-deployment.md` / `.zh-CN.md` | deployment guide | Detailed modes, troubleshooting, security |
| `test/cli.test.ts` | root/entrypoint regression | Preserve CLI dispatch contract if command defaults change |
| `test/config-env.test.ts` | config regression | Preserve environment precedence/validation |
| `test/deployment.test.ts` | new, optional | Script argument/config contract if implementation extracts testable helpers |

## 11. Reusable Implementation Context

```yaml
implementation_context:
  task_summary: "Provide a cross-platform one-command Docker deployment for the existing CLI, preserving the current runtime/config/security contracts."
  acceptance_criteria:
    - "./deploy.sh and deploy.ps1 start a mock REPL with one command after Docker Compose is available."
    - "Local mode builds the current checkout; release mode pulls an explicit or default stable image."
    - "data and experiments are initialized automatically and remain writable through bind mounts."
    - "Existing CLI commands, environment variables, provider selection, and security constraints remain compatible."
    - "Container smoke tests cover help, config, mock REPL no-TTY, and runtime-python."
  evidence_provenance:
    schema_version: 2
    head_commit: "2ebad228b8d61e0f39297547e06372c6ef7f193c"
    generated_plan_path: "docs/plans/2026-09-08-gitnexus-plan-one-command-deployment.md"
    global_dirty_digest:
      algorithm: "sha256"
      canonicalization: "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records"
      value: "0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd"
    cited_path_manifest:
      - path: ".github/workflows/release.yml"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:f00b9b45e76ed078f28ba0f73e4ef111e6d0e5a9e2f7afe86109a601f4981d37"
        index_digest: "sha256:f00b9b45e76ed078f28ba0f73e4ef111e6d0e5a9e2f7afe86109a601f4981d37"
        worktree_digest: "sha256:f00b9b45e76ed078f28ba0f73e4ef111e6d0e5a9e2f7afe86109a601f4981d37"
        untracked_digest: absent
      - path: "AGENTS.md"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:9bf062172ba4c7fc845a9a1bce7e18121e5770be791c8ea605b82e083b3556ee"
        index_digest: "sha256:9bf062172ba4c7fc845a9a1bce7e18121e5770be791c8ea605b82e083b3556ee"
        worktree_digest: "sha256:9bf062172ba4c7fc845a9a1bce7e18121e5770be791c8ea605b82e083b3556ee"
        untracked_digest: absent
      - path: "Dockerfile"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:281884abfd20ffefec7a5259d5d7ccfb03d4c4d27a8cd452bcb5841e65a5382f"
        index_digest: "sha256:281884abfd20ffefec7a5259d5d7ccfb03d4c4d27a8cd452bcb5841e65a5382f"
        worktree_digest: "sha256:281884abfd20ffefec7a5259d5d7ccfb03d4c4d27a8cd452bcb5841e65a5382f"
        untracked_digest: absent
      - path: "README.md"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:6b1a97323f9aa37d160f3a91cdf3adabae796008ef1d42f38e16b048ac6fca5c"
        index_digest: "sha256:6b1a97323f9aa37d160f3a91cdf3adabae796008ef1d42f38e16b048ac6fca5c"
        worktree_digest: "sha256:6b1a97323f9aa37d160f3a91cdf3adabae796008ef1d42f38e16b048ac6fca5c"
        untracked_digest: absent
      - path: "README.zh-CN.md"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:a58274fa5e500e3788a6bb6cce76b1742d7275a95ddc02b2f1e38f2e00ac62b1"
        index_digest: "sha256:a58274fa5e500e3788a6bb6cce76b1742d7275a95ddc02b2f1e38f2e00ac62b1"
        worktree_digest: "sha256:a58274fa5e500e3788a6bb6cce76b1742d7275a95ddc02b2f1e38f2e00ac62b1"
        untracked_digest: absent
      - path: "design_docs/Evolving_Coding_Harness_容器化与CLI方案.md"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:0d2d5ad5b83a491dfe15b865c5e9c52a22eee5d76b096821b7feb7ecf4d902fb"
        index_digest: "sha256:0d2d5ad5b83a491dfe15b865c5e9c52a22eee5d76b096821b7feb7ecf4d902fb"
        worktree_digest: "sha256:0d2d5ad5b83a491dfe15b865c5e9c52a22eee5d76b096821b7feb7ecf4d902fb"
        untracked_digest: absent
      - path: "docker-compose.yml"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:7c091c483d5c674009f7c1144206beeb93e3ce462b16a1cff1c73d2afa438017"
        index_digest: "sha256:7c091c483d5c674009f7c1144206beeb93e3ce462b16a1cff1c73d2afa438017"
        worktree_digest: "sha256:7c091c483d5c674009f7c1144206beeb93e3ce462b16a1cff1c73d2afa438017"
        untracked_digest: absent
      - path: "docs/container-deployment.md"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:d565f9569f4c4737cdc9f1d3b44ca778f58042f89f6434465a301c286289faf4"
        index_digest: "sha256:d565f9569f4c4737cdc9f1d3b44ca778f58042f89f6434465a301c286289faf4"
        worktree_digest: "sha256:d565f9569f4c4737cdc9f1d3b44ca778f58042f89f6434465a301c286289faf4"
        untracked_digest: absent
      - path: "docs/container-deployment.zh-CN.md"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:5a63c1b47d018791e4e27465206bb42a8ce5167c139ebe6f3719e768e1812e39"
        index_digest: "sha256:5a63c1b47d018791e4e27465206bb42a8ce5167c139ebe6f3719e768e1812e39"
        worktree_digest: "sha256:5a63c1b47d018791e4e27465206bb42a8ce5167c139ebe6f3719e768e1812e39"
        untracked_digest: absent
      - path: "package.json"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:d804f326a570219976b2e6683fde69a57d19743bc0aec52dd8799eb67e0ed3b6"
        index_digest: "sha256:d804f326a570219976b2e6683fde69a57d19743bc0aec52dd8799eb67e0ed3b6"
        worktree_digest: "sha256:ee24df2a98dc1a269fa38592a93241e83ddbc703ecb1718f358fcf0a8e00bbf2"
        untracked_digest: absent
      - path: "scripts/harness.ts"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:dd247bb6beaad8b4811e98f16895f5f9a52bddb045f21cdde54d4a1758e0a84e"
        index_digest: "sha256:dd247bb6beaad8b4811e98f16895f5f9a52bddb045f21cdde54d4a1758e0a84e"
        worktree_digest: "sha256:dd247bb6beaad8b4811e98f16895f5f9a52bddb045f21cdde54d4a1758e0a84e"
        untracked_digest: absent
      - path: "src/cli/args.ts"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:52e4db9aaf93b867a44262f59da074fd0d7c243e582d88330a9bb7592b41273a"
        index_digest: "sha256:52e4db9aaf93b867a44262f59da074fd0d7c243e582d88330a9bb7592b41273a"
        worktree_digest: "sha256:52e4db9aaf93b867a44262f59da074fd0d7c243e582d88330a9bb7592b41273a"
        untracked_digest: absent
      - path: "src/cli/command.ts"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:e5342d425932c177365a08c1ce6ee14778f448caa6f45153be61abe87eff3b75"
        index_digest: "sha256:e5342d425932c177365a08c1ce6ee14778f448caa6f45153be61abe87eff3b75"
        worktree_digest: "sha256:e5342d425932c177365a08c1ce6ee14778f448caa6f45153be61abe87eff3b75"
        untracked_digest: absent
      - path: "src/cli/commands/config.ts"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:ac4d2f8b268a90a73f4af82462e43bcee79491585813f6361604f14a2a727ba7"
        index_digest: "sha256:ac4d2f8b268a90a73f4af82462e43bcee79491585813f6361604f14a2a727ba7"
        worktree_digest: "sha256:ac4d2f8b268a90a73f4af82462e43bcee79491585813f6361604f14a2a727ba7"
        untracked_digest: absent
      - path: "src/cli/commands/repl.ts"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:009320f9966e801892837f143a49b46ea28ea1ecbfa79c6b697bc17a8d11b2df"
        index_digest: "sha256:009320f9966e801892837f143a49b46ea28ea1ecbfa79c6b697bc17a8d11b2df"
        worktree_digest: "sha256:009320f9966e801892837f143a49b46ea28ea1ecbfa79c6b697bc17a8d11b2df"
        untracked_digest: absent
      - path: "src/config.ts"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:760b05a79bfc12559557517f2e1d6878a642cedc40510a024090404a5cc2b89f"
        index_digest: "sha256:760b05a79bfc12559557517f2e1d6878a642cedc40510a024090404a5cc2b89f"
        worktree_digest: "sha256:45038e3b0f87a318cc7868792234d6755cdcf17710107d1d31bddd8688dd6195"
        untracked_digest: absent
      - path: "src/providers/openai-compatible.ts"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:d1bd74133b807734f12f5f3b7c99d20517d3dddc0815f2402a70e0a57d870e93"
        index_digest: "sha256:d1bd74133b807734f12f5f3b7c99d20517d3dddc0815f2402a70e0a57d870e93"
        worktree_digest: "sha256:d1bd74133b807734f12f5f3b7c99d20517d3dddc0815f2402a70e0a57d870e93"
        untracked_digest: absent
      - path: "test/cli-commands.test.ts"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:0d5c373b9d99a186ee4603c3c8a26d5955f4e00057f4bb57b49607f181994f4c"
        index_digest: "sha256:0d5c373b9d99a186ee4603c3c8a26d5955f4e00057f4bb57b49607f181994f4c"
        worktree_digest: "sha256:0d5c373b9d99a186ee4603c3c8a26d5955f4e00057f4bb57b49607f181994f4c"
        untracked_digest: absent
      - path: "test/cli.test.ts"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:275c55cd1a6f1a81bd0183364c0a7d81d55a2baed62d550e2e7a7e54b955eb0e"
        index_digest: "sha256:275c55cd1a6f1a81bd0183364c0a7d81d55a2baed62d550e2e7a7e54b955eb0e"
        worktree_digest: "sha256:275c55cd1a6f1a81bd0183364c0a7d81d55a2baed62d550e2e7a7e54b955eb0e"
        untracked_digest: absent
      - path: "test/config-env.test.ts"
        object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}
        state: clean
        rename_from: null
        rename_to: null
        head_digest: "sha256:80c760dbaa7d62323697ba340c2039715ae5771320a3a02f92707f79ecac2e6a"
        index_digest: "sha256:80c760dbaa7d62323697ba340c2039715ae5771320a3a02f92707f79ecac2e6a"
        worktree_digest: "sha256:80c760dbaa7d62323697ba340c2039715ae5771320a3a02f92707f79ecac2e6a"
        untracked_digest: absent
  primary_symbols:
    - symbol: "resolveConfig"
      file: "src/cli/args.ts"
      lines: "181-194"
      role: "Shared command configuration resolution and precedence boundary"
    - symbol: "loadConfig"
      file: "src/config.ts"
      lines: "88-122"
      role: "Configuration defaults and URL/energy validation"
    - symbol: "replCommand.run"
      file: "src/cli/commands/repl.ts"
      lines: "72-130"
      role: "Interactive/no-TTY REPL runtime entry"
    - symbol: "createProviderFromConfig"
      file: "src/providers/openai-compatible.ts"
      lines: "222-252"
      role: "Provider tier/key/model construction"
    - symbol: "executeCommand"
      file: "src/cli/command.ts"
      lines: "87-117"
      role: "Shared CLI error and exit-code handling"
  related_symbols:
    - symbol: "scripts/harness.ts"
      relationship: "DISPATCHES_TO"
      relevance: "Root CLI registers repl/config and all other commands"
    - symbol: "configCommand"
      relationship: "CALLS resolveConfig"
      relevance: "Deployment diagnostics entry"
    - symbol: "OpenAiCompatibleProvider"
      relationship: "CONSTRUCTED_BY"
      relevance: "Real provider runtime"
    - symbol: "runTextRepl"
      relationship: "CALLED_BY replCommand.run"
      relevance: "No-TTY container fallback"
    - symbol: "runTui"
      relationship: "DYNAMICALLY_IMPORTED_BY replCommand.run"
      relevance: "TTY interactive renderer"
  execution_path:
    - "deploy.sh/deploy.ps1 validates Docker Compose and initializes data/experiments."
    - "Local mode builds the selected Dockerfile target from the current checkout; release mode pulls HARNESS_IMAGE."
    - "Compose injects /app/data, /app/experiments, provider/model environment, TTY, and resource/security constraints."
    - "The container ENTRYPOINT invokes dist/scripts/harness.js and dispatches repl."
    - "repl resolves config, selects mock/local/external provider, creates sandbox runtime, and selects Ink or text fallback based on TTY."
  pdg_constraints:
    - description: "loadConfig rejects negative/non-finite energy before returning configuration."
      affected_statements: ["src/config.ts:99-100"]
      implementation_consequence: "Deployment scripts must pass numeric defaults through existing env/config validation."
    - description: "loadConfig rejects non-HTTP local/external model URLs."
      affected_statements: ["src/config.ts:106-110"]
      implementation_consequence: "Do not normalize or rewrite model URLs in shell; pass them unchanged to the CLI."
    - description: "Environment-derived dataDirectory is returned only when non-blank."
      affected_statements: ["src/config.ts:71-85"]
      implementation_consequence: "Empty `.env` values must preserve current defaults."
  architectural_patterns:
    - pattern: "Thin standalone script wrappers around shared CLI commands"
      example_location: "scripts/run-task.ts and scripts/harness.ts"
      usage_guidance: "Deployment wrappers should orchestrate Docker only and never duplicate command implementation."
    - pattern: "Explicit environment-to-config conversion with CLI precedence"
      example_location: "src/cli/args.ts:181-194"
      usage_guidance: "Keep deployment inputs in environment/Compose and preserve CLI precedence."
    - pattern: "Runtime image runs compiled dist as non-root node"
      example_location: "Dockerfile:18-33"
      usage_guidance: "Do not switch to tsx, root, privileged mode, or host filesystem execution."
  files_to_modify:
    - file: "deploy.sh"
      symbols: []
      intended_change: "Add POSIX one-command local/release launcher."
    - file: "deploy.ps1"
      symbols: []
      intended_change: "Add PowerShell equivalent with the same options."
    - file: ".env.example"
      symbols: []
      intended_change: "Document non-sensitive provider/image defaults."
    - file: "docker-compose.yml"
      symbols: ["harness service"]
      intended_change: "Define default REPL command while preserving explicit overrides and security settings."
    - file: ".github/workflows/ci.yml"
      symbols: []
      intended_change: "Add container smoke job."
    - file: ".github/workflows/release.yml"
      symbols: []
      intended_change: "Include deployment scripts and template in archives."
    - file: "README.md"
      symbols: []
      intended_change: "Promote one-command deployment."
    - file: "README.zh-CN.md"
      symbols: []
      intended_change: "Promote one-command deployment."
    - file: "docs/container-deployment.md"
      symbols: []
      intended_change: "Document modes and troubleshooting."
    - file: "docs/container-deployment.zh-CN.md"
      symbols: []
      intended_change: "Document modes and troubleshooting."
  tests:
    - file: "test/cli.test.ts"
      scenarios: ["Root dispatch and existing command help remain unchanged after Compose default command changes."]
    - file: "test/config-env.test.ts"
      scenarios: ["Existing env precedence, blank handling, numeric energy, and URL validation remain unchanged."]
    - file: "test/deployment.test.ts"
      scenarios: ["Optional: parameter normalization maps local/release/python/provider/goal inputs to expected Compose invocations."]
  verification_commands:
    - "npm run typecheck"
    - "npm run build"
    - "npm test"
    - "docker compose config --quiet"
    - "docker compose build harness"
    - "docker compose run --rm harness --help"
    - "docker compose run --rm harness config"
    - "docker compose run --rm harness repl --provider mock --goal smoke < /dev/null"
  risks:
    - "CRITICAL shared config impact if resolveConfig/loadConfig are changed; avoid in this phase."
    - "TTY/no-TTY differences across bash, PowerShell, Compose run, and CI."
    - "Release image/version drift if remote mode is implicit."
    - "Secrets exposure through logs or config output."
    - "Container safety regression if Compose hardening is altered."
  assumptions:
    - "Docker Engine and Docker Compose are installed by the operator. Verify with docker --version and docker compose version."
    - "The operator starts from a checkout or extracted release archive containing Dockerfile/Compose/deploy scripts."
    - "Mock provider is sufficient as the default installation smoke test; real provider settings are supplied separately."
  open_questions:
    - "Should default local mode build from checkout, or should the product eventually default to GHCR latest? Recommended: checkout build locally, explicit --release remotely."
    - "Should remote zero-install bootstrap be included later? Recommended: defer until script signing/version pinning is designed."
  avoid:
    - "Do not change resolveConfig or loadConfig in this deployment-only phase."
    - "Do not make docker compose up a fake long-running daemon."
    - "Do not print or persist model API keys."
    - "Do not replace explicit CLI commands or remove standalone entrypoints."
    - "Do not use privileged containers, Docker socket mounts, or sensitive host bind mounts."
    - "Do not repeat full repository discovery; re-verify only the cited boundaries before implementation."

## 12. Assumptions and Open Questions

**Assumptions**

- [assumed] “一键部署” means one command after Docker Compose and the project/release bundle are present; a remote installer is a separate scope.
- [assumed] Defaulting to `mock` is acceptable because it gives deterministic installation smoke without requiring a model server; real agent use will select `local` or `external` explicitly.
- [verified] Existing bind-mount placeholders are present, but the script should still create directories idempotently for extracted archives or copied deployments.
- [verified] Release workflow publishes both `runtime` and `runtime-python` images and a runnable archive; the archive copy list must be extended for new deployment assets.
- [graph limitation] GitNexus index refresh was skipped after the local runner failed on Windows; implementation must re-check graph freshness before editing shared symbols.

**Open questions**

- [open] Whether the preferred user-facing command should be `./deploy.sh` or a package-manager command. Recommendation: native scripts first because they work without Node/npm and are directly aligned with Docker deployment.
- [open] Whether Compose’s default command should be `repl` or whether only the wrapper should supply it. Recommendation: set a default `repl` command for ergonomic manual use, but retain explicit command override and document that `up` is not a daemon.
- [deferred] Whether to add a signed, version-pinned remote bootstrap script. Defer until the release trust/update model is defined.
- [deferred] Whether to provide systemd/Windows Service wrappers. Defer because the current REPL is an interactive command runner, not a background service.

## 13. Definition of Done

- [ ] `./deploy.sh` and `./deploy.ps1` accept the same documented core options and fail clearly when Docker/Compose is unavailable.
- [ ] First run creates/uses `data` and `experiments` without root-owned bind mounts.
- [ ] Local mode builds the selected target and starts the existing REPL; release mode pulls a pinned/default stable image without rebuilding.
- [ ] Mock mode starts without model credentials; local/external mode preserves current `HARNESS_*` configuration and secret masking.
- [ ] Existing standalone CLI scripts, root dispatch, provider validation, TTY/no-TTY behavior, and container security constraints remain intact.
- [ ] CI runs container smoke tests for help, config, mock REPL no-TTY, and Python target.
- [ ] Chinese and English README/deployment docs show the one-command path first and keep advanced manual commands available.
- [ ] Implementation runs `detect_changes({scope: "all"})`, resolves any partial/truncated result, and reviews affected processes before commit.
