import type { ToolContext } from '../../types';
import type { Document } from '../../../features/knowledge-base/domain/document';
import { assertDocumentKbAllowedInScope, resolveKnowledgeBaseScopeFromContext } from './projectKnowledgeBaseScope';

/**
 * 先接纳整批文档的项目归属，再允许调用方物化SoT、图谱或引用。
 * 子Agent的选择和旧judge结果只是文档身份，不能当作仍然有效的读取授权。
 */
export async function resolveKnowledgeDocumentsInScope(
  context: ToolContext,
  documentIds: readonly string[],
): Promise<ReadonlyMap<string, Document>> {
  const scope = resolveKnowledgeBaseScopeFromContext(context);
  const documents = new Map<string, Document>();
  for (const documentId of new Set(documentIds)) {
    const service = context.knowledgeBaseService;
    if (!service) throw new Error('Knowledge base service not available in context');
    const document = await service.getDocumentById(documentId);
    if (!document) throw new Error(`知识库文档不存在：doc_id="${documentId}"`);
    assertDocumentKbAllowedInScope(scope, document.kbId, documentId);
    documents.set(documentId, document);
  }
  return documents;
}
