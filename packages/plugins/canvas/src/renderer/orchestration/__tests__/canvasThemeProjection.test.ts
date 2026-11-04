// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { RENDERER_UI_THEME_ATTRIBUTE } from '@linnya/renderer-ui/theme';
import { createCanvasDocumentSession } from '../../features/canvasDocument';
import { useCanvasPreferencesStore } from '../../features/materialSetting';
import { readCanvasAppearance } from '../../functions/readCanvasAppearance';
import { installCanvasDisplayProjection } from '../installCanvasDisplayProjection';
afterEach(() => { document.documentElement.removeAttribute(RENDERER_UI_THEME_ATTRIBUTE); vi.unstubAllGlobals(); });
it('正式主题属性变化同步kernel、光栅与编辑墨色，moon-blue保持其正式浅色语义', async () => {
  setActivePinia(createPinia()); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {} }));
  const preferences = useCanvasPreferencesStore(), setAppearance = vi.fn(), refresh = vi.fn(), refreshInk = vi.fn();
  const session = createCanvasDocumentSession({ read: async () => { throw new Error('unused'); }, changes: async () => { throw new Error('unused'); }, commit: async () => { throw new Error('unused'); }, undo: async () => { throw new Error('unused'); }, editing: async () => {}, close: async () => {}, subscribe: () => () => {} });
  const dispose = installCanvasDisplayProjection({ host: document.createElement('div'), session, preferences, readAppearance: () => readCanvasAppearance(preferences.preferences),
    kernel: { setAppearance, setElements() {}, setDocumentTitles() {}, setThumbnailCards() {}, resize() {} }, raster: { refresh }, refreshEditorInk: refreshInk, viewportChanged: () => {}, report: failure => { throw failure; },
    ports: { document: { read: async () => { throw new Error('unused'); }, changes: async () => { throw new Error('unused'); }, commit: async () => { throw new Error('unused'); }, undo: async () => { throw new Error('unused'); }, editing: async () => {}, close: async () => {}, subscribe: () => () => {} }, createEditor: () => { throw new Error('unused'); }, markDirty() {}, subscribeRestored: () => () => {} },
  });
  document.documentElement.setAttribute(RENDERER_UI_THEME_ATTRIBUTE, 'dark');
  await vi.waitFor(() => expect(setAppearance).toHaveBeenLastCalledWith(expect.objectContaining({ dark: true })));
  expect(refreshInk).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce();
  document.documentElement.setAttribute(RENDERER_UI_THEME_ATTRIBUTE, 'moon-blue');
  await vi.waitFor(() => expect(setAppearance).toHaveBeenLastCalledWith(expect.objectContaining({ dark: false })));
  expect(refreshInk).toHaveBeenCalledTimes(2); dispose();
  document.documentElement.setAttribute(RENDERER_UI_THEME_ATTRIBUTE, 'dark'); await Promise.resolve(); expect(setAppearance).toHaveBeenCalledTimes(2);
});
