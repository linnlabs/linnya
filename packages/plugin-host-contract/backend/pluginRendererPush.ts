/**
 * 插件后端向 renderer 推送事件的 envelope 契约。
 */
export interface RendererPluginPushEnvelope {
  readonly pluginId: string;
  readonly channel: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export declare const PLUGIN_RENDERER_PUSH_CHANNEL: 'plugin:push';

export declare function broadcastRendererPluginMessage(
  pluginId: string,
  channel: string,
  payload: Readonly<Record<string, unknown>>,
): void;
