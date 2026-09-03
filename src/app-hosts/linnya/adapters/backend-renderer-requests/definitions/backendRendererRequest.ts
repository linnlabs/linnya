/** Renderer 保持既有 Electron IPC channel；Backend handler 只接收 data-only 参数。 */
export type BackendRendererRequestHandler = (
  ...args: readonly unknown[]
) => unknown | Promise<unknown>;

export interface BackendRendererRequestRegistrarPort {
  handle(channel: string, handler: BackendRendererRequestHandler): void;
}

export interface BackendRendererRequestRegistryPort extends BackendRendererRequestRegistrarPort {
  listChannels(): readonly string[];
  invoke(channel: string, args: readonly unknown[]): Promise<unknown>;
}

/**
 * 迁移现有 handler 时保留 `ipcMain.handle` 的参数形状，但首个 event 永远是 undefined。
 * Backend 不得读取 sender；Desktop sender admission 只能留在 Electron adapter。
 */
export type BackendRendererIpcStyleHandler = {
  bivarianceHack(
    event: undefined,
    ...args: readonly unknown[]
  ): unknown | Promise<unknown>;
}['bivarianceHack'];

export interface BackendRendererIpcStyleRegistrarPort {
  handle(channel: string, handler: BackendRendererIpcStyleHandler): void;
}
