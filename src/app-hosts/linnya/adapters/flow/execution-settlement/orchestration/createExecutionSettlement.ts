import {
  createRunExecutionMetricsEvent,
  generateRuntimeEventId,
  type ContextUsageSnapshot,
  type RunExecutionOutcome,
} from '@linnlabs/linnkit/contracts';
import { Logger } from 'src/shared/logger';
import type {
  ExecutionSettlementOrchestration,
  ExecutionSettlementPorts,
  ExecutionSettlementScope,
  FailedExecutionSettlement,
  SuccessfulExecutionSettlement,
} from '../definitions/executionSettlement';
import { readWaitUserReason } from '../functions/readWaitUserReason';

const logger = new Logger('ExecutionSettlement');

/**
 * 一次 execution 的唯一结算编排。
 *
 * metrics 是 Graph execution 的事实，RunHandle 是 durable drain 后的权威控制态；两者不能
 * 因后续持久化失败而补造第二份相反 metrics。
 */
export function createExecutionSettlement(
  scope: ExecutionSettlementScope,
  ports: ExecutionSettlementPorts,
): ExecutionSettlementOrchestration {
  let executionMetricsPublished = false;
  let persistenceDrainFailed = false;
  let checkpointCleanupFailed = false;

  const publishMetricsOnce = (
    outcome: RunExecutionOutcome,
    contextUsage?: ContextUsageSnapshot,
  ): void => {
    if (executionMetricsPublished) return;
    ports.publishRuntimeEvent(createRunExecutionMetricsEvent(
      generateRuntimeEventId(),
      scope.conversationId,
      scope.turnId,
      {
        execution_id: scope.executionId,
        outcome,
        duration_ms: ports.now() - scope.executionStartedAtMs,
        ...(scope.userMessageId ? { user_message_id: scope.userMessageId } : {}),
        ...(contextUsage ? { context_usage: contextUsage } : {}),
      },
    ), 'ExecutionSettlement.metrics');
    executionMetricsPublished = true;
  };

  const drainOrThrow = async (): Promise<void> => {
    try {
      await ports.drainPersistence();
    } catch (error) {
      persistenceDrainFailed = true;
      throw error;
    }
  };

  const clearCheckpointOrThrow = async (): Promise<void> => {
    try {
      await ports.clearCheckpoint(ports.runHandle.runId);
    } catch (error) {
      checkpointCleanupFailed = true;
      throw error;
    }
  };

  const settleSuccessfulExecution = async (
    input: SuccessfulExecutionSettlement,
  ): Promise<void> => {
    const awaitingUser = input.checkpointNodeId === 'wait_user';
    const waitUserEvent = input.waitUserEvent;
    if (awaitingUser && !waitUserEvent) {
      throw new Error('wait_user checkpoint requires a published interaction event');
    }

    publishMetricsOnce(
      awaitingUser ? 'awaiting_user' : 'completed',
      input.contextUsage,
    );
    await drainOrThrow();

    if (awaitingUser && waitUserEvent) {
      await ports.runHandle.markAwaitingUser({
        currentNode: input.checkpointNodeId,
        iterationsUsed: input.stepCount,
        eventId: waitUserEvent.id,
        reason: readWaitUserReason(waitUserEvent),
        interaction: {
          interactionId: waitUserEvent.interaction_id,
          toolCallId: waitUserEvent.tool_call_id,
          checkpointRevision: waitUserEvent.checkpoint_revision,
          resumeToken: waitUserEvent.resume_token,
        },
      });
      return;
    }

    // completed 是不可逆终态，必须先完成可能失败的 checkpoint 清理。
    await clearCheckpointOrThrow();
    await ports.runHandle.markCompleted({
      currentNode: input.checkpointNodeId,
      iterationsUsed: input.stepCount,
    });
    ports.releaseRunResources(ports.runHandle.runId);
  };

  const settleFailedExecution = async (
    input: FailedExecutionSettlement,
  ): Promise<void> => {
    publishMetricsOnce(input.kind, input.contextUsage);

    if (!persistenceDrainFailed) {
      try {
        await ports.drainPersistence();
      } catch (drainError) {
        persistenceDrainFailed = true;
        logger.error('Failed to persist run failure facts before lifecycle settlement', drainError);
      }
    }

    if (input.kind === 'cancelled') {
      await ports.runHandle.cancel({
        reason: typeof input.abortReason === 'string' ? input.abortReason : 'aborted',
        forceCleanup: false,
      });
    } else {
      await ports.runHandle.markFailed({
        errorCode: input.failureFact.error_code,
        message: input.failureFact.error,
        recoverable: input.failureFact.retryable,
      });
    }

    if (!checkpointCleanupFailed) {
      try {
        await ports.clearCheckpoint(ports.runHandle.runId);
      } catch (cleanupError) {
        checkpointCleanupFailed = true;
        logger.error('Failed to clear checkpoint after terminal run settlement', cleanupError);
      }
    }
    ports.releaseRunResources(ports.runHandle.runId);
  };

  return {
    settleSuccessfulExecution,
    settleFailedExecution,
  };
}
