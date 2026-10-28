import { useSlidesDocumentRuntime } from '../../features/documentRuntime';

/** 完整快照读取失败保留 committed receipt；只重试刷新。 */
export async function refreshSlidesDocumentPresentation(documentId: string, revision?: number): Promise<void> {
  await useSlidesDocumentRuntime().refreshDeck(documentId, revision);
}
