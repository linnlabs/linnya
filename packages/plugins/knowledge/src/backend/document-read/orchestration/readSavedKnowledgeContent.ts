import type { KnowledgeDocumentSummary, KnowledgeSavedContent } from '@plugin/knowledge/shared';
import type { KnowledgeBaseService } from '../../application/knowledgeBaseService';
import type { SotRepository } from '../../infrastructure/sotRepository';

type DocumentReadPort = Pick<KnowledgeBaseService,
  'getDocumentsInKnowledgeBase' | 'getDocumentById' | 'getSoTDocumentForAgent'>;

/** 保存状态由目录一次投影；不为每篇列表文档读取完整原文或重复持久化标记。 */
export async function listKnowledgeDocumentsWithSource(
  service: DocumentReadPort,
  sot: Pick<SotRepository, 'listAllDocumentIds'>,
  kbId: string,
): Promise<KnowledgeDocumentSummary[]> {
  const documents = await service.getDocumentsInKnowledgeBase(kbId);
  const savedIds = new Set(await sot.listAllDocumentIds());
  return documents.map(document => ({ ...document, hasSource: savedIds.has(document.id) }));
}

/** 文件管理读取已保存内容不需要向量服务，但必须验证冻结的库/文档身份。 */
export async function readSavedKnowledgeContent(
  service: DocumentReadPort,
  target: { kbId: string; documentId: string },
  signal: AbortSignal,
): Promise<KnowledgeSavedContent> {
  signal.throwIfAborted();
  const document = await service.getDocumentById(target.documentId);
  if (!document || document.kbId !== target.kbId) throw new Error('文档不属于当前知识库');
  signal.throwIfAborted();
  const markdown = await service.getSoTDocumentForAgent(document.id);
  signal.throwIfAborted();
  return { documentId: document.id, fileName: document.filename, markdown };
}
