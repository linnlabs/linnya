import type { RendererPluginMultipartRequest, RendererPluginMultipartUploadPort } from '@linnya/plugin-host-contract/renderer/pluginMultipartUpload';
import type { RendererPluginAvailability, RendererPluginAvailabilityChange } from '@linnya/plugin-host-contract/renderer/pluginRuntime';

interface Dependencies {
  readAvailability(pluginId: string): RendererPluginAvailability;
  subscribeAvailability(listener: (changes: readonly RendererPluginAvailabilityChange[]) => void): () => void;
  post(path: string, request: RendererPluginMultipartRequest): Promise<unknown>;
}

const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]*$/u;

/** Host 只提供固定上传槽位；具体插件是否获准由 backend registry 的装配来源决定。 */
export function createRendererPluginMultipartUploadPort(
  dependencies: Dependencies,
): RendererPluginMultipartUploadPort {
  return {
    async upload(pluginId, route, request) {
      if (!PLUGIN_ID.test(pluginId) || route !== 'documents/upload') {
        throw new Error('Plugin multipart route is not registered');
      }
      if (dependencies.readAvailability(pluginId) !== 'enabled') throw new Error('Plugin is not enabled');
      request.signal?.throwIfAborted();
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      request.signal?.addEventListener('abort', abort, { once: true });
      const unsubscribe = dependencies.subscribeAvailability(changes => {
        if (changes.some(change => change.pluginId === pluginId && change.state !== 'enabled')) abort();
      });
      try {
        return await dependencies.post(
          `/api/v1/plugins/${encodeURIComponent(pluginId)}/documents/upload`,
          { ...request, signal: controller.signal },
        );
      } finally {
        request.signal?.removeEventListener('abort', abort);
        unsubscribe();
      }
    },
  };
}
