import type {
  SlidesManualEditCommand,
  SlidesManualEditCommandResult,
  SlidesManualEditOperation,
} from '@plugin/slides/shared/authoringEditing';
import type { SlidesDocumentBuildState } from '@plugin/slides/shared/documentSource';
import { createManualEditCommand } from '../functions/createManualEditCommand';

export interface SubmitManualEditPorts {
  readonly createCommandId: () => string;
  readonly submit: (command: SlidesManualEditCommand) => Promise<SlidesManualEditCommandResult>;
  readonly refreshDocument: (documentId: string) => Promise<void>;
}

export type SubmitManualEditOutcome =
  | SlidesManualEditCommandResult
  | { readonly status: 'snapshot_unavailable' };

export async function submitManualEdit(input: {
  readonly documentId: string;
  readonly buildState: SlidesDocumentBuildState | null;
  readonly renderVersion: number | null;
  readonly operation: SlidesManualEditOperation;
}, ports: SubmitManualEditPorts): Promise<SubmitManualEditOutcome> {
  if (!input.buildState || input.renderVersion === null) {
    return { status: 'snapshot_unavailable' };
  }
  const command = createManualEditCommand({
    commandId: ports.createCommandId(),
    documentId: input.documentId,
    buildState: input.buildState,
    renderVersion: input.renderVersion,
    operation: input.operation,
  });
  if (!command) return { status: 'snapshot_unavailable' };

  let result: SlidesManualEditCommandResult;
  try {
    result = await ports.submit(command);
  } catch {
    // 第一次响应可能在 revision 已提交后丢失；同 commandId 重试由 backend receipt 收口。
    result = await ports.submit(command);
  }
  if (result.status === 'committed' || result.status === 'conflict') {
    await ports.refreshDocument(input.documentId);
  }
  return result;
}
