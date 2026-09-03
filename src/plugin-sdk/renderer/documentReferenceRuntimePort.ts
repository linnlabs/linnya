/**
 * @file documentReferenceRuntimePort.ts
 * @description 渲染端文档引用运行时能力注册表。
 *
 * 中文说明：
 * - host 只知道“某类文档可以列出可引用 ID、等待打开完成、聚焦引用目标”；
 * - 具体数据结构和 DOM 选择细节留在对应插件内部，避免主应用静态依赖插件实现。
 */

import type { DocumentReferenceRuntimeHandler } from '@linnya/plugin-host-contract/renderer/documentReferenceRuntimePort';

export type {
  DocumentReferenceFocusResult,
  DocumentReferenceFocusStatus,
  DocumentReferenceRuntimeHandler,
} from '@linnya/plugin-host-contract/renderer/documentReferenceRuntimePort';

const handlersByDocumentType = new Map<string, DocumentReferenceRuntimeHandler>();

export function registerDocumentReferenceRuntimeHandler(handler: DocumentReferenceRuntimeHandler): void {
  const documentType = handler.documentType.trim();
  if (!documentType) {
    throw new Error('[documentReferenceRuntimePort] documentType 不能为空');
  }
  handlersByDocumentType.set(documentType, handler);
}

export function unregisterDocumentReferenceRuntimeHandler(documentType: string): void {
  handlersByDocumentType.delete(documentType.trim());
}

export function getDocumentReferenceRuntimeHandler(documentType: string): DocumentReferenceRuntimeHandler | null {
  return handlersByDocumentType.get(documentType) ?? null;
}

export function listDocumentReferenceRuntimeHandlers(): readonly DocumentReferenceRuntimeHandler[] {
  return Array.from(handlersByDocumentType.values());
}

export function clearDocumentReferenceRuntimeHandlersForTest(): void {
  handlersByDocumentType.clear();
}
