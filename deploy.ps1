$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile = Join-Path $RootDir "docker-compose.yml"
$DefaultImageBase = "ghcr.io/eternal-wanderer-vegetable/kevin_kelly-game"

$ReleaseMode = $false
$PythonMode = $false
$NoBuild = $false
$ReleaseTag = $null
$ImageOverride = $null
$ProviderOverride = $null
$GoalOverride = $null

function Fail([string]$Message) {
  Write-Error "deploy: $Message"
  exit 1
}

function Show-Usage {
  @"
Usage: .\deploy.ps1 [options]

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
"@
}

function Require-Value([string]$Option, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.StartsWith("--")) {
    Fail "$Option requires a value"
  }
}

for ($i = 0; $i -lt $args.Count; $i++) {
  $argument = $args[$i]
  switch ($argument) {
    "--release" {
      $ReleaseMode = $true
      if ($i + 1 -lt $args.Count -and -not $args[$i + 1].StartsWith("--")) {
        $ReleaseTag = $args[++$i]
      }
    }
    "--image" {
      if ($i + 1 -ge $args.Count) { Fail "--image requires a value" }
      Require-Value "--image" $args[$i + 1]
      $ImageOverride = $args[++$i]
    }
    "--python" { $PythonMode = $true }
    "--provider" {
      if ($i + 1 -ge $args.Count) { Fail "--provider requires a value" }
      Require-Value "--provider" $args[$i + 1]
      $ProviderOverride = $args[++$i]
    }
    "--goal" {
      if ($i + 1 -ge $args.Count) { Fail "--goal requires a value" }
      Require-Value "--goal" $args[$i + 1]
      $GoalOverride = $args[++$i]
    }
    "--no-build" { $NoBuild = $true }
    "--help" { Show-Usage; exit 0 }
    "-h" { Show-Usage; exit 0 }
    default { Fail "unknown option: $argument (use --help for usage)" }
  }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "Docker is not installed or not on PATH"
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Fail "Docker daemon is not running"
}
docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  Fail "Docker Compose is not available"
}

New-Item -ItemType Directory -Force `
  (Join-Path $RootDir "data"), `
  (Join-Path $RootDir "experiments") | Out-Null

$target = if ($PythonMode) { "runtime-python" } else { "runtime" }
$env:HARNESS_BUILD_TARGET = $target

if ($ProviderOverride) { $env:HARNESS_PROVIDER = $ProviderOverride }
if ($GoalOverride) { $env:HARNESS_GOAL = $GoalOverride }

$composeBase = @(
  "--project-directory", $RootDir,
  "-f", $ComposeFile
)

if ($ReleaseMode) {
  if (-not $ImageOverride) {
    if ($env:HARNESS_IMAGE) {
      $ImageOverride = $env:HARNESS_IMAGE
    } else {
      $resolvedImage = (& docker compose @composeBase config --images | Select-Object -First 1).Trim()
      if ($resolvedImage -and $resolvedImage -ne "evolving-coding-harness:dev") {
        $ImageOverride = $resolvedImage
      } else {
        $ReleaseTag = if ($ReleaseTag) { $ReleaseTag } else { "latest" }
        $suffix = if ($PythonMode) { "-python" } else { "" }
        $ImageOverride = "${DefaultImageBase}${suffix}:${ReleaseTag}"
      }
    }
  }
  $env:HARNESS_IMAGE = $ImageOverride
}
elseif ($ImageOverride) {
  $env:HARNESS_IMAGE = $ImageOverride
}

& docker compose @composeBase config --quiet
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($ReleaseMode) {
  & docker compose @composeBase pull harness
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$runArgs = @(
  "--project-directory", $RootDir,
  "-f", $ComposeFile,
  "run",
  "--rm"
)
if (-not $ReleaseMode -and -not $NoBuild) {
  $runArgs += "--build"
}
$runArgs += "harness"

& docker compose @runArgs
exit $LASTEXITCODE
