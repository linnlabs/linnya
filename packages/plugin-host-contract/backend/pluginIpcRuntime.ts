/**
 * 插件后端 IPC handler 的结构契约；handler 注册表仍由 host SDK 门面持有。
 */
export type BackendPluginIpcHandler = (
  event: unknown,
  payload: unknown
) => Promise<unknown> | unknown;

/** Host 创建的本地上下文；跨进程只传会话 ID，绝不把 Electron 对象交给插件。 */
export interface BackendPluginRendererContext {
  readonly rendererSessionId: string;
  readonly signal: AbortSignal;
}

export declare function readBackendPluginRendererContext(event: unknown): BackendPluginRendererContext | undefined;
