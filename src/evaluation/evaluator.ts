import { randomUUID } from "node:crypto";
import type {
  EvaluationResult,
  HumanAcceptance,
  TaskSpec,
  UsageRecord,
} from "../contracts/index.js";
import { assertEvaluationResult } from "../contracts/index.js";
import type { TaskRunResult } from "../tasks/task-runner.js";

export interface EvaluationInput {
  readonly task: TaskSpec;
  readonly agentId: string;
  readonly candidate: TaskRunResult;
  readonly baseline?: TaskRunResult;
  readonly evaluationId?: string;
}

export class IndependentEvaluator {
  evaluate(input: EvaluationInput): EvaluationResult {
    const candidateSuccess = isSuccessfulRun(input.candidate);
    const baselineSuccess =
      input.baseline === undefined ? null : isSuccessfulRun(input.baseline);

    return {
      schemaVersion: 1,
      evaluationId: input.evaluationId ?? `evaluation-${randomUUID()}`,
      taskId: input.task.taskId,
      agentId: input.agentId,
      taskSuccess: candidateSuccess,
      testPassRate: candidateSuccess ? 1 : 0,
      regressionRate:
        baselineSuccess === true && candidateSuccess === false ? 1 : 0,
      runtimeMs: input.candidate.commandResult?.durationMs ?? 0,
      resourceConsumption: createUsageRecord(input),
      stability: calculateStability(input.candidate),
    };
  }
}

export function recordHumanAcceptance(
  evaluation: EvaluationResult,
  acceptance: HumanAcceptance,
): EvaluationResult {
  // Human review is an external annotation: preserve automatic metrics and
  // return a new object so an existing evaluation cannot be altered in place.
  const annotated: EvaluationResult = {
    ...evaluation,
    humanAcceptance: acceptance,
  };
  assertEvaluationResult(annotated);
  return annotated;
}

function isSuccessfulRun(result: TaskRunResult): boolean {
  return (
    result.success &&
    result.commandResult !== null &&
    result.commandResult.exitCode === 0 &&
    !result.commandResult.timedOut
  );
}

function calculateStability(result: TaskRunResult): number {
  if (result.commandResult === null) return 0;
  return result.commandResult.timedOut || result.commandResult.outputTruncated
    ? 0
    : 1;
}

function createUsageRecord(input: EvaluationInput): UsageRecord {
  const resourceUsage = input.candidate.commandResult?.resourceUsage;
  return {
    schemaVersion: 1,
    usageId: `usage-${input.evaluationId ?? randomUUID()}`,
    agentId: input.agentId,
    wallTimeMs: input.candidate.commandResult?.durationMs ?? 0,
    cpuTimeMs: resourceUsage?.cpuTimeMs ?? 0,
    memoryPeakBytes: resourceUsage?.memoryPeakBytes ?? 0,
    localModelCalls: 0,
    externalModelCalls: 0,
  };
}
