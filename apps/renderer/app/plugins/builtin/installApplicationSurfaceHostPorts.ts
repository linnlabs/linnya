import { installRendererModelConfigurationPort } from '@plugin/renderer/modelConfiguration';
import { installRendererPluginMultipartUploadPort } from '@plugin/renderer/pluginMultipartUpload';
import { readRendererPluginAvailability, subscribeRendererPluginAvailability } from '@plugin/renderer/pluginRuntime';
import { apiMultipartPost } from '@/shared/services/localApiClient';
import { createRendererModelConfigurationPort } from '../orchestration/createRendererModelConfigurationPort';
import { createRendererPluginMultipartUploadPort } from '../orchestration/createRendererPluginMultipartUploadPort';

/** 编译期产品装配拥有上传授信；磁盘插件贡献不能自行增加 route。 */
export function installApplicationSurfaceHostPorts(): void {
  installRendererModelConfigurationPort(createRendererModelConfigurationPort());
  installRendererPluginMultipartUploadPort(createRendererPluginMultipartUploadPort([
    { pluginId: 'knowledge', route: 'documents/upload', path: '/api/v1/plugins/knowledge/documents/upload' },
  ], {
    readAvailability: readRendererPluginAvailability,
    subscribeAvailability: subscribeRendererPluginAvailability,
    post: (path, request) => apiMultipartPost(path, request.formData, request),
  }));
}
