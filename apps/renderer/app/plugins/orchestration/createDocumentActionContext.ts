import type { DocumentActionMenuContext } from '../types';
import type { DocumentReferencePresentation } from '@app/schemas';

export type DocumentActionTarget = Omit<DocumentActionMenuContext, 'readMarkdownSnapshot'>;
export interface DocumentActionSnapshotPort {
  readPresentation(target: DocumentActionTarget): Promise<DocumentReferencePresentation>;
  readActiveMarkdown(target: DocumentActionTarget): string | null;
  readPersistedMarkdown(target: DocumentActionTarget): Promise<string>;
}

/** 冻结目标后才打开菜单；不把另一个活动编辑器的内容冒充被点击文档。 */
export function createDocumentActionContext(
  target: DocumentActionTarget,
  port: DocumentActionSnapshotPort,
): DocumentActionMenuContext {
  const frozen = Object.freeze({ ...target });
  if (frozen.activeDocumentType !== 'editor') return frozen;
  return Object.freeze({
    ...frozen,
    async readMarkdownSnapshot(signal: AbortSignal) {
      signal.throwIfAborted();
      // 同步捕获当前目标的未保存内容，之后的 await 不能换成另一个 editor。
      const active = port.readActiveMarkdown(frozen);
      const presentation = await port.readPresentation(frozen);
      signal.throwIfAborted();
      if (presentation.status !== 'available' || presentation.nodeType !== 'document') {
        throw new Error('文档已移除、移到其他项目或当前不可用');
      }
      const markdown = active ?? await port.readPersistedMarkdown(frozen);
      signal.throwIfAborted();
      return { markdown, displayName: presentation.title ?? frozen.displayName };
    },
  });
}
