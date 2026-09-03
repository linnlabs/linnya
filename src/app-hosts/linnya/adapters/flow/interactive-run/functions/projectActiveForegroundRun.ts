import type { ConversationActiveRunResponse } from '@app/schemas';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';

type RunSnapshot = runSupervisor.RunSnapshot;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context} is missing ${key}`);
  }
  return value;
}

function readCheckpointRevision(record: Record<string, unknown>, context: string): number {
  const value = record.checkpointRevision;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${context} has an invalid checkpointRevision`);
  }
  return value;
}

export function projectActiveForegroundRun(
  conversationId: string,
  runs: readonly RunSnapshot[],
): ConversationActiveRunResponse {
  const foregroundRuns = runs.filter(run => run.metadata?.lane === 'foreground');
  if (foregroundRuns.length > 1) {
    throw new Error(`Conversation ${conversationId} has multiple active foreground runs`);
  }

  const run = foregroundRuns[0];
  if (!run) return { conversation_id: conversationId, run: null };
  if (
    run.status !== 'pending'
    && run.status !== 'running'
    && run.status !== 'awaiting_user'
  ) {
    throw new Error(`Run ${run.runId} is not active`);
  }

  const metadata = run.metadata ?? {};
  const turnId = readRequiredString(metadata, 'turnId', `Run ${run.runId}`);
  const executionId = typeof metadata.executionId === 'string' && metadata.executionId.length > 0
    ? metadata.executionId
    : undefined;

  let pendingInteraction: NonNullable<ConversationActiveRunResponse['run']>['pending_interaction'];
  if (run.status === 'awaiting_user') {
    const awaitingUser = metadata.awaitingUser;
    if (!isRecord(awaitingUser) || !isRecord(awaitingUser.interaction)) {
      throw new Error(`Run ${run.runId} is awaiting_user without a pending interaction`);
    }
    const interaction = awaitingUser.interaction;
    if (interaction.status !== 'pending') {
      throw new Error(`Run ${run.runId} awaiting interaction is not pending`);
    }
    pendingInteraction = {
      interaction_id: readRequiredString(interaction, 'interactionId', `Run ${run.runId} interaction`),
      run_id: run.runId,
      tool_call_id: readRequiredString(interaction, 'toolCallId', `Run ${run.runId} interaction`),
      checkpoint_revision: readCheckpointRevision(interaction, `Run ${run.runId} interaction`),
      resume_token: readRequiredString(interaction, 'resumeToken', `Run ${run.runId} interaction`),
    };
  }

  return {
    conversation_id: conversationId,
    run: {
      run_id: run.runId,
      turn_id: turnId,
      execution_id: executionId,
      status: run.status,
      lane: 'foreground',
      pending_interaction: pendingInteraction,
    },
  };
}
