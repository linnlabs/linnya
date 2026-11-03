// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, onMounted, onUnmounted, reactive } from 'vue';
import DocumentSurface from './DocumentSurface.vue';

const fixture = vi.hoisted(() => ({ mounted: [] as string[], unmounted: [] as string[] }));
const layout = reactive({ state: { activeDocument: { type: 'fixture', id: 'a', projectId: 'project' } } });
const Surface = defineComponent({ setup() { const id = layout.state.activeDocument.id; onMounted(() => fixture.mounted.push(id)); onUnmounted(() => fixture.unmounted.push(id)); return () => h('div', id); } });
vi.mock('@/app/layout/store/layoutStore', () => ({ useLayoutStore: () => layout }));
vi.mock('@/app/layout/composables/useLayoutLocalization', () => ({ useLayoutLocalization: () => ({ layoutMessage: (key: string) => key }) }));
vi.mock('@/app/plugins/composables', () => ({ useDocumentTypeAvailabilityByActiveType: () => ({ value: { state: 'enabled', documentType: { surfaceComponent: Surface } } }) }));
vi.mock('@/app/plugins/functions/pluginContributionPresentation', () => ({ resolveDocumentTypeTextPresentation: () => ({ label: 'fixture' }) }));
vi.mock('@/app/localization', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
vi.mock('@/app/plugins/components/UnavailableDocumentPlaceholder.vue', () => ({ default: defineComponent({ render: () => h('div') }) }));
vi.mock('@/shared/ports/documentSurfaceRuntimePort', () => ({ getDocumentSurfaceRuntimePort: () => ({ clearSurfaceReady: vi.fn(), markSurfaceReady: vi.fn() }) }));
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); fixture.mounted.length = 0; fixture.unmounted.length = 0; });
describe('document surface lifecycle', () => {
  it('同类型A→B→A每次建立独立表面，不沿用前一文档的本地草稿和异步工作', async () => {
    layout.state.activeDocument = { type: 'fixture', id: 'a', projectId: 'project' };
    const host = document.createElement('div'); document.body.append(host);
    const app = createApp(DocumentSurface); app.mount(host); cleanups.push(() => { app.unmount(); host.remove(); });
    await nextTick();
    layout.state.activeDocument = { type: 'fixture', id: 'b', projectId: 'project' }; await nextTick();
    layout.state.activeDocument = { type: 'fixture', id: 'a', projectId: 'project' }; await nextTick();
    expect(fixture.mounted).toEqual(['a', 'b', 'a']);
    expect(fixture.unmounted).toEqual(['a', 'b']);
  });
});
