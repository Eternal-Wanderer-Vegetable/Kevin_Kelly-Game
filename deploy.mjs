#!/usr/bin/env node
/**
 * Cross-platform deployment launcher for the Harness REPL.
 *
 * Replaces the former deploy.ps1 / deploy.sh pair with a single script that
 * runs anywhere Node runs: `node deploy.mjs` is not subject to PowerShell
 * execution policies, and `npm run deploy` is an alias for the same command.
 *
 * Requires only node: builtins — no npm install needed. Docker with Compose
 * must be available; the launcher validates that before touching anything.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT_DIR = import.meta.dirname;
const COMPOSE_FILE = join(ROOT_DIR, "docker-compose.yml");
const DEFAULT_IMAGE_BASE = "ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game";
const DEFAULT_DEV_IMAGE = "evolving-coding-harness:dev";

function fail(message) {
  console.error(`deploy: ${message}`);
  process.exit(1);
}

function usage() {
  console.log(`Usage: node deploy.mjs [options]

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
`);
}

function requireValue(option, value) {
  if (value === undefined || value.trim() === "" || value.startsWith("--")) {
    fail(`${option} requires a value`);
  }
}

function parseArgs(argv) {
  const options = {
    releaseMode: false,
    pythonMode: false,
    noBuild: false,
    releaseTag: null,
    imageOverride: null,
    providerOverride: null,
    goalOverride: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    switch (argument) {
      case "--release":
        options.releaseMode = true;
        if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
          options.releaseTag = argv[++i];
        }
        break;
      case "--image":
        requireValue("--image", argv[i + 1]);
        options.imageOverride = argv[++i];
        break;
      case "--python":
        options.pythonMode = true;
        break;
      case "--provider":
        requireValue("--provider", argv[i + 1]);
        options.providerOverride = argv[++i];
        break;
      case "--goal":
        requireValue("--goal", argv[i + 1]);
        options.goalOverride = argv[++i];
        break;
      case "--no-build":
        options.noBuild = true;
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
        break;
      default:
        fail(`unknown option: ${argument} (use --help for usage)`);
    }
  }
  return options;
}

function runCompose(args, { env, capture = false } = {}) {
  const result = spawnSync("docker", ["compose", ...args], {
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    env,
    shell: false,
  });
  if (result.error) {
    fail(`failed to run docker compose: ${result.error.message}`);
  }
  return result;
}

function checkDocker() {
  let result = spawnSync("docker", ["--version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    fail("Docker is not installed or not on PATH");
  }
  result = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (result.status !== 0) {
    fail("Docker daemon is not running");
  }
  result = spawnSync("docker", ["compose", "version"], { stdio: "ignore" });
  if (result.status !== 0) {
    fail("Docker Compose is not available");
  }
}

const options = parseArgs(process.argv.slice(2));

checkDocker();

mkdirSync(join(ROOT_DIR, "data"), { recursive: true });
mkdirSync(join(ROOT_DIR, "experiments"), { recursive: true });

const composeArgs = ["--project-directory", ROOT_DIR, "-f", COMPOSE_FILE];

const env = {
  ...process.env,
  HARNESS_BUILD_TARGET: options.pythonMode ? "runtime-python" : "runtime",
};
if (options.providerOverride) {
  env.HARNESS_PROVIDER = options.providerOverride;
}
if (options.goalOverride) {
  env.HARNESS_GOAL = options.goalOverride;
}

if (options.releaseMode) {
  if (!options.imageOverride) {
    if (process.env.HARNESS_IMAGE) {
      options.imageOverride = process.env.HARNESS_IMAGE;
    } else {
      const resolved = runCompose([...composeArgs, "config", "--images"], {
        env,
        capture: true,
      })
        .stdout?.toString()
        .split("\n")[0]
        ?.trim();
      if (!resolved || resolved === DEFAULT_DEV_IMAGE) {
        const tag = options.releaseTag ?? "latest";
        const suffix = options.pythonMode ? "-python" : "";
        options.imageOverride = `${DEFAULT_IMAGE_BASE}${suffix}:${tag}`;
      } else {
        options.imageOverride = resolved;
      }
    }
  }
  env.HARNESS_IMAGE = options.imageOverride;
} else if (options.imageOverride) {
  env.HARNESS_IMAGE = options.imageOverride;
}

const configResult = runCompose([...composeArgs, "config", "--quiet"], { env });
if (configResult.status !== 0) {
  process.exit(configResult.status ?? 1);
}

if (options.releaseMode) {
  const pullResult = runCompose([...composeArgs, "pull", "harness"], { env });
  if (pullResult.status !== 0) {
    process.exit(pullResult.status ?? 1);
  }
}

const runArgs = [...composeArgs, "run", "--rm"];
if (!options.releaseMode && !options.noBuild) {
  runArgs.push("--build");
}
runArgs.push("harness");

const runResult = runCompose(runArgs, { env });
process.exitCode = runResult.status ?? 1;
