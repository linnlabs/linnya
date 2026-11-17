import type { RendererPluginMultipartRequest, RendererPluginMultipartUploadPort } from '@linnya/plugin-host-contract/renderer/pluginMultipartUpload';
import type { RendererPluginAvailability, RendererPluginAvailabilityChange } from '@linnya/plugin-host-contract/renderer/pluginRuntime';

export interface TrustedPluginMultipartRoute {
  readonly pluginId: string;
  readonly route: string;
  readonly path: string;
}

interface Dependencies {
  readAvailability(pluginId: string): RendererPluginAvailability;
  subscribeAvailability(listener: (changes: readonly RendererPluginAvailabilityChange[]) => void): () => void;
  post(path: string, request: RendererPluginMultipartRequest): Promise<unknown>;
}

/** route 表仅由产品组合根传入；调用方不能控制 URL 或把自己的 ID 当作授信事实。 */
export function createRendererPluginMultipartUploadPort(
  routes: readonly TrustedPluginMultipartRoute[],
  dependencies: Dependencies,
): RendererPluginMultipartUploadPort {
  const targets = routes.map(target => {
    if (!target.path.startsWith('/api/v1/plugins/') || target.path.includes('..') || target.path.includes('\\')) {
      throw new Error('Invalid trusted plugin multipart route');
    }
    return Object.freeze({ ...target });
  });
  return {
    async upload(pluginId, route, request) {
      const target = targets.find(item => item.pluginId === pluginId && item.route === route);
      if (!target) throw new Error('Plugin multipart route is not registered');
      if (dependencies.readAvailability(pluginId) !== 'enabled') throw new Error('Plugin is not enabled');
      request.signal?.throwIfAborted();
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      request.signal?.addEventListener('abort', abort, { once: true });
      const unsubscribe = dependencies.subscribeAvailability(changes => {
        if (changes.some(change => change.pluginId === pluginId && change.state !== 'enabled')) abort();
      });
      try {
        return await dependencies.post(target.path, { ...request, signal: controller.signal });
      } finally {
        request.signal?.removeEventListener('abort', abort);
        unsubscribe();
      }
    },
  };
}
