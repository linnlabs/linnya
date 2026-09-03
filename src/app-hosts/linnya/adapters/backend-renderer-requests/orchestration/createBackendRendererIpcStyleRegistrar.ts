import type {
  BackendRendererIpcStyleRegistrarPort,
  BackendRendererRequestRegistrarPort,
} from '../definitions/backendRendererRequest';

/** 只用于把既有 Electron-style handler 平滑迁到 data-only Backend 注册表。 */
export function createBackendRendererIpcStyleRegistrar(
  registrar: BackendRendererRequestRegistrarPort,
): BackendRendererIpcStyleRegistrarPort {
  const adapter: BackendRendererIpcStyleRegistrarPort = {
    handle(channel, handler) {
      registrar.handle(channel, (...args) => handler(undefined, ...args));
    },
  };
  return Object.freeze(adapter);
}
