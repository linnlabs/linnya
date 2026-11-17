export interface RendererPluginUploadProgress {
  readonly loaded: number;
  readonly total?: number;
}
export interface RendererPluginMultipartRequest {
  readonly formData: FormData;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RendererPluginUploadProgress) => void;
}
export interface RendererPluginMultipartUploadPort {
  upload(pluginId: string, route: string, request: RendererPluginMultipartRequest): Promise<unknown>;
}

/** 只允许 Host 组合根登记的同源 multipart POST；结果由插件正式 schema 解码。 */
export declare function uploadRendererPluginMultipart(
  pluginId: string,
  route: string,
  request: RendererPluginMultipartRequest,
): Promise<unknown>;
