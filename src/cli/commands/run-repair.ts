// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError, type CliCommand } from "../command.js";
import { parseCommandArgs, requireStringOption, stringOption } from "../args.js";
import { OpenAiCompatibleProvider } from "../../providers/openai-compatible.js";
import { assertRepairTask } from "../../experiment/repair-task.js";
import { DockerRepairEvaluator, resolveRepairImage } from "../../experiment/repair-evaluator.js";
import { REPAIR_SYSTEM_PROMPT, runRepairExperiment } from "../../experiment/repair.js";

const definition = {
  name: "run-repair",
  summary: "Run one model-driven repair with independent container acceptance tests.",
  usage: "run-repair --task <repair-task.json> [--output <directory>] [--max-turns <n>]",
  options: [
    "--task <path>          Trusted self-contained repair task bundle (required).",
    "--output <directory>  Save a unique run directory (default: experiments/repair).",
    "--max-turns <n>       Model call budget, 1–100 (default: 12).",
    "--image <reference>   Pre-pulled Docker Node image (default: node:24-alpine).",
    "--help, -h            Show this help.",
    "Model: HARNESS_EXTERNAL_MODEL_URL, HARNESS_EXTERNAL_MODEL_NAME, HARNESS_EXTERNAL_MODEL_KEY.",
  ],
};

export const runRepairCommand: CliCommand = {
  definition, helpWhenEmpty: true,
  async run(args, io) {
    const { values, positionals } = parseCommandArgs(definition, args, {
      task: { type: "string" }, output: { type: "string" },
      "max-turns": { type: "string" }, image: { type: "string" },
    });
    if (positionals.length > 0) throw new CliError("unexpected positional arguments", definition);
    const task: unknown = JSON.parse(await readFile(requireStringOption(definition, values, "task"), "utf8"));
    assertRepairTask(task);
    const maxTurns = Number(stringOption(values, "max-turns") ?? "12");
    if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) throw new CliError("max-turns must be between 1 and 100");
    const baseUrl = process.env.HARNESS_EXTERNAL_MODEL_URL;
    const model = process.env.HARNESS_EXTERNAL_MODEL_NAME;
    if (!baseUrl || !model) throw new CliError("set HARNESS_EXTERNAL_MODEL_URL and HARNESS_EXTERNAL_MODEL_NAME first");
    const endpoint = new URL(baseUrl);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !["http:", "https:"].includes(endpoint.protocol)) {
      throw new CliError("model URL must be an HTTP(S) endpoint without embedded credentials, query or fragment");
    }
    const image = await resolveRepairImage(stringOption(values, "image") ?? "node:24-alpine");
    const apiKey = process.env.HARNESS_EXTERNAL_MODEL_KEY;
    const provider = new OpenAiCompatibleProvider({
      baseUrl, model, tier: "external", maxOutputTokens: 2048, timeoutMs: 60_000,
      systemPrompt: REPAIR_SYSTEM_PROMPT,
      ...(apiKey ? { apiKey } : {}),
    });
    // Record the checkout that owns this module, even when launched from elsewhere.
    let sourceCommit = "unavailable";
    try {
      sourceCommit = (await promisify(execFile)("git", ["rev-parse", "HEAD"], {
        cwd: dirname(fileURLToPath(import.meta.url)), windowsHide: true,
      })).stdout.trim();
    } catch { /* Release archives need not contain Git metadata. */ }
    const report = await runRepairExperiment({
      task, provider, model, evaluator: new DockerRepairEvaluator(image),
      outputRoot: resolve(stringOption(values, "output") ?? "experiments/repair"),
      maxTurns, sourceCommit,
      onProgress: (message) => io.err(`${message}\n`),
    });
    io.out(`${JSON.stringify(report, null, 2)}\n`);
    return report.status === "passed" ? 0 : 1;
  },
};
