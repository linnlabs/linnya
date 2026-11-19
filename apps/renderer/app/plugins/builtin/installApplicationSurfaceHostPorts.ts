import { installRendererModelConfigurationPort } from '@plugin/renderer/modelConfiguration';
import { installRendererPluginMultipartUploadPort } from '@plugin/renderer/pluginMultipartUpload';
import { readRendererPluginAvailability, subscribeRendererPluginAvailability } from '@plugin/renderer/pluginRuntime';
import { apiMultipartPost } from '@/shared/services/localApiClient';
import { createRendererModelConfigurationPort } from '../orchestration/createRendererModelConfigurationPort';
import { createRendererPluginMultipartUploadPort } from '../orchestration/createRendererPluginMultipartUploadPort';

/** 产品组合根只安装固定上传槽位；具体插件是否获准由 backend 装配来源决定。 */
export function installApplicationSurfaceHostPorts(): void {
  installRendererModelConfigurationPort(createRendererModelConfigurationPort());
  installRendererPluginMultipartUploadPort(createRendererPluginMultipartUploadPort({
    readAvailability: readRendererPluginAvailability,
    subscribeAvailability: subscribeRendererPluginAvailability,
    post: (path, request) => apiMultipartPost(path, request.formData, request),
  }));
}
