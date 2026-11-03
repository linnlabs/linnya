/**
 * @file pluginIpcClient.ts
 * @description 渲染端插件 IPC 泛型调用客户端。
 */

import type { OperationResult } from './workspaceRuntime';
import type { RendererPluginIpcResult } from '@linnya/plugin-host-contract/renderer/pluginIpcClient';

export type {
  OperationResult,
} from '@linnya/plugin-host-contract/renderer/workspaceRuntime';
export type { RendererPluginIpcResult } from '@linnya/plugin-host-contract/renderer/pluginIpcClient';

interface PluginInvokeElectronApi {
  'plugin:invoke': (pluginId: string, channel: string, payload: unknown) => Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOperationResult(value: unknown): value is OperationResult<unknown> {
  if (!isRecord(value)) return false;
  if (value.success === true) return true;
  return value.success === false && typeof value.error === 'string';
}

function getPluginInvokeApi(): PluginInvokeElectronApi {
  const api = (window as Window & { electronAPI?: unknown }).electronAPI;
  if (!isRecord(api) || typeof api['plugin:invoke'] !== 'function') {
    throw new Error('[pluginIpcClient] window.electronAPI.plugin:invoke is not available');
  }
  return {
    'plugin:invoke': api['plugin:invoke'] as PluginInvokeElectronApi['plugin:invoke'],
  };
}

export function invokeRendererPluginIpc<T>(
  pluginId: string,
  channel: string,
  payload: unknown,
): Promise<RendererPluginIpcResult<T>>;
export async function invokeRendererPluginIpc(
  pluginId: string,
  channel: string,
  payload: unknown
): Promise<RendererPluginIpcResult<unknown>> {
  try {
    const result = await getPluginInvokeApi()['plugin:invoke'](pluginId, channel, payload);
    if (!isOperationResult(result)) {
      return {
        success: false,
        error: `[pluginIpcClient] 插件 IPC 返回值结构异常: ${pluginId}/${channel}`,
        failureKind: 'delivery_unknown',
      };
    }
    if (!result.success) return { success: false, error: result.error, failureKind: 'application' };
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      // invoke抛出时不能证明Handler未执行；写调用方必须复用同一请求身份确认。
      failureKind: 'delivery_unknown',
    };
  }
}
