import type { JsonValue } from '@app/schemas';
import { ConversationControlError } from '../definitions/conversationControlError';
import type {
  ConversationControlMessageWindow,
  ConversationControlRunRecord,
} from '../definitions/conversationControlUseCase';

interface PendingInteractionControl {
  readonly interactionId: string;
  readonly toolCallId: string;
  readonly checkpointRevision: number;
  readonly resumeToken: string;
  readonly toolName: string;
  readonly prompt?: string;
  readonly form?: JsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConversationControlError('internal_error', `${context} is missing ${key}`);
  }
  return value;
}

function readCheckpointRevision(record: Record<string, unknown>, context: string): number {
  const value = record.checkpointRevision;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ConversationControlError('internal_error', `${context} has invalid checkpointRevision`);
  }
  return value;
}

export function readPendingInteraction(
  run: ConversationControlRunRecord,
  window: ConversationControlMessageWindow,
): PendingInteractionControl {
  const awaitingUser = run.metadata?.awaitingUser;
  if (!isRecord(awaitingUser) || !isRecord(awaitingUser.interaction)) {
    throw new ConversationControlError(
      'internal_error',
      `Run ${run.runId} is awaiting_user without interaction control identity`,
    );
  }
  const interaction = awaitingUser.interaction;
  if (interaction.status !== 'pending') {
    throw new ConversationControlError(
      'interaction_mismatch',
      `Run ${run.runId} interaction is no longer pending`,
    );
  }
  const interactionId = readRequiredString(interaction, 'interactionId', `Run ${run.runId} interaction`);
  const toolCallId = readRequiredString(interaction, 'toolCallId', `Run ${run.runId} interaction`);

  if (window.status !== 'ready') {
    throw new ConversationControlError(
      'internal_error',
      `Conversation ${run.conversationId} interaction projection is not ready`,
      true,
    );
  }
  const toolMessage = [...window.messages].reverse().find(message => (
    message.run_id === run.runId
    && message.message_type === 'tool_calls'
    && message.payload.tool_call_id === toolCallId
    && message.payload.interaction?.status === 'active'
    && message.payload.interaction.interactionId === interactionId
  ));
  if (!toolMessage || toolMessage.message_type !== 'tool_calls') {
    throw new ConversationControlError(
      'internal_error',
      `Run ${run.runId} pending interaction is missing from the durable message projection`,
      true,
    );
  }

  return {
    interactionId,
    toolCallId,
    checkpointRevision: readCheckpointRevision(interaction, `Run ${run.runId} interaction`),
    resumeToken: readRequiredString(interaction, 'resumeToken', `Run ${run.runId} interaction`),
    toolName: toolMessage.payload.tool_name,
    ...(toolMessage.content === null ? {} : { prompt: toolMessage.content }),
    ...(toolMessage.payload.data === undefined ? {} : { form: toolMessage.payload.data }),
  };
}

export type { PendingInteractionControl };
