/**
 * @file toolRefreshPort.ts
 * @description 渲染端工具结果刷新端口。
 *
 * 中文说明：
 * - 通用工具消息组件只广播“工具状态变化”；
 * - 各插件自行判断是否关心某个工具，并在自己的 handler 内刷新；
 * - 避免 ToolCallsMessage 直接 import 某个插件的刷新实现。
 */

import type {
  RendererToolRefreshHandler,
  RendererToolRefreshTriggerParams,
} from '@linnya/plugin-host-contract/renderer/toolRefreshPort';

export type {
  RendererToolRefreshHandler,
  RendererToolRefreshTriggerParams,
} from '@linnya/plugin-host-contract/renderer/toolRefreshPort';

const handlers = new Map<string, RendererToolRefreshHandler>();

export function registerRendererToolRefreshHandler(handler: RendererToolRefreshHandler): void {
  if (handlers.has(handler.id)) return;
  handlers.set(handler.id, handler);
}

export function unregisterRendererToolRefreshHandler(id: string): void {
  handlers.delete(id);
}

export function listRendererToolRefreshHandlers(): RendererToolRefreshHandler[] {
  return Array.from(handlers.values());
}

export function clearRendererToolRefreshHandlersForTest(): void {
  handlers.clear();
}

export function useRegisteredRendererToolRefreshTriggers(
  params: RendererToolRefreshTriggerParams
): void {
  for (const handler of handlers.values()) {
    /**
     * 中文说明：这里不能用 handler.shouldHandle(params.toolName.value) 做 setup 阶段过滤。
     * 工具消息初次挂载时 toolName 可能还是占位值，后续投影补齐后才变成真实工具名；
     * 若提前跳过 handler，就永远不会安装响应式 watcher，文件工具写入后的刷新会丢失。
     */
    handler.useTrigger(params);
  }
}
