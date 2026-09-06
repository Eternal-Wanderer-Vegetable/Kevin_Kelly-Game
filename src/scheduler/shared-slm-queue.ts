export interface QueueRequest<T> {
  readonly agentId: string;
  readonly execute: () => Promise<T>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface QueueMetrics {
  readonly agentId: string;
  readonly queuedAt: number;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly waitMs: number;
  readonly executionMs: number;
}

export interface QueueResult<T> {
  readonly value: T;
  readonly metrics: QueueMetrics;
}

export interface QueueFailure {
  readonly agentId: string;
  readonly reason: string;
  readonly metrics: QueueMetrics;
}

export class SharedSlmQueue {
  private readonly pending: Array<{
    request: QueueRequest<unknown>;
    queuedAt: number;
    resolve: (result: QueueResult<unknown>) => void;
    reject: (error: QueueFailure) => void;
  }> = [];
  private running = false;

  public enqueue<T>(request: QueueRequest<T>): Promise<QueueResult<T>> {
    return new Promise((resolve, reject) => {
      this.pending.push({
        request: request as QueueRequest<unknown>,
        queuedAt: Date.now(),
        resolve: resolve as (result: QueueResult<unknown>) => void,
        reject,
      });
      void this.processNext();
    });
  }

  public size(): number {
    return this.pending.length + (this.running ? 1 : 0);
  }

  private async processNext(): Promise<void> {
    if (this.running) return;
    const item = this.pending.shift();
    if (!item) return;
    this.running = true;
    const { queuedAt } = item;
    const { request } = item;
    const startedAt = Date.now();
    const metricsBase = {
      agentId: request.agentId,
      queuedAt,
      startedAt,
      finishedAt: startedAt,
      waitMs: startedAt - queuedAt,
      executionMs: 0,
    };
    try {
      if (request.signal?.aborted) throw new Error("queue request cancelled");
      const value = await withTimeout(request.execute(), request.timeoutMs);
      const finishedAt = Date.now();
      item.resolve({
        value,
        metrics: {
          ...metricsBase,
          finishedAt,
          executionMs: finishedAt - startedAt,
        },
      });
    } catch (error) {
      const finishedAt = Date.now();
      item.reject({
        agentId: request.agentId,
        reason: error instanceof Error ? error.message : String(error),
        metrics: {
          ...metricsBase,
          finishedAt,
          executionMs: finishedAt - startedAt,
        },
      });
    } finally {
      this.running = false;
      void this.processNext();
    }
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs = 30_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("queue request timed out"));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    // A timed-out request may not be cancellable. Keep the shared resource
    // occupied until it settles so the next queued request remains isolated.
    if (timedOut) await operation.catch(() => {});
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
