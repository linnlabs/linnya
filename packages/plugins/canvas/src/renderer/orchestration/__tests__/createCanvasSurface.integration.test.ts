// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import type { JsonValue } from '@app/schemas';
import type { CanvasKernel } from '../../kernel';
import { createPixiCanvasKernel } from '../../kernel';
import type { CanvasSurfacePorts } from '../../definitions/canvasSurface';
import { createCanvasSurface } from '../createCanvasSurface';

vi.mock('../../kernel', () => ({ createPixiCanvasKernel: vi.fn() }));
vi.mock('../../functions/readCanvasChrome', () => ({
  readCanvasChrome: () => ({
    accent: 0x347b45,
    background: 0xf2f3ee,
    ink: 0x252c27,
    label: 0x626b61,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('opens and reopens the actual surface when initial readonly cleanup synchronously emits a kernel intent', async () => {
  setActivePinia(createPinia());
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'matchMedia',
    (media: string): MediaQueryList =>
      Object.assign(new EventTarget(), {
        media,
        matches: false,
        onchange: null,
        addListener() {},
        removeListener() {},
      })
  );
  const unexpected = () => {
    throw new Error('Empty surface must not invoke this capability');
  };
  const close = vi.fn(async () => undefined),
    destroyed = vi.fn(),
    previewCleared = vi.fn();
  vi.mocked(createPixiCanvasKernel).mockImplementation(async options => {
    const canvas = document.createElement('canvas');
    options.host.append(canvas);
    const kernel: CanvasKernel = {
      canvas,
      setElements() {},
      setCamera() {},
      readCamera: () => ({ x: 0, y: 0, zoom: 1 }),
      animateCamera() {},
      finishTransitions() {},
      readDisplayPosition: () => null,
      isMoving: () => false,
      readRenderStatus: () => ({ limited: false, phase: 'ready', message: null }),
      readResolution: () => 1,
      setSelection() {},
      readSelection: () => [],
      setEditingCard() {},
      setSelectionFrame() {},
      hasBitmap: () => false,
      readRasterReceipt: () => null,
      setDragPreview() {},
      clearDragPreview() {
        previewCleared();
        options.onIntent?.({ kind: 'preview-changed' });
      },
      setBrush() {},
      setGuides() {},
      setBitmap: unexpected,
      setRasterTiles: unexpected,
      setRasterContentKey() {},
      invalidateBitmaps() {},
      setAppearance() {},
      resize() {},
      fit() {},
      hitTest: () => null,
      hitTestEdge: () => null,
      setSelectedEdge() {},
      setHoveredCard() {},
      setDocumentTitles() {},
      setThumbnailCards() {},
      readEdgeGeometry: () => null,
      readCard: () => null,
      visibleCards: () => [],
      renderableCards: () => [],
      rasterCards: () => [],
      readVisibleCardRegions: () => [],
      readMissingBitmapRegions: () => [],
      screenToWorld: point => point,
      worldToScreen: point => point,
      captureImage: unexpected,
      readStats: unexpected,
      destroy: () => canvas.remove(),
    };
    // GPU状态在await kernel返回前的微任务发出；文档/编辑依赖此时还没装配。
    queueMicrotask(() =>
      options.onIntent?.({ kind: 'render-status', limited: false, phase: 'ready', message: null })
    );
    return kernel;
  });
  const ports: CanvasSurfacePorts = {
    document: {
      read: async documentId => ({ schemaVersion: 1, documentId, sequence: 0, elements: [] }),
      changes: unexpected,
      commit: unexpected,
      undo: unexpected,
      editing: async () => undefined,
      close,
      subscribe: () => () => undefined,
    },
    createEditor(options) {
      let content: JsonValue = options.content;
      return {
        readContent: () => content,
        readMarkdown: () => '',
        replaceContent: value => {
          content = value;
        },
        insertContent: unexpected,
        captureInsertion: unexpected,
        setEditable() {},
        focus() {},
        destroy: destroyed,
      };
    },
    markDirty() {},
    subscribeRestored: () => () => undefined,
  };
  const host = document.createElement('div'),
    editorHost = document.createElement('div'),
    stagingHost = document.createElement('div');
  document.body.append(host, editorHost, stagingHost);
  for (let attempt = 0; attempt < 2; attempt++) {
    const surface = await createCanvasSurface(
      { host, editorHost, stagingHost, documentId: 'empty-canvas' },
      ports
    );
    await nextTick();
    expect(surface.session.state.phase.value).toBe('ready');
    expect(surface.error.value).toBeNull();
    expect(surface.session.state.snapshot.value?.documentId).toBe('empty-canvas');
    surface.destroy();
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  expect(previewCleared).toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(2);
  expect(destroyed).toHaveBeenCalledTimes(2);
});
