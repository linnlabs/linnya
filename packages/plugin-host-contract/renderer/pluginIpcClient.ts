import type { OperationResult } from './workspaceRuntime';

export declare function invokeRendererPluginIpc<T>(
  pluginId: string,
  channel: string,
  payload: unknown,
): Promise<OperationResult<T>>;
