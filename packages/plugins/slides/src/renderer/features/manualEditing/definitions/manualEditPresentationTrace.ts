import type {
  SlidesManualEditCommand,
  SlidesManualEditCommandResult,
} from '@plugin/slides/shared/authoringEditing';

export interface ManualEditPresentationTracePort {
  begin(command: SlidesManualEditCommand): void;
  recordTransportRetry(commandId: string): void;
  recordResponse(result: SlidesManualEditCommandResult): void;
  recordTransportFailure(commandId: string): void;
  recordRefreshCompleted(commandId: string): void;
  recordPresented(documentId: string, revision: number): void;
  clear(): void;
}
