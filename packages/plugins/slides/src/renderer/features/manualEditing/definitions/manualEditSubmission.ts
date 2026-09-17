import type { SlidesManualEditCommand, SlidesManualEditCommandResult } from '@plugin/slides/shared/authoringEditing';
import type { ManualEditPresentationTracePort } from './manualEditPresentationTrace';

export interface SubmitManualEditPorts {
  readonly createCommandId: () => string;
  readonly submit: (command: SlidesManualEditCommand) => Promise<SlidesManualEditCommandResult>;
  readonly trace?: ManualEditPresentationTracePort;
}

export type SubmitManualEditOutcome =
  | SlidesManualEditCommandResult
  | { readonly status: 'snapshot_unavailable' };
