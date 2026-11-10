import { nextTick, reactive } from 'vue';
import { beforeEach, expect, it, vi } from 'vitest';
import type { RendererPluginAvailabilityChange } from '@linnya/plugin-host-contract/renderer/pluginRuntime';
const fixture = vi.hoisted(() => ({ store: { states: [] as { meta: { id: string }; state: 'enabled' | 'disabled' | 'missing' }[], getPluginState: vi.fn() }, registry: vi.fn(), revision: { value: 0 } }));
vi.mock('../enabledPluginsStore', () => ({ useEnabledPluginsStore: () => fixture.store }));
vi.mock('../registry', () => ({ getRendererPluginContribution: fixture.registry, useRendererPluginRegistryRevision: () => fixture.revision }));
import { createRendererPluginRuntimePort } from './createRendererPluginRuntimePort';
beforeEach(() => { fixture.store = reactive({ states: [{ meta: { id: 'document-plugin' }, state: 'enabled' }], getPluginState: vi.fn() }); fixture.registry.mockReturnValue({ documentTypes: [{ nodeType: 'document-type' }] }); fixture.store.getPluginState.mockImplementation(id => fixture.store.states.find(item => item.meta.id === id)); });
it('查询与订阅复用启停事实，移除时保留原文档类型，取消后不再通知', async () => {
  const port = createRendererPluginRuntimePort(), events: (readonly RendererPluginAvailabilityChange[])[] = [];
  expect(port.read('document-plugin')).toBe('enabled'); expect(port.read('unknown')).toBe('missing');
  const stop = port.subscribe(changes => events.push(changes));
  fixture.store.states = [{ meta: { id: 'document-plugin' }, state: 'disabled' }]; await nextTick();
  expect(events[0]).toEqual([{ pluginId: 'document-plugin', state: 'disabled', documentNodeTypes: ['document-type'] }]);
  fixture.store.states = []; fixture.registry.mockReturnValue(null); await nextTick();
  expect(events[1]).toEqual([{ pluginId: 'document-plugin', state: 'missing', documentNodeTypes: ['document-type'] }]);
  stop(); fixture.store.states = [{ meta: { id: 'document-plugin' }, state: 'enabled' }]; await nextTick(); expect(events).toHaveLength(2);
});
