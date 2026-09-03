/**
 * @file pluginDocumentCreationPort.ts
 * @description 插件自定义文档创建通道。
 *
 * 中文说明：
 * - workspace tree store 只负责“按已注册文档类型发起创建”；
 * - 插件专属 IPC 或初始化规则由插件注册的窄 handler 承接，避免 host 写死某个插件。
 */

import type { PluginDocumentCreationHandler } from '@linnya/plugin-host-contract/renderer/pluginDocumentCreationPort';

export type {
  PluginDocumentCreateRequest,
  PluginDocumentCreationHandler,
} from '@linnya/plugin-host-contract/renderer/pluginDocumentCreationPort';

const handlersById = new Map<string, PluginDocumentCreationHandler>();

export function registerPluginDocumentCreationHandler(handler: PluginDocumentCreationHandler): void {
  const id = handler.id.trim();
  if (!id) {
    throw new Error('[pluginDocumentCreationPort] handler id 不能为空');
  }
  handlersById.set(id, handler);
}

export function unregisterPluginDocumentCreationHandler(id: string): void {
  handlersById.delete(id.trim());
}

export function getPluginDocumentCreationHandler(id: string): PluginDocumentCreationHandler {
  const handler = handlersById.get(id);
  if (!handler) {
    throw new Error(`[pluginDocumentCreationPort] 未注册插件文档创建器: ${id}`);
  }
  return handler;
}

export function clearPluginDocumentCreationHandlersForTest(): void {
  handlersById.clear();
}
