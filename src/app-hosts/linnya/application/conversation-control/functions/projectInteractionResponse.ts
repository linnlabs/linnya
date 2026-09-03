import type {
  ConversationControlRespondRequest,
  ConversationInteractionResponseRequest,
  JsonValue,
} from '@app/schemas';
import type { ConversationControlRunRecord } from '../definitions/conversationControlUseCase';
import type { PendingInteractionControl } from './readPendingInteraction';

function responsePayload(response: ConversationControlRespondRequest['response']): JsonValue {
  switch (response.kind) {
    case 'approve':
      return { action: 'approve' };
    case 'skip':
      return { skipped: true };
    case 'submit':
    case 'modify':
      return response.value;
  }
}

export function projectInteractionResponse(
  request: ConversationControlRespondRequest,
  run: ConversationControlRunRecord,
  interaction: PendingInteractionControl,
  submittedAt: number,
): ConversationInteractionResponseRequest {
  const payload = responsePayload(request.response);
  return {
    conversation_id: request.conversation_id,
    run_id: run.runId,
    interaction_id: interaction.interactionId,
    resume_token: interaction.resumeToken,
    checkpoint_revision: interaction.checkpointRevision,
    tool_call_id: interaction.toolCallId,
    tool_name: interaction.toolName,
    observation: JSON.stringify(payload),
    data: payload,
    interaction_status:
      request.response.kind === 'approve'
        ? 'approved'
        : request.response.kind === 'skip'
          ? 'skipped'
          : request.response.kind === 'modify'
            ? 'modified'
            : 'submitted',
    interaction_submitted_at: submittedAt,
    interaction_response: payload,
    project_id: request.project_id,
    project_metadata: request.project_id ? { id: request.project_id } : undefined,
  };
}
