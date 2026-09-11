import type { graph, runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import type { RoutedRuntimeEvent } from '@linnlabs/linnkit/contracts';
import { CommittedResumeInputsSchema } from '../definitions/committedResumeInputs';

/** 只修复提交与 lifecycle 之间的崩溃窗口；已接纳响应绝不能重开审批。 */
export function restoreCheckpointInteraction(
  record: runSupervisor.RunRecord,
  checkpoint: graph.EngineState | null,
  committedInteractions: readonly RoutedRuntimeEvent[]
): runSupervisor.RunAwaitingUserPatch | undefined {
  if (record.status === 'awaiting_user' || checkpoint?.executionStatus !== 'awaiting_user') return;
  const response =
    record.metadata?.resumeInputs === undefined
      ? undefined
      : CommittedResumeInputsSchema.parse(record.metadata.resumeInputs);
  if (response?.checkpointRevision === checkpoint.revision) return;
  const interaction = committedInteractions.find(
    event =>
      event.type === 'requires_user_interaction' &&
      event.run_id === record.runId &&
      event.checkpoint_revision === checkpoint.revision
  );
  if (interaction?.type !== 'requires_user_interaction') {
    throw new Error('Committed waiting checkpoint has no original interaction');
  }
  return {
    currentNode: 'wait_user',
    eventId: interaction.id,
    iterationsUsed: checkpoint.local?.executorLocal?.stepCount,
    interaction: {
      interactionId: interaction.interaction_id,
      toolCallId: interaction.tool_call_id,
      checkpointRevision: interaction.checkpoint_revision,
      resumeToken: interaction.resume_token,
    },
  };
}
