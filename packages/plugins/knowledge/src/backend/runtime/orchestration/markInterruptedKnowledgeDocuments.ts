import { DocumentStatus } from '../../domain/document';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';
import type { OriginalDocumentRepository } from '../../infrastructure/originalDocumentRepository';
import type { SotRepository } from '../../infrastructure/sotRepository';

export const ORPHANED_UNSAVED_DOCUMENT_MESSAGE =
  '上次处理没有完成，文件内容也没有保存（应用关闭、崩溃或早期版本的后台故障）。请删除后重新上传该文件。';

/** 只收尾本 activation 已接纳的任务。真实线程停止后再写，不能覆盖已成功落盘的文档。 */
export async function markInterruptedKnowledgeDocuments(
  metadata: MetadataRepository,
  tasks: readonly { docId: string; kbId: string }[],
  message = '知识库停用，中断了文档处理。已保存的内容仍保留，可重建检索索引；尚未保存内容的文件可重新上传。'
): Promise<void> {
  for (const task of tasks) {
    const document = await metadata.getDocumentById(task.docId);
    if (!document || document.kbId !== task.kbId) continue;
    if (document.status !== DocumentStatus.PENDING && document.status !== DocumentStatus.PROCESSING)
      continue;
    const updated = await metadata.updateDocumentStatus(
      task.docId,
      DocumentStatus.FAILED,
      message
    );
    if (!updated) throw new Error(`知识库中断状态未保存: ${task.docId}`);
  }
}

/**
 * 激活时本进程尚未接纳任何任务（同一 Workspace 只有一个后台写入者），仍为等待中/处理中的文档都来自上一个进程，
 * 没有任务会再推进它们。什么内容都没保存的立即标为失败并提示重新上传，避免界面一直显示处理中；
 * 已保存原文或内容的仍交给一致性维护判断（它们可能其实已完成，只差状态写回）。
 */
export async function markOrphanedUnsavedKnowledgeDocuments(input: {
  readonly metadata: Pick<MetadataRepository, 'getAllDocuments' | 'updateDocumentStatus'>;
  readonly sot: Pick<SotRepository, 'listAllDocumentIds'>;
  readonly originals: Pick<OriginalDocumentRepository, 'getPath'>;
}): Promise<readonly string[]> {
  const unfinished = (await input.metadata.getAllDocuments()).filter(
    document => document.status === DocumentStatus.PENDING || document.status === DocumentStatus.PROCESSING
  );
  if (unfinished.length === 0) return [];
  const saved = new Set(await input.sot.listAllDocumentIds());
  const marked: string[] = [];
  for (const document of unfinished) {
    if (saved.has(document.id) || (await input.originals.getPath(document.kbId, document.id))) continue;
    const updated = await input.metadata.updateDocumentStatus(
      document.id,
      DocumentStatus.FAILED,
      ORPHANED_UNSAVED_DOCUMENT_MESSAGE
    );
    if (!updated) throw new Error(`知识库未完成文档状态未保存: ${document.id}`);
    marked.push(document.id);
  }
  return marked;
}
