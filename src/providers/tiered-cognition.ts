/*
 * Copyright (C) 2026 Vegetable
 *
 * This file is part of Evolving Coding Harness.
 *
 * Evolving Coding Harness is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Evolving Coding Harness is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type {
  AgentAction,
  CognitionProvider,
  CognitionRequest,
} from "../core/agent-core.js";
import type { PolicyConfig } from "../evolution/genome-runtime.js";

export interface TieredCognitionStats {
  readonly localCalls: number;
  readonly externalCalls: number;
  readonly escalations: number;
}

/**
 * Routes cognition between the cheap local SLM and the expensive external
 * LLM according to the agent's own policy — the mechanism that lets a
 * "cognitive resource scheduling" strategy emerge instead of being chosen
 * once by the operator.
 *
 * Escalation rules, in order:
 * 1. policy.escalateToExternal → external from the first call;
 * 2. policy.externalAfterFailures → external once local has thrown that many
 *    times in a row (a local success resets the counter);
 * 3. an action `{"type":"escalate"}` returned by local is honoured once: the
 *    same request is retried on external, letting the model itself ask for
 *    the expensive tier.
 */
export class TieredCognitionProvider implements CognitionProvider {
  private localCalls = 0;
  private externalCalls = 0;
  private escalations = 0;
  private consecutiveLocalFailures = 0;

  public constructor(
    private readonly local: CognitionProvider,
    private readonly external: CognitionProvider | undefined,
    private readonly policy: PolicyConfig = { rules: {} },
  ) {}

  public async think(request: CognitionRequest): Promise<AgentAction> {
    if (this.shouldUseExternal()) {
      this.externalCalls += 1;
      return this.requireExternal().think(request);
    }

    this.localCalls += 1;
    try {
      const action = await this.local.think(request);
      this.consecutiveLocalFailures = 0;
      if (action.type === "escalate" && this.external !== undefined) {
        this.escalations += 1;
        this.externalCalls += 1;
        return this.external.think(request);
      }
      return action;
    } catch (error) {
      this.consecutiveLocalFailures += 1;
      if (
        this.external !== undefined &&
        this.policy.externalAfterFailures !== undefined &&
        this.consecutiveLocalFailures >= this.policy.externalAfterFailures
      ) {
        this.escalations += 1;
        this.externalCalls += 1;
        return this.external.think(request);
      }
      throw error;
    }
  }

  public stats(): TieredCognitionStats {
    return {
      localCalls: this.localCalls,
      externalCalls: this.externalCalls,
      escalations: this.escalations,
    };
  }

  private shouldUseExternal(): boolean {
    if (this.external === undefined) return false;
    if (this.policy.escalateToExternal === true) return true;
    return (
      this.policy.externalAfterFailures !== undefined &&
      this.consecutiveLocalFailures >= this.policy.externalAfterFailures
    );
  }

  private requireExternal(): CognitionProvider {
    if (this.external === undefined) {
      throw new Error("external cognition tier is not configured");
    }
    return this.external;
  }
}
