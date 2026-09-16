import type { ManualEditQueueEntry } from '../definitions/manualEditQueue';
import type { SubmitManualEditOutcome } from '../definitions/manualEditSubmission';
import type { ManualEditingMessageResolver } from '../definitions/manualEditingMessageCatalog';

export function readManualEditErrorMessage(
  outcome: SubmitManualEditOutcome,
  message: ManualEditingMessageResolver,
): string | null {
  switch (outcome.status) {
    case 'committed':
      return null;
    case 'snapshot_unavailable':
      return message('slides.manualEditing.error.snapshotUnavailable');
    case 'validation_failed':
    case 'build_failed':
      return outcome.message;
    case 'conflict':
      if (outcome.reason === 'draft_present') return message('slides.manualEditing.error.draftPresent');
      if (outcome.reason === 'command_reused') return message('slides.manualEditing.error.commandReused');
      return message('slides.manualEditing.error.staleBase');
  }
}

export function describeManualEditQueueFailure(
  error: string,
  active: ManualEditQueueEntry,
  waiting: readonly ManualEditQueueEntry[],
  message: ManualEditingMessageResolver,
): string {
  return [
    error,
    ...(waiting.length ? [message('slides.manualEditing.error.dependentEditsBlocked')] : []),
    ...([active, ...waiting].some(entry => entry.intent.operation.op === 'set_text_content')
      ? [message('slides.manualEditing.error.textDraftRetained')] : []),
  ].join(' ');
}
