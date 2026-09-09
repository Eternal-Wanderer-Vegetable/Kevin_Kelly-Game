# Container Deployment

## One-command startup

After installing Docker Desktop or Docker Engine with Compose, use the launcher
from the repository root:

```bash
./deploy.sh
```

On Windows PowerShell:

```powershell
.\deploy.ps1
```

The launcher checks Docker, creates `data/` and `experiments/`, validates the
Compose file, builds the current checkout image, and starts the interactive
REPL. The default provider is the credential-free `mock` provider, which makes
it suitable for an initial deployment smoke test.

Common options:

```bash
./deploy.sh --provider local --goal "inspect the workspace"
./deploy.sh --release
./deploy.sh --release 0.1.0 --python
```

You can also copy `.env.example` to `.env` to configure the provider, goal,
image, and model endpoints. Keep API keys in the local `.env` or shell
environment; do not commit them.

## Manual container commands

The repository ships a multi-stage Dockerfile with three targets:

- `builder` installs development dependencies and runs typecheck plus build.
- `runtime` contains only the compiled CLI and production dependencies.
- `runtime-python` extends `runtime` with `python3` and `python3-venv`.

The runtime image starts as the non-root `node` user:

```bash
docker build --target runtime -t evolving-coding-harness:dev .
docker build --target runtime-python -t evolving-coding-harness:python .
docker run --rm evolving-coding-harness:dev --help
docker run --rm evolving-coding-harness:dev config
```

The Python image only makes Python available inside the container. A task must
still list `python3` in `TaskSpec.allowedCommands`; the Sandbox command
allowlist remains the hard boundary.

## Compose

The launcher is optional. For manual Compose use, the bind-mount directories
are committed with `.gitkeep` so Docker does not create them as root:

```bash
mkdir -p data experiments
docker compose run --rm harness --help
docker compose run --rm harness config
docker compose run --rm -it harness repl --provider mock --goal "inspect the workspace"
```

The Compose service is a command runner rather than a long-lived daemon. With
no explicit command, `docker compose run --rm -it harness` enters the default
REPL; other commands continue to use `docker compose run --rm harness <command>`.
Do not treat `docker compose up` as a background service manager.

The service mounts `./data` at `/app/data` and `./experiments` at
`/app/experiments`. It also gives the Sandbox a 512 MiB `/tmp` tmpfs, enables
an init process for orphan reaping, drops all Linux capabilities, applies
`no-new-privileges`, and limits process count and memory.

By default Compose points the local model URL at
`http://host.docker.internal:8000/v1`. Override it when the model runs on
another host or as another Compose service:

```bash
HARNESS_LOCAL_MODEL_URL=http://model:8000/v1 docker compose run --rm harness config
```

Do not use `127.0.0.1` for a model running on the host or another container.
Inside the harness container, that address refers to the harness container
itself. API keys are passed through `HARNESS_LOCAL_MODEL_KEY` and
`HARNESS_EXTERNAL_MODEL_KEY` from the shell environment or a local `.env`;
they are never written into `docker-compose.yml`.

## Operational Boundaries

The container is a deployment convenience and an additional boundary, not a
strong security sandbox. Mutation code runs as the `node` user and can access
the bind-mounted data and experiment directories. Do not mount sensitive host
directories, use `--privileged`, or expose the Docker socket. Keep experiments
away from machines containing production or personal data until the threat
model and operational controls have been reviewed.

The Sandbox workspace lives under `/tmp`. The tmpfs limit is also a memory
limit, so large repository fixtures may need a larger explicitly reviewed
value. Commands that use absolute interpreter paths must use paths valid inside
the image, such as `/usr/local/bin/node`; host-specific `process.execPath`
values are not portable into the container.

For a non-interactive smoke test:

```bash
docker compose run --rm harness --help < /dev/null
docker compose run --rm harness repl --provider mock --goal "smoke test" < /dev/null
```

The REPL uses Ink when a TTY is available. Without a TTY it switches to a
line-oriented mode, so the second smoke test should print the fallback banner
and exit cleanly at end of input. Use `/help` to list commands such as
`/step`, `/run`, `/files`, `/patch`, and `/reset`.
