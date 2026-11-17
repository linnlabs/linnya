import { DocumentStatus } from '../../domain/document';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';

/** 只收尾本 activation 已接纳的任务。真实线程停止后再写，不能覆盖已成功落盘的文档。 */
export async function markInterruptedKnowledgeDocuments(
  metadata: MetadataRepository,
  tasks: readonly { docId: string; kbId: string }[]
): Promise<void> {
  for (const task of tasks) {
    const document = await metadata.getDocumentById(task.docId);
    if (!document || document.kbId !== task.kbId) continue;
    if (document.status !== DocumentStatus.PENDING && document.status !== DocumentStatus.PROCESSING)
      continue;
    await metadata.updateDocumentStatus(
      task.docId,
      DocumentStatus.FAILED,
      '知识库停用，中断了文档处理。已保存的内容仍保留，可重建检索索引；尚未保存内容的文件可重新上传。'
    );
  }
}
