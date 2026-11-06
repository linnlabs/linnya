import { readConversationProjectId } from '@plugin/backend/conversationProjection';
import { readWorkspaceDocumentLocation } from '@plugin/backend/workspaceDocumentProjection';
import {
  CanvasClipboardRequestSchema,
  CanvasClipboardSchema,
  CanvasSelectionContextRequestSchema,
  CanvasSelectionContextSchema,
} from '../../shared/context/definitions/canvasSelectionContext';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import { readCanvasSnapshot } from '../features/canvasCommit';
import {
  readCanvasDocumentIdentity,
  readCanvasProjectionContext,
  CanvasDocumentFailure,
} from '../features/canvasDocument';
import { projectCanvasSelection } from '../features/canvasProjection';

function readSelection(
  database: CanvasDatabase,
  input: ReturnType<typeof CanvasSelectionContextRequestSchema.parse>
) {
  const projectId =
    input.conversationId === undefined
      ? input.projectId
      : readConversationProjectId(database, input.conversationId);
  if (projectId === null)
    throw new CanvasDocumentFailure('outside_project', '当前对话没有可访问此画布的项目');
  readCanvasDocumentIdentity(database, input.documentId, projectId);
  const location = readWorkspaceDocumentLocation(database, input.documentId);
  if (!location) throw new CanvasDocumentFailure('document_missing', '画布已删除或无法定位');
  const snapshot = readCanvasSnapshot(database, input.documentId);
  const present = new Set<string>(snapshot.elements.map(element => element.id));
  const remaining = [...new Set(input.elementIds)].filter(id => present.has(id));
  const context = CanvasSelectionContextSchema.parse({
    documentId: input.documentId,
    sequence: snapshot.sequence,
    elementIds: remaining,
    path: location.path,
    text: remaining.length
      ? projectCanvasSelection({
          snapshot,
          elementIds: remaining,
          path: location.path,
          context: readCanvasProjectionContext(database, snapshot),
          format: input.format,
        })
      : `画布 ${location.path}；提交序号 ${snapshot.sequence}；原所选卡片已全部删除。本引用仅包含删除说明，不含卡片正文。`,
  });
  return { context, snapshot };
}

export function readCanvasSelectionContext(database: CanvasDatabase, value: unknown) {
  return readSelection(database, CanvasSelectionContextRequestSchema.parse(value)).context;
}
export function readCanvasClipboard(database: CanvasDatabase, value: unknown) {
  const input = CanvasClipboardRequestSchema.parse(value);
  const { context, snapshot } = readSelection(database, { ...input, format: 'markdown' });
  // 发送引用有“已删除”语义；复制/剪切没有有效元素时不能改写剪贴板。
  if (!context.elementIds.length)
    throw new CanvasDocumentFailure('document_missing', '所选卡片已全部移除，没有可复制的内容');
  const selected = new Set<string>(context.elementIds);
  return CanvasClipboardSchema.parse({
    ...context,
    elements: snapshot.elements.filter(element => selected.has(element.id)),
  });
}
