import type { BackendPluginRendererContext } from '@linnya/plugin-host-contract/backend/pluginIpcRuntime';

export type BackendRendererRequestContext = BackendPluginRendererContext;

/** Renderer 保持既有 Electron IPC channel；业务参数仍是 data-only。 */
export type BackendRendererRequestHandler = (
  ...args: readonly unknown[]
) => unknown | Promise<unknown>;

export interface BackendRendererRequestRegistrarPort {
  handle(channel: string, handler: BackendRendererRequestHandler): void;
}

export interface BackendRendererRequestRegistryPort extends BackendRendererRequestRegistrarPort {
  handleWithContext(channel: string, handler: (context: BackendRendererRequestContext | undefined, ...args: readonly unknown[]) => unknown | Promise<unknown>): void;
  listChannels(): readonly string[];
  invoke(channel: string, args: readonly unknown[], context?: BackendRendererRequestContext): Promise<unknown>;
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
