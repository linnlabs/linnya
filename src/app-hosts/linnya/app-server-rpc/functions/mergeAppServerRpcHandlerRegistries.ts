import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../definitions/appServerRpcPeer';

/** composition root 合并窄 capability；method 冲突是启动错误，禁止后注册静默覆盖。 */
export function mergeAppServerRpcHandlerRegistries(
  registries: readonly AppServerRpcHandlerRegistry[],
): AppServerRpcHandlerRegistry {
  const merged = new Map<string, AppServerRpcHandler>();
  for (const registry of registries) {
    for (const [method, handler] of registry) {
      if (merged.has(method)) throw new Error(`App Server RPC method 重复注册: ${method}`);
      merged.set(method, handler);
    }
  }
  return merged;
}
