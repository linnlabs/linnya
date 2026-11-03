import { readConversationProjectId } from '@plugin/backend/conversationProjection';
import { readWorkspaceDocumentLocation } from '@plugin/backend/workspaceDocumentProjection';
import { CanvasSelectionContextRequestSchema, CanvasSelectionContextSchema } from '../../shared/context/definitions/canvasSelectionContext';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import { readCanvasSnapshot } from '../features/canvasCommit';
import { readCanvasDocumentIdentity, readCanvasProjectionContext, CanvasDocumentFailure } from '../features/canvasDocument';
import { projectCanvasSelection } from '../features/canvasProjection';

export function readCanvasSelectionContext(database: CanvasDatabase, value: unknown) {
  const input = CanvasSelectionContextRequestSchema.parse(value);
  const projectId = input.conversationId === undefined ? undefined : readConversationProjectId(database, input.conversationId);
  if (projectId === null) throw new CanvasDocumentFailure('outside_project', '当前对话没有可访问此画布的项目');
  readCanvasDocumentIdentity(database, input.documentId, projectId);
  const location = readWorkspaceDocumentLocation(database, input.documentId);
  if (!location) throw new CanvasDocumentFailure('document_missing', '画布已删除或无法定位');
  const snapshot = readCanvasSnapshot(database, input.documentId);
  const present = new Set<string>(snapshot.elements.map(element => element.id));
  if (input.elementIds.some(id => !present.has(id))) throw new CanvasDocumentFailure('document_missing', '所选卡片已被移除，请重新选择后发送');
  return CanvasSelectionContextSchema.parse({ documentId: input.documentId, sequence: snapshot.sequence,
    elementIds: [...new Set(input.elementIds)], path: location.path,
    text: projectCanvasSelection(snapshot, input.elementIds, location.path, readCanvasProjectionContext(database, snapshot)),
  });
}
