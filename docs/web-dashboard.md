# Web Dashboard

The dashboard is a **read-only** browser view of experiment progress. It runs
as a sidecar service next to the harness, watches the append-only JSONL event
log through the shared `data/` volume, and never touches run data: every mount
is read-only and no endpoint writes anything.

- **Runs list** with derived status: `running`, `completed`, `error`, or
  `stalled` (no event for 10 minutes).
- **Run detail** with generation progress (`GENERATION_STARTED`/`COMPLETED`
  pairs), repair progress (turn count against `maxTurns`, baseline/acceptance
  results), agent cards (lifecycle, energy), and a live event stream pushed
  over Server-Sent Events.
- **Artifacts** browser for the `experiments/` directory (candidate source,
  reports, checksums).

## Quick start (local)

```bash
npm run build
npm run webui
# open http://127.0.0.1:8080
```

Without `--token` the server is **open**; it binds to `127.0.0.1` and is meant
for localhost or an SSH tunnel. Use `--host`, `--port`, `--event-log`,
`--data-dir`, and `--poll-interval` to adjust; `harness webui --help` lists
everything.

## Remote server

```bash
node deploy.mjs --web          # build + start the dashboard service (port 8080)
node deploy.mjs --web 9000     # custom port
```

This is equivalent to:

```bash
docker compose --profile web up -d --build webui
```

The `webui` service mounts `./data` and `./experiments` **read-only** and
publishes `HARNESS_WEBUI_PORT` (default 8080).

### Authentication

| Scenario | Requirement |
| -------- | ----------- |
| Local browser, `ssh -L 8080:localhost:8080 user@server` | none |
| Published port on a trusted intranet | token recommended |
| Public internet | token **required** |

Set a token in `.env` (or the shell) before exposing the port:

```bash
HARNESS_WEBUI_TOKEN=$(openssl rand -hex 16)
```

With a token configured, every request must present
`Authorization: Bearer <token>` or `?token=<token>`; the SPA picks the token up
from its own URL, so bookmark `http://server:8080/?token=<token>`.

For TLS, terminate it in your existing reverse proxy (Caddy/nginx) and keep
`HARNESS_WEBUI_TOKEN` enabled. The SSE endpoint sends
`X-Accel-Buffering: no`; if a proxy still buffers it, the page keeps polling
the run summary as a fallback.

## HTTP API

| Route | Purpose |
| ----- | ------- |
| `GET /api/runs` | Run list with derived status and event-type counts |
| `GET /api/runs/:runId/summary` | Same summary as `npm run report -- --format json`, plus `status` |
| `GET /api/events?after=&run=&type=&limit=` | Incremental event tail (`after` is a byte offset) |
| `GET /api/stream?run=&after=` | SSE event batches; resume via `Last-Event-ID` |
| `GET /api/artifacts`, `GET /api/artifacts/:path` | Read-only artifact listing and text preview |
| anything else | The built SPA from `dist/webui` |

## How it works

Experiments append `ExperimentEvent` records to
`data/runs/events.jsonl` (`HARNESS_EVENT_LOG`). The dashboard tails that file
by byte offset, groups events by `runId`, and reuses the same pure report and
replay functions as the `report` CLI (`buildRunReport`, `replayEvents`,
`replayEnergyEvents`). The server is plain `node:http` — no extra runtime
dependencies — and the frontend is a Vite + React app built into `dist/webui`.

## Safety

- Read-only bind mounts (`:ro`) and no write endpoints.
- The container keeps the harness security baseline: `cap_drop: ALL`,
  `no-new-privileges`, `pids_limit`, and a `mem_limit`.
- A missing or malformed event line is skipped and counted — a bad line can
  degrade the view but never crashes the dashboard.
