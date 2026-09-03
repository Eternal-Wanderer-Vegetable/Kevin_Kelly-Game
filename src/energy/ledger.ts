import { randomUUID } from "node:crypto";
import type {
  EnergyTransaction,
  ExperimentEvent,
} from "../contracts/index.js";
import { assertEnergyTransaction } from "../contracts/index.js";

export interface EnergyPolicy {
  readonly initialEnergy: number;
  readonly debitByReason: Readonly<Record<string, number>>;
  readonly rewardByReason: Readonly<Record<string, number>>;
}

export class EnergyLedger {
  private readonly balances = new Map<string, number>();

  public constructor(private readonly policy: EnergyPolicy) {
    validatePolicy(policy);
  }

  public initialize(agentId: string): number {
    if (!this.balances.has(agentId)) {
      this.balances.set(agentId, this.policy.initialEnergy);
    }
    return this.balanceOf(agentId);
  }

  public balanceOf(agentId: string): number {
    return this.balances.get(agentId) ?? this.policy.initialEnergy;
  }

  public debit(agentId: string, reason: string): EnergyTransaction {
    return this.apply(agentId, "DEBIT", reason, this.policy.debitByReason[reason] ?? 0);
  }

  public reward(agentId: string, reason: string): EnergyTransaction {
    return this.apply(
      agentId,
      "REWARD",
      reason,
      this.policy.rewardByReason[reason] ?? 0,
    );
  }

  public applyTransaction(transaction: EnergyTransaction): void {
    assertEnergyTransaction(transaction);
    const current = this.initialize(transaction.agentId);
    if (current !== transaction.balanceBefore) {
      throw new Error(`energy history is inconsistent for agent ${transaction.agentId}`);
    }
    const expectedBalanceAfter =
      transaction.kind === "DEBIT"
        ? Math.max(0, transaction.balanceBefore - transaction.amount)
        : transaction.balanceBefore + transaction.amount;
    if (transaction.balanceAfter !== expectedBalanceAfter) {
      throw new Error(`energy transaction transition is invalid: ${transaction.transactionId}`);
    }
    this.balances.set(transaction.agentId, transaction.balanceAfter);
  }

  private apply(
    agentId: string,
    kind: EnergyTransaction["kind"],
    reason: string,
    amount: number,
  ): EnergyTransaction {
    const balanceBefore = this.initialize(agentId);
    const balanceAfter =
      kind === "DEBIT"
        ? Math.max(0, balanceBefore - amount)
        : balanceBefore + amount;
    const transaction: EnergyTransaction = {
      schemaVersion: 1,
      transactionId: `energy-${randomUUID()}`,
      agentId,
      kind,
      amount,
      reason,
      balanceBefore,
      balanceAfter,
    };
    this.applyTransaction(transaction);
    return transaction;
  }
}

export function energyTransactionEvent(
  runId: string,
  transaction: EnergyTransaction,
): ExperimentEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${randomUUID()}`,
    runId,
    timestamp: new Date().toISOString(),
    type: transaction.kind === "DEBIT" ? "ENERGY_DEBITED" : "ENERGY_REWARDED",
    agentId: transaction.agentId,
    payload: { transaction },
  };
}

export function replayEnergyEvents(
  events: readonly ExperimentEvent[],
  policy: EnergyPolicy,
): EnergyLedger {
  const ledger = new EnergyLedger(policy);
  for (const event of events) {
    if (event.type !== "ENERGY_DEBITED" && event.type !== "ENERGY_REWARDED") {
      continue;
    }
    const transaction = event.payload.transaction;
    try {
      assertEnergyTransaction(transaction);
    } catch {
      throw new Error(`invalid energy transaction in event ${event.eventId}`);
    }
    ledger.applyTransaction(transaction);
  }
  return ledger;
}

function validatePolicy(policy: EnergyPolicy): void {
  if (!Number.isFinite(policy.initialEnergy) || policy.initialEnergy < 0) {
    throw new TypeError("initialEnergy must be non-negative and finite");
  }
  for (const schedule of [policy.debitByReason, policy.rewardByReason]) {
    for (const amount of Object.values(schedule)) {
      if (!Number.isFinite(amount) || amount < 0) {
        throw new TypeError("energy policy amounts must be non-negative and finite");
      }
    }
  }
}
