/**
 * @file pluginRendererPush.ts
 * @description 插件后端向 renderer 推送事件的通用门面。
 *
 * 中文说明：插件 push 统一封装成 `plugin:push` envelope，preload 只需要一个
 * 稳定白名单。具体业务 channel 由插件 backend contribution 声明，发送前按
 * enabled runtime 和声明表校验，避免插件事件回到 host 静态白名单。
 */

import type { RendererPluginPushEnvelope } from '@linnya/plugin-host-contract/backend/pluginRendererPush';
import { getBackendRendererIntegrationPort } from 'src/app-hosts/linnya/desktop-capabilities';
import { getRegisteredBackendPluginRendererPushChannels } from 'src/app-hosts/linnya/plugin-registry/builtin';
import { getPluginRuntimeState } from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';

export const PLUGIN_RENDERER_PUSH_CHANNEL = 'plugin:push';

export type {
  RendererPluginPushEnvelope,
} from '@linnya/plugin-host-contract/backend/pluginRendererPush';

export function broadcastRendererPluginMessage(
  pluginId: string,
  channel: string,
  payload: Readonly<Record<string, unknown>>,
): void {
  const normalizedPluginId = pluginId.trim();
  const normalizedChannel = channel.trim();
  if (!normalizedPluginId || !normalizedChannel) {
    throw new Error('[pluginRendererPush] pluginId/channel 不能为空');
  }
  const runtimeState = getPluginRuntimeState(normalizedPluginId);
  if (runtimeState !== 'enabled') {
    throw new Error(`[pluginRendererPush] 插件未启用，不能发送 renderer push: ${normalizedPluginId}/${normalizedChannel}`);
  }
  const declaredChannels = getRegisteredBackendPluginRendererPushChannels(normalizedPluginId);
  if (!declaredChannels.includes(normalizedChannel)) {
    throw new Error(`[pluginRendererPush] 插件未声明 renderer push channel: ${normalizedPluginId}/${normalizedChannel}`);
  }

  const envelope: RendererPluginPushEnvelope = {
    pluginId: normalizedPluginId,
    channel: normalizedChannel,
    payload,
  };
  getBackendRendererIntegrationPort().publishPluginRendererPush(envelope);
}
