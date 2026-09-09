#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
DEFAULT_IMAGE_BASE="ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game"

release_mode=0
python_mode=0
no_build=0
release_tag=""
image_override=""
provider_override=""
goal_override=""

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [options]

Start the interactive Harness REPL in Docker Compose.

Options:
  --release [tag]       Pull a published GHCR image instead of building locally.
  --image <image>       Override the image used by Compose.
  --python              Use the runtime-python image/target.
  --provider <kind>     Select local, external, or mock.
  --goal <text>         Set the initial task goal.
  --no-build            Reuse the local image instead of building it.
  --help                Show this help.

Environment:
  HARNESS_IMAGE, HARNESS_PROVIDER, HARNESS_GOAL and the documented
  HARNESS_* model variables can also be set in .env or the shell.
EOF
}

fail() {
  printf 'deploy: %s\n' "$*" >&2
  exit 1
}

require_value() {
  if [[ $# -lt 2 || -z "$2" || "$2" == --* ]]; then
    fail "$1 requires a value"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      release_mode=1
      if [[ $# -gt 1 && "$2" != --* ]]; then
        release_tag="$2"
        shift
      fi
      ;;
    --image)
      require_value "--image" "${2-}"
      image_override="$2"
      shift
      ;;
    --python)
      python_mode=1
      ;;
    --provider)
      require_value "--provider" "${2-}"
      provider_override="$2"
      shift
      ;;
    --goal)
      require_value "--goal" "${2-}"
      goal_override="$2"
      shift
    ;;
    --no-build)
      no_build=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1 (use --help for usage)"
      ;;
  esac
  shift
done

command -v docker >/dev/null 2>&1 || fail "Docker is not installed or not on PATH"
docker info >/dev/null 2>&1 || fail "Docker daemon is not running"
docker compose version >/dev/null 2>&1 || fail "Docker Compose is not available"

mkdir -p "${ROOT_DIR}/data" "${ROOT_DIR}/experiments"

target="runtime"
if [[ "$python_mode" -eq 1 ]]; then
  target="runtime-python"
fi

if [[ -n "$provider_override" ]]; then
  export HARNESS_PROVIDER="$provider_override"
fi
if [[ -n "$goal_override" ]]; then
  export HARNESS_GOAL="$goal_override"
fi
export HARNESS_BUILD_TARGET="$target"

if [[ "$release_mode" -eq 1 ]]; then
  if [[ -z "$image_override" ]]; then
    resolved_image="$(
      docker compose --project-directory "$ROOT_DIR" -f "$COMPOSE_FILE" config --images |
        sed -n '1p'
    )"
    if [[ -z "${HARNESS_IMAGE:-}" && "$resolved_image" == "evolving-coding-harness:dev" ]]; then
      release_tag="${release_tag:-latest}"
      image_override="${DEFAULT_IMAGE_BASE}:${release_tag}"
      if [[ "$python_mode" -eq 1 ]]; then
        image_override="${DEFAULT_IMAGE_BASE}-python:${release_tag}"
      fi
    elif [[ -z "${HARNESS_IMAGE:-}" ]]; then
      image_override="$resolved_image"
    else
      image_override="${HARNESS_IMAGE}"
    fi
  fi
  export HARNESS_IMAGE="$image_override"
  docker compose --project-directory "$ROOT_DIR" -f "$COMPOSE_FILE" config --quiet
  docker compose --project-directory "$ROOT_DIR" -f "$COMPOSE_FILE" pull harness
else
  if [[ -n "$image_override" ]]; then
    export HARNESS_IMAGE="$image_override"
  fi
  docker compose --project-directory "$ROOT_DIR" -f "$COMPOSE_FILE" config --quiet
fi

run_args=(
  --project-directory "$ROOT_DIR"
  -f "$COMPOSE_FILE"
  run
  --rm
)

if [[ "$release_mode" -eq 0 && "$no_build" -eq 0 ]]; then
  run_args+=(--build)
fi

run_args+=(harness)
docker compose "${run_args[@]}"
