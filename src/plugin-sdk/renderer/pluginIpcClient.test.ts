// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { invokeRendererPluginIpc } from './pluginIpcClient';
afterEach(() => vi.unstubAllGlobals());
it('保留业务拒绝与投递结果不确定的区别，不能把运输失败当未执行', async () => {
  const invoke = vi.fn().mockResolvedValueOnce({ success: false, error: 'permission denied' }).mockRejectedValueOnce(new Error('channel closed')).mockResolvedValueOnce({ malformed: true }).mockResolvedValueOnce({ success: true, data: { sequence: 1 } });
  vi.stubGlobal('window', { electronAPI: { 'plugin:invoke': invoke } });
  expect(await invokeRendererPluginIpc('plugin', 'write', {})).toMatchObject({ success: false, failureKind: 'application' });
  expect(await invokeRendererPluginIpc('plugin', 'write', {})).toMatchObject({ success: false, failureKind: 'delivery_unknown' });
  expect(await invokeRendererPluginIpc('plugin', 'write', {})).toMatchObject({ success: false, failureKind: 'delivery_unknown' });
  expect(await invokeRendererPluginIpc('plugin', 'write', {})).toEqual({ success: true, data: { sequence: 1 } });
});
