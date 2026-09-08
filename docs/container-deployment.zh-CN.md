# 容器化部署

仓库提供一个包含三个 target 的多阶段 Dockerfile：

- `builder` 安装开发依赖并执行类型检查和构建。
- `runtime` 只保留编译后的 CLI 与生产依赖。
- `runtime-python` 在 `runtime` 基础上增加 `python3` 与 `python3-venv`。

运行时镜像以非 root 用户 `node` 启动：

```bash
docker build --target runtime -t evolving-coding-harness:dev .
docker build --target runtime-python -t evolving-coding-harness:python .
docker run --rm evolving-coding-harness:dev --help
docker run --rm evolving-coding-harness:dev config
```

Python 镜像只负责让容器内存在 Python。任务仍必须在
`TaskSpec.allowedCommands` 中列出 `python3`；Sandbox 的命令白名单仍是硬边界。

## Compose

启动 Compose 前先创建 bind mount 目录。仓库已经用 `.gitkeep` 保留这些目录，
避免 Docker 以 root 身份创建它们：

```bash
mkdir -p data experiments
docker compose up -d
docker compose run --rm harness --help
docker compose run --rm harness config
docker compose run --rm -it harness repl --provider mock --goal "检查工作区"
```

Compose 服务是命令执行容器，不是长期运行的 daemon：`docker compose up`
会执行默认的根命令帮助后退出。执行实验时请使用
`docker compose run --rm harness <command>`，或者在使用 `up` 时显式提供命令。

服务将 `./data` 挂载到 `/app/data`，将 `./experiments` 挂载到
`/app/experiments`。`/tmp` 使用 512 MiB 的 tmpfs，并启用 init 进程回收孤儿
进程，同时丢弃所有 Linux capability、启用 `no-new-privileges`，并限制进程数和内存。

默认情况下 Compose 将本地模型地址设为
`http://host.docker.internal:8000/v1`。模型位于其他主机或其他 Compose 服务时应覆盖：

```bash
HARNESS_LOCAL_MODEL_URL=http://model:8000/v1 docker compose run --rm harness config
```

不要把运行在宿主机或其他容器中的模型写成 `127.0.0.1`。在 Harness 容器内，
这个地址指向 Harness 容器自身。API 密钥通过 shell 环境或本地 `.env` 注入
`HARNESS_LOCAL_MODEL_KEY` 与 `HARNESS_EXTERNAL_MODEL_KEY`，不会写入
`docker-compose.yml`。

## 运行边界

容器是部署便利和额外边界，不是强安全沙箱。Mutation 代码以 `node` 用户运行，
并可以访问 bind mount 的数据和实验目录。在威胁模型与运行控制完成审查前，不要
挂载宿主敏感目录，不要使用 `--privileged`，也不要暴露 Docker socket。不要把该
容器与包含生产数据或个人数据的机器混用。

Sandbox 工作区位于 `/tmp`。tmpfs 大小同时也是内存上限，较大的仓库 fixture
需要经过审查后显式调大。使用绝对解释器路径的命令必须使用镜像内路径，例如
`/usr/local/bin/node`；宿主机上的 `process.execPath` 不能直接视为容器内路径。

无交互终端的冒烟测试：

```bash
docker compose run --rm harness --help < /dev/null
docker compose run --rm harness repl --provider mock --goal "冒烟测试" < /dev/null
```

REPL 在有 TTY 时使用 Ink；没有 TTY 时自动切换为逐行文本模式，因此第二条
冒烟命令应打印回退提示，并在输入结束时正常退出。使用 `/help` 可查看
`/step`、`/run`、`/files`、`/patch` 和 `/reset` 等命令。
