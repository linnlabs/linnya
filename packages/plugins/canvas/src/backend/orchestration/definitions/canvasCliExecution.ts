import type { BackendPluginCliExecutionContext } from '@plugin/backend/pluginCli';
import type { createDocumentReferenceMarkdownRuntime } from '@plugin/backend/documentReferences';
import type { CanvasDatabase } from '../../definitions/canvasDatabase';
import type { CanvasBackendCapabilities } from '../../definitions/canvasBackendCapabilities';
import type { CanvasDocumentRuntime } from '../createCanvasDocumentRuntime';
import type { CanvasCommitActor } from '../../features/canvasCommit';
export interface CanvasCliServices {
  readonly capabilities: CanvasBackendCapabilities;
  runtimeFor(database: CanvasDatabase): CanvasDocumentRuntime;
  referencesFor(
    database: CanvasDatabase
  ): ReturnType<typeof createDocumentReferenceMarkdownRuntime>;
}
export interface CanvasCliScope {
  readonly database: CanvasDatabase;
  readonly documentId: string;
  readonly projectId: string;
  readonly readerId: string;
  readonly actor: CanvasCommitActor;
  readonly context: BackendPluginCliExecutionContext;
  readonly conversationRoot: string;
}

export interface CanvasCliArrangementInput {
  readonly request: import('../../../shared').CanvasCommitRequest;
  readonly arrangement: import('../../../shared/cli/definitions/canvasCli').CanvasArrangeOptions;
  readonly scope: CanvasCliScope;
  readonly services: CanvasCliServices;
  readonly document: Pick<CanvasDocumentRuntime, 'editing'>;
}
