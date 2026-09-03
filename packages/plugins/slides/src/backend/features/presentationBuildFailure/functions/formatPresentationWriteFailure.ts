import type { PresentationWriteFailure } from '../definitions/presentationBuildFailure';

export function formatPresentationWriteFailure(failure: PresentationWriteFailure): string {
  const revision = failure.expectedRevision
    ? `${failure.expectedRevision.revision}/${failure.expectedRevision.revisionId}`
    : 'none';
  return [
    `[${failure.code}] ${failure.summary}`,
    `phase=${failure.phase}; retryable=${failure.retryable}; source_fixable=${failure.sourceFixable}; draft_saved=${failure.draftSaved}`,
    `presentation_id=${failure.presentationId ?? 'none'}; expected_revision=${revision}`,
    ...(failure.referenceId ? [`failure_reference_id=${failure.referenceId}`] : []),
    failure.draftSaved
      ? 'The pending deck.js source remains available through read_file as an unresolved draft.'
      : 'No pending deck.js draft was saved by this failed operation.',
    `Next action: ${failure.nextAction}`,
  ].join('\n');
}
