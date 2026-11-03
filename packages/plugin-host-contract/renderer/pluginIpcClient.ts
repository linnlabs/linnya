export type RendererPluginIpcResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string; readonly failureKind: 'application' | 'delivery_unknown' };

export declare function invokeRendererPluginIpc<T>(
  pluginId: string,
  channel: string,
  payload: unknown,
): Promise<RendererPluginIpcResult<T>>;
