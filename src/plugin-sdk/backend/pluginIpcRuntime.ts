import type { BackendPluginIpcHandler } from '@linnya/plugin-host-contract/backend/pluginIpcRuntime';

export type {
  BackendPluginIpcHandler,
} from '@linnya/plugin-host-contract/backend/pluginIpcRuntime';

const handlersByPluginAndChannel = new Map<string, BackendPluginIpcHandler>();

function keyOf(pluginId: string, channel: string): string {
  return `${pluginId}:${channel}`;
}

export function registerBackendPluginIpcHandler(
  pluginId: string,
  channel: string,
  handler: BackendPluginIpcHandler
): void {
  const normalizedPluginId = pluginId.trim();
  const normalizedChannel = channel.trim();
  if (!normalizedPluginId || !normalizedChannel) {
    throw new Error('[pluginIpcRuntime] pluginId/channel 不能为空');
  }

  handlersByPluginAndChannel.set(keyOf(normalizedPluginId, normalizedChannel), handler);
}

export function clearBackendPluginIpcHandlersForPlugin(pluginId: string): void {
  const normalizedPluginId = pluginId.trim();
  if (!normalizedPluginId) {
    throw new Error('[pluginIpcRuntime] pluginId 不能为空');
  }
  const prefix = `${normalizedPluginId}:`;
  for (const key of Array.from(handlersByPluginAndChannel.keys())) {
    if (key.startsWith(prefix)) {
      handlersByPluginAndChannel.delete(key);
    }
  }
}

export function hasBackendPluginIpcHandler(pluginId: string, channel: string): boolean {
  return handlersByPluginAndChannel.has(keyOf(pluginId, channel));
}

export async function invokeBackendPluginIpcHandler(
  pluginId: string,
  channel: string,
  event: unknown,
  payload: unknown
): Promise<unknown> {
  const handler = handlersByPluginAndChannel.get(keyOf(pluginId, channel));
  if (!handler) {
    throw new Error(`[pluginIpcRuntime] 未注册插件 IPC handler: ${pluginId}/${channel}`);
  }
  return handler(event, payload);
}

export function clearBackendPluginIpcHandlersForTest(): void {
  handlersByPluginAndChannel.clear();
}
