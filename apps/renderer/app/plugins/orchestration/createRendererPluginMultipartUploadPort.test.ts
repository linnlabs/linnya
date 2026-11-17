import { describe, expect, it, vi } from 'vitest';
import type { RendererPluginAvailabilityChange } from '@linnya/plugin-host-contract/renderer/pluginRuntime';
import type { RendererPluginMultipartRequest } from '@linnya/plugin-host-contract/renderer/pluginMultipartUpload';
import { createRendererPluginMultipartUploadPort } from './createRendererPluginMultipartUploadPort';

describe('trusted plugin upload admission', () => {
  it('仅精确登记的 owner/route 能交付 body，不把相对或外部 URL 变成目标', async () => {
    const post = vi.fn(async () => ({ id: 'accepted' }));
    const port = createRendererPluginMultipartUploadPort([
      { pluginId: 'knowledge', route: 'documents/upload', path: '/api/v1/plugins/knowledge/documents/upload' },
    ], { readAvailability: () => 'enabled', subscribeAvailability: () => () => {}, post });
    const formData = new FormData();
    formData.append('kbId', 'kb-one');
    for (const [pluginId, route] of [
      ['other', 'documents/upload'], ['knowledge', '../models'],
      ['knowledge', 'https://outside.example/upload'], ['knowledge', '/documents/upload'],
    ]) {
      await expect(port.upload(pluginId, route, { formData })).rejects.toThrow('not registered');
    }
    expect(post).not.toHaveBeenCalled();
    await expect(port.upload('knowledge', 'documents/upload', { formData })).resolves.toEqual({ id: 'accepted' });
    expect(post).toHaveBeenCalledWith('/api/v1/plugins/knowledge/documents/upload', expect.objectContaining({ formData }));
  });

  it('停用前拒绝新请求，停用中取消真实 transport 并撤销订阅', async () => {
    let enabled = false;
    let notify: (changes: readonly RendererPluginAvailabilityChange[]) => void = () => {};
    const unsubscribe = vi.fn();
    const post = vi.fn((_path: string, request: RendererPluginMultipartRequest) => new Promise((_resolve, reject) => {
      request.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    }));
    const port = createRendererPluginMultipartUploadPort([
      { pluginId: 'knowledge', route: 'documents/upload', path: '/api/v1/plugins/knowledge/documents/upload' },
    ], { readAvailability: () => enabled ? 'enabled' : 'disabled',
      subscribeAvailability: listener => { notify = listener; return unsubscribe; }, post });
    await expect(port.upload('knowledge', 'documents/upload', { formData: new FormData() })).rejects.toThrow('not enabled');
    expect(post).not.toHaveBeenCalled();
    enabled = true;
    const pending = port.upload('knowledge', 'documents/upload', { formData: new FormData() });
    notify([{ pluginId: 'knowledge', state: 'disabled', documentNodeTypes: [] }]);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('用户关闭上传时只中止该请求，清理订阅且不吞正式拒绝原因', async () => {
    const unsubscribe = vi.fn();
    const controller = new AbortController();
    const post = vi.fn((_path: string, request: RendererPluginMultipartRequest) => new Promise((_resolve, reject) => {
      request.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    }));
    const dependencies = { readAvailability: () => 'enabled' as const, subscribeAvailability: () => unsubscribe, post };
    const port = createRendererPluginMultipartUploadPort([
      { pluginId: 'knowledge', route: 'documents/upload', path: '/api/v1/plugins/knowledge/documents/upload' },
    ], dependencies);
    const pending = port.upload('knowledge', 'documents/upload', { formData: new FormData(), signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const reason = new Error('Source already saved; rebuild the existing index');
    post.mockRejectedValueOnce(reason);
    await expect(port.upload('knowledge', 'documents/upload', { formData: new FormData() })).rejects.toBe(reason);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});
