import type { ConversationActiveRunResponse } from '@app/schemas';
import type { InteractiveRunSnapshot } from '../definitions/interactiveRun';

export function projectActiveRunResponse(
  response: ConversationActiveRunResponse,
): InteractiveRunSnapshot | undefined {
  const run = response.run;
  if (!run) return undefined;
  const pendingInteraction = run.pending_interaction
    ? {
        interactionId: run.pending_interaction.interaction_id,
        runId: run.pending_interaction.run_id,
        toolCallId: run.pending_interaction.tool_call_id,
        checkpointRevision: run.pending_interaction.checkpoint_revision,
        resumeToken: run.pending_interaction.resume_token,
      }
    : undefined;
  if (run.status === 'awaiting_user' && !pendingInteraction) {
    throw new Error(`Run ${run.run_id} is awaiting_user without a pending interaction`);
  }

  return {
    conversationId: response.conversation_id,
    runId: run.run_id,
    turnId: run.turn_id,
    executionId: run.execution_id,
    status: run.status === 'pending' ? 'starting' : run.status,
    pendingInteraction,
  };
}
