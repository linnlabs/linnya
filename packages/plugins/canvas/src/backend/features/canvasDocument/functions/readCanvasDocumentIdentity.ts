import { readWorkspaceDocumentIdentity } from '@plugin/backend/workspaceDocumentProjection';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import { CANVAS_DOCUMENT_TYPE } from '../../../../shared';
import { CanvasDocumentFailure } from '../definitions/canvasDocumentFailure';

export function readCanvasDocumentIdentity(database: Pick<CanvasDatabase, 'prepare'>, documentId: string, projectId?: string) {
  const node = readWorkspaceDocumentIdentity(database, documentId);
  if (!node || node.deletedAt !== null) throw new CanvasDocumentFailure('document_missing', '画布不存在或已删除');
  if (node.nodeType !== CANVAS_DOCUMENT_TYPE) throw new CanvasDocumentFailure('wrong_document_type', '目标不是 Linnya 画布');
  if (projectId !== undefined && node.projectId !== projectId) throw new CanvasDocumentFailure('outside_project', '不能读取其他项目的画布');
  return node;
}
