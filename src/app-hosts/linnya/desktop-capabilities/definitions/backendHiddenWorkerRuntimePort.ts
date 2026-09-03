import type {
  HiddenWorkerDefinition,
  HiddenWorkerRegistrationOptions,
} from '@linnya/plugin-host-contract/backend/hiddenWorkerRuntime';

/**
 * Backend 使用隐藏 Renderer worker 的窄宿主能力。
 *
 * Worker 声明和 codec 属于 Backend 插件运行态；BrowserWindow、IPC、进程回收属于
 * Desktop Host。把两者隔在这个端口两侧，避免 headless Backend 直接依赖 Electron。
 */
export interface BackendHiddenWorkerRuntimePort {
  registerHiddenWorker(
    definition: HiddenWorkerDefinition,
    options?: HiddenWorkerRegistrationOptions,
  ): Promise<void>;
  unregisterHiddenWorker(workerId: string): Promise<boolean>;
  hasHiddenWorker(workerId: string): boolean;
  listHiddenWorkerIds(): readonly string[];
  ensureHiddenWorkerReady(workerId: string): Promise<void>;
  touchHiddenWorker(workerId: string): void;
  invokeHiddenWorker(
    workerId: string,
    request: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
}
