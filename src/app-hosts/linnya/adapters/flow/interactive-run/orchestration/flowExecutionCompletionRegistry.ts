import type { RunId } from 'linnkit/contracts';

interface FlowExecutionCompletion {
  readonly promise: Promise<void>;
  complete(): void;
  fail(error: unknown): void;
}

export interface PendingFlowExecution {
  readonly runId: RunId;
  readonly conversationId: string;
  readonly completion: Promise<void>;
}

export interface FlowExecutionCompletionRegistry {
  register(runId: RunId, conversationId: string): FlowExecutionCompletion;
  findPending(runId: RunId): Promise<void> | undefined;
  requirePending(runId: RunId): Promise<void>;
  snapshotPendingByConversation(conversationId: string): readonly PendingFlowExecution[];
}

/**
 * foreground cancel、对话 cleanup 与原 SSE execution 的进程内完成屏障。
 *
 * RunSupervisor 的 cancelled 状态表示取消请求已接纳，不表示 Graph 事实和 Host
 * persistence 已经 drain；调用方必须额外等待这里。cleanup 跨重启重放则依赖持久 runs，
 * 不能把本 registry 扩成第二套持久 owner 状态。
 */
export function createFlowExecutionCompletionRegistry(): FlowExecutionCompletionRegistry {
  const pendingByRunId = new Map<RunId, PendingFlowExecution>();

  return {
    register(runId, conversationId): FlowExecutionCompletion {
      if (pendingByRunId.has(runId)) {
        throw new Error(`Flow execution completion is already registered for run ${runId}`);
      }

      let resolvePromise = (): void => undefined;
      let rejectPromise = (_error: unknown): void => undefined;
      const promise = new Promise<void>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      // execution 失败时可能没有并发 cancel waiter；提前附着 rejection handler，避免宿主产生未处理 rejection。
      void promise.catch(() => undefined);
      const pending: PendingFlowExecution = Object.freeze({
        runId,
        conversationId,
        completion: promise,
      });
      pendingByRunId.set(runId, pending);

      const settle = (action: () => void): void => {
        if (pendingByRunId.get(runId) !== pending) return;
        pendingByRunId.delete(runId);
        action();
      };

      return {
        promise,
        complete: () => settle(resolvePromise),
        fail: error => settle(() => rejectPromise(error)),
      };
    },

    findPending(runId): Promise<void> | undefined {
      return pendingByRunId.get(runId)?.completion;
    },

    requirePending(runId): Promise<void> {
      const pending = pendingByRunId.get(runId)?.completion;
      if (!pending) {
        throw new Error(`Active run ${runId} has no registered Flow execution completion`);
      }
      return pending;
    },

    snapshotPendingByConversation(conversationId): readonly PendingFlowExecution[] {
      return Array.from(pendingByRunId.values()).filter(
        pending => pending.conversationId === conversationId
      );
    },
  };
}
