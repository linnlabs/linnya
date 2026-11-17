import { beforeEach, describe, expect, it } from 'vitest';
import { activateRendererPlugin, clearRendererPluginRegistryForTest, deactivateRendererPlugin,
  getApplicationSurface, getDocumentActionMenuByActiveType, registerRendererPlugin,
  unregisterRendererPluginContribution } from '../registry';
import type { RendererPluginContribution } from '../types';
const component = { render: () => null };
function plugin(id = 'library'): RendererPluginContribution {
  return { meta: { id, name: 'Library', version: '1.0.0', description: 'Fixture', developer: 'Fixture', builtin: true },
    applicationSurface: { title: 'Library', iconComponent: component, pageComponent: component },
    documentActionMenus: [{ activeDocumentType: 'editor', tooltip: 'More', ariaLabel: 'More',
      isAvailable: () => true, getOptions: () => [{ value: 'add-to-kb', text: 'Add' }], select: () => undefined }] };
}
beforeEach(clearRendererPluginRegistryForTest);
describe('official application surface ownership', () => {
  it('自报builtin不授予页面权限；显式授信仍须运行态启用且激活成功', async () => {
    expect(() => registerRendererPlugin(plugin())).toThrow('显式授信');
    registerRendererPlugin(plugin(), { applicationSurfaceSlot: 'knowledge-base' });
    const enabled = new Set(['library']);
    expect(getApplicationSurface('knowledge-base', enabled)).toBeNull();
    expect(getDocumentActionMenuByActiveType('editor', enabled)).toBeNull();
    await activateRendererPlugin('library');
    expect(getApplicationSurface('knowledge-base', enabled)?.pluginId).toBe('library');
    expect(getApplicationSurface('knowledge-base', new Set())).toBeNull();
    expect(getDocumentActionMenuByActiveType('editor', enabled)).not.toBeNull();
    await deactivateRendererPlugin('library');
    expect(getApplicationSurface('knowledge-base', enabled)).toBeNull();
    expect(getDocumentActionMenuByActiveType('editor', enabled)).toBeNull();
    await activateRendererPlugin('library');
    unregisterRendererPluginContribution('library');
    expect(getApplicationSurface('knowledge-base', enabled)).toBeNull();
  });
  it('槽冲突不覆盖owner，激活失败也不暴露页面', async () => {
    const contribution = { ...plugin(), activate: async () => { throw new Error('failed'); } };
    registerRendererPlugin(contribution, { applicationSurfaceSlot: 'knowledge-base' });
    expect(() => registerRendererPlugin(plugin('other'), { applicationSurfaceSlot: 'knowledge-base' })).toThrow('占用');
    await expect(activateRendererPlugin('library')).rejects.toThrow('failed');
    expect(getApplicationSurface('knowledge-base', new Set(['library', 'other']))).toBeNull();
    unregisterRendererPluginContribution('library');
    registerRendererPlugin(plugin('other'), { applicationSurfaceSlot: 'knowledge-base' });
    await activateRendererPlugin('other');
    expect(getApplicationSurface('knowledge-base', new Set(['other']))?.pluginId).toBe('other');
  });
});
