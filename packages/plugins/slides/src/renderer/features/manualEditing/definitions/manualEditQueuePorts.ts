import type { SlidesManualEditCommandOperation } from '@plugin/slides/shared/authoringEditing';
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
  /** 一次逻辑提交只准备一次呈现意图；传输重试共用它，终态后确认或撤销。 */
  readonly preparePresentation?: (operation: SlidesManualEditCommandOperation, snapshot: ManualEditQueueSnapshot) => (revision: number | null) => void;
  readonly readSnapshot: () => ManualEditQueueSnapshot;
  readonly refreshDocument: (documentId: string, expectedVersion?: number) => Promise<void>;
  readonly message: ManualEditingMessageResolver;
}
