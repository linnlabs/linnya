import type { SubmitManualEditOutcome } from '../orchestration/submitManualEdit';
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
