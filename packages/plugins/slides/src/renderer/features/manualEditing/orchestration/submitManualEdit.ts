import { SlidesIpcError } from '@plugin/slides/shared/ipc';
import type {
  SlidesManualEditCommandResult,
  SlidesManualEditCommandOperation,
} from '@plugin/slides/shared/authoringEditing';
import type { SlidesDocumentBuildState } from '@plugin/slides/shared/documentSource';
import { createManualEditCommand } from '../functions/createManualEditCommand';

import type { SubmitManualEditPorts, SubmitManualEditOutcome } from '../definitions/manualEditSubmission';

export async function submitManualEdit(input: {
  readonly documentId: string;
  readonly buildState: SlidesDocumentBuildState | null;
  readonly renderVersion: number | null;
  readonly operation: SlidesManualEditCommandOperation;
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
  ports.trace?.begin(command);

  let result: SlidesManualEditCommandResult;
  try {
    result = await ports.submit(command);
  } catch (error) {
    if (!(error instanceof SlidesIpcError) || !error.retryable) {
      ports.trace?.recordTransportFailure(command.commandId);
      throw error;
    }
    // 后端明确允许的临时失败才重试，沿用 commandId 保持回执幂等。
    ports.trace?.recordTransportRetry(command.commandId);
    try {
      result = await ports.submit(command);
    } catch (error) {
      ports.trace?.recordTransportFailure(command.commandId);
      throw error;
    }
  }
  ports.trace?.recordResponse(result);
  return result;
}
