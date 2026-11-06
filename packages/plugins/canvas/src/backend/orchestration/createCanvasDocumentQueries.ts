import type { BackendPluginRendererContext } from '@plugin/backend/pluginIpcRuntime';
import type { CanvasSnapshot } from '../../shared';
import { readCanvasSnapshot, readCanvasSynchronization } from '../features/canvasCommit';
import {
  readCanvasDocumentIdentity,
  readCanvasProjectionContext,
} from '../features/canvasDocument';
import { projectCanvasDocument } from '../features/canvasProjection';
import type { CanvasDocumentQueryDependencies } from '../definitions/canvasDocumentCommands';
/** 显式读取可登记视图，其余查询只验证文档身份而不额外读取全量内容。 */
export function createCanvasDocumentQueries(options: CanvasDocumentQueryDependencies) {
  const { database, assertActive, views, editing } = options;
  function assertDocument(documentId: string, projectId?: string) {
    assertActive();
    return readCanvasDocumentIdentity(database, documentId, projectId);
  }
  function read(
    documentId: string,
    projectId?: string,
    viewId?: string,
    context?: BackendPluginRendererContext
  ): CanvasSnapshot {
    assertDocument(documentId, projectId);
    if (viewId) {
      views.register(documentId, viewId, context);
      editing.registerView({ documentId, viewId });
    }
    return readCanvasSnapshot(database, documentId);
  }
  function project(documentId: string): string {
    const snapshot = read(documentId);
    return projectCanvasDocument(snapshot, readCanvasProjectionContext(database, snapshot));
  }
  function changes(documentId: string, afterSequence: number) {
    assertActive();
    readCanvasDocumentIdentity(database, documentId);
    return readCanvasSynchronization(database, { documentId, afterSequence });
  }
  return { assertDocument, read, project, changes };
}
