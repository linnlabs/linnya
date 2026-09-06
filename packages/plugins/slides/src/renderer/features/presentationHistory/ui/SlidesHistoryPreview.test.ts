// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { expect, it, vi } from 'vitest';
import { registerMessageCatalogs, useLocalizationStore } from '@/app/localization';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import { SLIDES_HISTORY_MESSAGES } from '../definitions/historyMessages';
import SlidesHistoryPreview from './SlidesHistoryPreview.vue';

const ports = vi.hoisted(() => ({ read: vi.fn(), render: vi.fn() }));
vi.mock('@plugin/renderer/pluginIpcClient', () => ({ invokeRendererPluginIpc: ports.read }));
vi.mock('../../slideRasterization', () => ({
  createThumbnailRasterRequest: (slide: unknown) => slide,
  renderSlideRasterToImageBitmap: ports.render,
}));

it('只读弹窗正文用按钮和左右键翻页，首尾不循环；键盘不接管外部，关闭释放所有图片', async () => {
  const model: PresentationRenderModel = {
    presentationId: 'doc',
    title: 'History',
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
  ports.read.mockResolvedValue({ success: true, data: model });
  const images: ImageBitmap[] = [];
  ports.render.mockImplementation(async () => {
    const image = { width: 10, height: 8, close: vi.fn() };
    images.push(image);
    return image;
  });
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  registerMessageCatalogs(SLIDES_HISTORY_MESSAGES);
  const host = document.createElement('div');
  document.body.append(host);
  const pinia = createPinia();
  const app = createApp({
    render: () => h(SlidesHistoryPreview, { documentId: 'doc', versionId: 'old' }),
  }).use(pinia);
  const flush = async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    await nextTick();
  };
  try {
    app.mount(host);
    await flush();
    const preview = host.querySelector<HTMLElement>('.slides-history-preview')!;
    const nav = () => host.querySelector('.slides-history-navigation')!;
    const key = (value: string) =>
      preview.dispatchEvent(
        new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })
      );
    expect(document.activeElement).toBe(preview);
    expect(host.querySelector('select')).toBeNull();
    expect(nav().textContent).toContain('1 / 3');
    expect(nav().querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    expect(ports.render).toHaveBeenCalledTimes(1);
    key('ArrowLeft');
    await flush();
    expect(nav().textContent).toContain('1 / 3');
    key('ArrowRight');
    await flush();
    expect(nav().textContent).toContain('2 / 3');
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    expect(ports.render).toHaveBeenCalledTimes(2);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await flush();
    expect(nav().textContent).toContain('2 / 3');
    nav().querySelectorAll<HTMLButtonElement>('button')[1].click();
    await flush();
    key('ArrowRight');
    await flush();
    expect(nav().textContent).toContain('3 / 3');
    expect(nav().querySelectorAll<HTMLButtonElement>('button')[1].disabled).toBe(true);
    expect(ports.render).toHaveBeenCalledTimes(3);
    useLocalizationStore(pinia).setCurrentLocale('en-US');
    await nextTick();
    expect(nav().querySelector('button')?.getAttribute('aria-label')).toBe('Previous slide');
    expect(ports.read).toHaveBeenCalledTimes(1);
  } finally {
    app.unmount();
    host.remove();
    context.mockRestore();
  }
  expect(images.every(image => vi.mocked(image.close).mock.calls.length === 1)).toBe(true);
});
