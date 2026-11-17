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

/** 仅固定上传路由能创建；普通 JSON IPC 不能授予本机文件访问。 */
export interface BackendPluginUploadContext {
  readonly file: { readonly path: string; readonly name: string; readonly size: number };
  readonly signal: AbortSignal;
  /** 任务正式接纳文件后调用；此前所有退出路径由 Host 删除临时上传。 */
  acceptFile(): void;
}

export declare function readBackendPluginUploadContext(
  event: unknown
): BackendPluginUploadContext | undefined;
