import type {
  RendererPluginMultipartRequest,
  RendererPluginMultipartUploadPort,
} from '@linnya/plugin-host-contract/renderer/pluginMultipartUpload';

export type * from '@linnya/plugin-host-contract/renderer/pluginMultipartUpload';

let port: RendererPluginMultipartUploadPort | null = null;

/** Host-only 安装；不经 artifact host module 或 shim 导出。 */
export function installRendererPluginMultipartUploadPort(next: RendererPluginMultipartUploadPort): void {
  port = next;
}

export function uploadRendererPluginMultipart(
  pluginId: string,
  route: string,
  request: RendererPluginMultipartRequest,
): Promise<unknown> {
  if (!port) throw new Error('Renderer plugin multipart upload port is not installed');
  return port.upload(pluginId, route, request);
}
