// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceMutationEvent } from '@app/schemas';
import { registerMessageCatalogs } from '@/app/localization';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import { readDocumentReference } from '@plugin/renderer/documentReferences';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { subscribeWorkspaceMutations } from '@plugin/renderer/workspaceRuntime';
import { SLIDES_PREVIEW_MESSAGES } from '../definitions/previewMessages';
import SlidesDocumentPreview from './SlidesDocumentPreview.vue';
const raster = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('@plugin/renderer/pluginIpcClient', () => ({ invokeRendererPluginIpc: vi.fn() }));
vi.mock('@plugin/renderer/documentReferences', () => ({ readDocumentReference: vi.fn() }));
vi.mock('@plugin/renderer/workspaceRuntime', () => ({ subscribeWorkspaceMutations: vi.fn() }));
vi.mock('../../slideRasterization', () => ({
  createThumbnailRasterRequest: (slide: unknown) => slide,
  renderSlideRasterToImageBitmap: raster.render,
}));
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
const model: PresentationRenderModel = {
  presentationId: 'doc',
  title: 'Current',
  version: 1,
  sourceKind: 'generated',
  slideSize: { width: 10, height: 7.5 },
  slides: Array.from({ length: 3 }, (_, index) => ({
    slideId: `s${index}`,
    index,
    layoutKey: 'freeform',
    background: { paint: { kind: 'solid', color: '#FFFFFF' } },
    elements: [],
  })),
  capabilities: {
    hasSemanticRender: true,
    hasReferencePreview: false,
    hasHitTest: false,
    hasSelection: false,
  },
};
const available = {
  documentId: 'doc',
  title: 'Current',
  nodeType: 'presentation',
  path: 'workspace:/Current.slides',
  status: 'available',
} as const;
const flush = async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await nextTick();
};
it('lazily previews and pages the current deck, does not steal focus and drops content when moved across projects', async () => {
  vi.mocked(readDocumentReference).mockResolvedValue(available);
  vi.mocked(invokeRendererPluginIpc).mockResolvedValue({ success: true, data: model });
  const images: ImageBitmap[] = [];
  raster.render.mockImplementation(async () => {
    const image = { width: 10, height: 8, close: vi.fn() };
    images.push(image);
    return image;
  });
  let changed: ((event: WorkspaceMutationEvent) => void) | undefined;
  const unsubscribe = vi.fn();
  vi.mocked(subscribeWorkspaceMutations).mockImplementation(listener => {
    changed = listener;
    return unsubscribe;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  registerMessageCatalogs(SLIDES_PREVIEW_MESSAGES);
  const focus = document.createElement('button');
  document.body.append(focus);
  focus.focus();
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({
    render: () => h(SlidesDocumentPreview, { documentId: 'doc', projectId: 'project' }),
  }).use(createPinia());
  try {
    app.mount(host);
    await flush();
    expect(document.activeElement).toBe(focus);
    expect(host.textContent).toContain('1 / 3');
    expect(raster.render).toHaveBeenCalledTimes(1);
    host.querySelectorAll<HTMLButtonElement>('.slides-readonly-navigation button')[1].click();
    await flush();
    expect(host.textContent).toContain('2 / 3');
    expect(images[0].close).toHaveBeenCalledOnce();
    vi.mocked(readDocumentReference).mockResolvedValue({
      ...available,
      title: null,
      nodeType: null,
      path: null,
      status: 'outside_project',
    });
    changed?.({
      type: 'workspace.node.transferred',
      mutationId: 'transfer',
      nodeId: 'folder',
      nodeType: 'folder',
      name: 'Folder',
      sourceProjectId: 'project',
      sourceParentId: null,
      targetProjectId: 'other',
      targetParentId: null,
      movedNodeIds: ['folder', 'doc'],
    });
    await flush();
    expect(host.querySelector('.slides-readonly-navigation')).toBeNull();
    expect(host.textContent).toContain('文档预览暂不可用');
    expect(vi.mocked(invokeRendererPluginIpc)).toHaveBeenCalledTimes(1);
  } finally {
    app.unmount();
    host.remove();
  }
  expect(unsubscribe).toHaveBeenCalledOnce();
  for (const image of images) expect(image.close).toHaveBeenCalledOnce();
});
it('does not render a model if its project changes while the backend read is in flight', async () => {
  vi.mocked(readDocumentReference)
    .mockResolvedValueOnce(available)
    .mockResolvedValue({
      ...available,
      title: null,
      nodeType: null,
      path: null,
      status: 'outside_project',
    });
  vi.mocked(invokeRendererPluginIpc).mockClear().mockResolvedValue({ success: true, data: model });
  raster.render.mockClear();
  vi.mocked(subscribeWorkspaceMutations).mockReturnValue(() => {});
  const host = document.createElement('div');
  const app = createApp({
    render: () => h(SlidesDocumentPreview, { documentId: 'doc', projectId: 'project' }),
  }).use(createPinia());
  try {
    app.mount(host);
    await flush();
    expect(raster.render).not.toHaveBeenCalled();
    expect(host.textContent).toContain('文档预览暂不可用');
  } finally {
    app.unmount();
  }
});
