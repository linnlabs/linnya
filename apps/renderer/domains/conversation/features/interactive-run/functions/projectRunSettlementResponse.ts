import type { ConversationRunSettlementResponse } from '@app/schemas';
import type { InteractiveRunSnapshot } from '../definitions/interactiveRun';
import { projectActiveRunResponse } from './projectActiveRunResponse';

export function projectRunSettlementResponse(
  response: ConversationRunSettlementResponse,
  current: InteractiveRunSnapshot,
): InteractiveRunSnapshot | undefined {
  if (response.conversation_id !== current.conversationId) {
    throw new Error('Run settlement belongs to another conversation');
  }
  if (!current.runId || response.requested_run_id !== current.runId) {
    throw new Error('Run settlement does not match current run identity');
  }

  const run = response.run;
  if (!run) return undefined;
  if (run.run_id !== current.runId) {
    throw new Error('Run settlement payload does not match requested run identity');
  }

  if ('turn_id' in run) {
    return projectActiveRunResponse({
      conversation_id: response.conversation_id,
      run,
    });
  }

  return {
    conversationId: response.conversation_id,
    runId: run.run_id,
    turnId: current.turnId,
    executionId: current.executionId,
    status: run.status,
    error: run.error?.message,
  };
}
