import type { SlidesDocumentBuildState } from '@plugin/slides/shared/documentSource';
import type { SubmitManualEditPorts } from './manualEditSubmission';
import type { ManualEditingMessageResolver } from './manualEditingMessageCatalog';

export interface ManualEditQueueSnapshot {
  readonly documentId: string | null;
  readonly buildState: SlidesDocumentBuildState | null;
  readonly presentationError: string | null;
  readonly renderVersion: number | null;
}

export interface ManualEditQueuePorts extends SubmitManualEditPorts {
  readonly readSnapshot: () => ManualEditQueueSnapshot;
  readonly refreshDocument: (documentId: string, expectedVersion?: number) => Promise<void>;
  readonly message: ManualEditingMessageResolver;
}
