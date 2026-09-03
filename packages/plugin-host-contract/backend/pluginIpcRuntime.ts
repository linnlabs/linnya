/**
 * 插件后端 IPC handler 的结构契约；handler 注册表仍由 host SDK 门面持有。
 */
export type BackendPluginIpcHandler = (
  event: unknown,
  payload: unknown
) => Promise<unknown> | unknown;
