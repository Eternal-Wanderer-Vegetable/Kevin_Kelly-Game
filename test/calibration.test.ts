import assert from "node:assert/strict";
import test from "node:test";
import {
  CalibrationRunner,
  hashObject,
  type CalibrationTask,
  type ExperimentConfig,
} from "../src/experiment/calibration.js";
import { CONTRACT_SCHEMA_VERSION, type TaskSpec } from "../src/contracts/index.js";

const task: TaskSpec = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  taskId: "calibration-task",
  level: 1,
  title: "calibration fixture",
  repository: { source: "fixture", commit: "fixture-commit" },
  allowedCommands: [process.execPath],
  acceptanceCriteria: ["command succeeds"],
  baselineTestCommand: `"${process.execPath}" -e "process.exit(0)"`,
};

const config: ExperimentConfig = {
  energyConfigHash: "sha256:energy-v1",
  timeoutMs: 1000,
  queueConfigHash: "sha256:queue-v1",
  fitnessConfigHash: "sha256:fitness-v1",
};

const calibrationTask: CalibrationTask = {
  task,
  inputFiles: { "fixture.txt": "stable input\n" },
};

test("calibration runner records fixed task/config identity and compares baseline", async () => {
  const runner = new CalibrationRunner();
  const baseline = await runner.runBaseline(
    calibrationTask,
    "agent-base",
    config,
    { humanAcceptance: "accept" },
  );
  const candidate = await runner.runCandidate(
    calibrationTask,
    "agent-candidate",
    baseline,
    config,
    { humanAcceptance: 4 },
  );

  assert.equal(baseline.mode, "baseline");
  assert.equal(candidate.mode, "candidate");
  assert.equal(baseline.taskSpecHash, hashObject(task));
  assert.equal(baseline.configHash, hashObject(config));
  assert.equal(candidate.evaluation.regressionRate, 0);
  assert.equal(runner.summarize([baseline]).successRate, 1);
  assert.equal(runner.compare([baseline], [candidate]).successRateDelta, 0);
});

test("candidate run rejects a baseline from another task", async () => {
  const runner = new CalibrationRunner();
  const baseline = await runner.runBaseline(calibrationTask, "agent-base", config);
  await assert.rejects(
    () =>
      runner.runCandidate(
        {
          task: { ...task, taskId: "other-task" },
        },
        "agent-candidate",
        baseline,
        config,
      ),
    /does not match baseline/,
  );
});

test("calibration changes are explicit and values are canonicalized", () => {
  const runner = new CalibrationRunner();
  const change = runner.recordCalibrationChange(
    "timeout",
    { ms: 1000, source: "initial" },
    { source: "calibration", ms: 1500 },
    "fixture timeout was too short",
    "2026-09-06T12:00:00.000Z",
  );
  assert.equal(change.schemaVersion, 1);
  assert.equal(change.previousValue, '{"ms":1000,"source":"initial"}');
  assert.equal(change.nextValue, '{"ms":1500,"source":"calibration"}');
  assert.throws(
    () => runner.recordCalibrationChange("energy", 1, 2, " "),
    /reason must not be empty/,
  );
});
