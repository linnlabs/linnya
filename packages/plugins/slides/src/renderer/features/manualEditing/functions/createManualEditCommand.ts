import type {
  SlidesManualEditCommand,
  SlidesManualEditOperation,
} from '@plugin/slides/shared/authoringEditing';
import type { SlidesDocumentBuildState } from '@plugin/slides/shared/documentSource';

export function createManualEditCommand(input: {
  readonly commandId: string;
  readonly documentId: string;
  readonly buildState: SlidesDocumentBuildState;
  readonly renderVersion: number;
  readonly operation: SlidesManualEditOperation;
}): SlidesManualEditCommand | null {
  if (
    input.buildState.state !== 'ready'
    || input.buildState.presentationId !== input.documentId
    || input.buildState.versionNumber !== input.renderVersion
  ) {
    return null;
  }
  return {
    commandId: input.commandId,
    documentId: input.documentId,
    expectedBase: {
      revisionId: input.buildState.versionId,
      revision: input.buildState.versionNumber,
      sourceHash: input.buildState.sourceHash,
    },
    operation: input.operation,
  };
}
