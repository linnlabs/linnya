import type { ConversationControlRunStatusSnapshot } from '@app/schemas';
import { ConversationControlError } from '../definitions/conversationControlError';
import type { ConversationControlRunRecord } from '../definitions/conversationControlUseCase';
import type { PendingInteractionControl } from './readPendingInteraction';

function readMetadataString(run: ConversationControlRunRecord, key: string): string {
  const value = run.metadata?.[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConversationControlError(
      'internal_error',
      `Run ${run.runId} is missing ${key}`,
    );
  }
  return value;
}

export function projectRunStatus(
  run: ConversationControlRunRecord,
  interaction: PendingInteractionControl | undefined,
  resultAvailable: boolean,
): ConversationControlRunStatusSnapshot {
  if (run.status === 'paused') {
    throw new ConversationControlError(
      'unsupported_runtime_state',
      `Run ${run.runId} is in unsupported runtime state paused`,
    );
  }
  const terminal = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
  if (!run.agentSpecId) {
    throw new ConversationControlError('internal_error', `Run ${run.runId} is missing agentSpecId`);
  }

  return {
    conversation_id: run.conversationId,
    run_id: run.runId,
    turn_id: readMetadataString(run, 'turnId'),
    execution_id: readMetadataString(run, 'executionId'),
    agent_id: run.agentSpecId,
    status: run.status,
    current_node: run.currentNode,
    execution_steps_used: run.executionStepsUsed,
    run_iterations_used: run.runIterationsUsed ?? run.iterationsUsed,
    // 旧 CLI/Renderer 合同仍读取 iterations_used；其语义现在固定为 run 累计步数。
    iterations_used: run.runIterationsUsed ?? run.iterationsUsed,
    started_at: run.startedAt,
    updated_at: run.updatedAt,
    terminal_at: terminal ? run.updatedAt : undefined,
    pending_interaction: interaction
      ? {
          interaction_id: interaction.interactionId,
          tool_name: interaction.toolName,
          prompt: interaction.prompt,
          form: interaction.form,
        }
      : undefined,
    result_available: resultAvailable,
    error: run.errorIfAny
      ? {
          code: run.errorIfAny.errorCode,
          message: run.errorIfAny.message,
          recoverable: run.errorIfAny.recoverable,
        }
      : undefined,
  };
}
