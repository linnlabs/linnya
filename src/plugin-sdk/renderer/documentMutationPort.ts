/**
 * @file documentMutationPort.ts
 * @description 渲染端文档版本变更端口。
 *
 * 中文说明：
 * - host 只判断当前打开文档是否命中 workspace.document.updated；
 * - 具体怎么刷新由文档类型自己的 renderer handler 决定；
 * - 这避免 workspace shell 直接 import 具体插件的内部 store。
 */

import type {
  RendererDocumentMutationEvent,
  RendererDocumentMutationHandler,
} from '@linnya/plugin-host-contract/renderer/documentMutationPort';

export type {
  RendererDocumentMutationEvent,
  RendererDocumentMutationHandler,
} from '@linnya/plugin-host-contract/renderer/documentMutationPort';

const handlers = new Map<string, RendererDocumentMutationHandler>();

export function registerRendererDocumentMutationHandler(handler: RendererDocumentMutationHandler): void {
  if (handlers.has(handler.id)) return;
  handlers.set(handler.id, handler);
}

export function unregisterRendererDocumentMutationHandler(id: string): void {
  handlers.delete(id);
}

export function clearRendererDocumentMutationHandlersForTest(): void {
  handlers.clear();
}

export async function notifyRendererDocumentMutationHandlers(event: RendererDocumentMutationEvent): Promise<void> {
  for (const handler of handlers.values()) {
    if (handler.nodeType && handler.nodeType !== event.nodeType) continue;
    if (handler.activeDocumentType && handler.activeDocumentType !== event.activeDocumentType) continue;
    await handler.handleMutation(event);
  }
}
