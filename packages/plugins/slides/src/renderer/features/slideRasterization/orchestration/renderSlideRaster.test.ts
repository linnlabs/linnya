import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChartRenderNode,
  GroupRenderNode,
  ImageRenderNode,
  ShapeRenderNode,
  SlideRenderModel,
  TextRenderNode,
} from '../../../types/render';
import {
  layoutTextNode,
  resolveTextLayoutContractFromNode,
  type RunAdvanceProvider,
  type TextLayoutProfile,
} from '@plugin/slides/shared/textLayout';
import { clearSharedRenderImageResourceRegistry } from '../../renderImageResources';
import { clearSharedRenderChartResourceRegistry } from '../../renderChartResources';

const offscreenRendererTestState = vi.hoisted(() => {
  class FakeKonvaNode {
    public readonly children: FakeKonvaNode[] = [];
    public readonly config: Record<string, unknown>;

    constructor(config: Record<string, unknown> = {}) {
      this.config = config;
    }

    add(...children: FakeKonvaNode[]): this {
      this.children.push(...children);
      return this;
    }
  }

  class FakeStage extends FakeKonvaNode {
    public destroyed = false;
    public readonly canvas = document.createElement('canvas');

    constructor(config: Record<string, unknown> = {}) {
      super(config);
      if (typeof config.width === 'number') {
        this.canvas.width = config.width;
      }
      if (typeof config.height === 'number') {
        this.canvas.height = config.height;
      }
    }

    toCanvas(): HTMLCanvasElement {
      return this.canvas;
    }

    destroy(): this {
      this.destroyed = true;
      return this;
    }
  }

  class FakeLayer extends FakeKonvaNode {}
  class FakeGroup extends FakeKonvaNode {}
  class FakeRect extends FakeKonvaNode {}
  class FakeEllipse extends FakeKonvaNode {}
  class FakeLine extends FakeKonvaNode {}
  class FakePath extends FakeKonvaNode {}
  class FakeText extends FakeKonvaNode {}
  class FakeImage extends FakeKonvaNode {}
  class FakeImageBitmap implements ImageBitmap {
    constructor(
      public readonly width: number,
      public readonly height: number,
    ) {}

    close(): void {}
  }

  return {
    stageInstances: [] as FakeStage[],
    failImageLoads: false,
    loadRendererLocalImageAsDataUrlMock: vi.fn<(filePath: string) => Promise<{
      success: true;
      dataUrl: string;
    }>>(),
    renderChartToImageMock: vi.fn<(
      node: ChartRenderNode,
      pixelRatio?: number,
    ) => Promise<HTMLImageElement | null>>(),
    createImageBitmapMock: vi.fn<(canvas: HTMLCanvasElement) => Promise<ImageBitmap>>(),
    canvasToBlobMock: vi.fn<(
      callback: BlobCallback,
      type?: string,
    ) => void>(),
    statRendererLocalImageMock: vi.fn<(filePath: string) => Promise<{
      success: true;
      size: number;
      mtimeMs: number;
    }>>(),
    FakeStage,
    FakeLayer,
    FakeGroup,
    FakeRect,
    FakeEllipse,
    FakeLine,
    FakePath,
    FakeText,
    FakeImage,
    FakeImageBitmap,
  };
});

vi.mock('../functions/konvaRasterPrimitives', () => ({
  Stage: class extends offscreenRendererTestState.FakeStage {
    constructor(config: Record<string, unknown>) {
      super(config);
      offscreenRendererTestState.stageInstances.push(this);
    }
  },
  Layer: offscreenRendererTestState.FakeLayer,
  Group: offscreenRendererTestState.FakeGroup,
  Rect: offscreenRendererTestState.FakeRect,
  Ellipse: offscreenRendererTestState.FakeEllipse,
  Line: offscreenRendererTestState.FakeLine,
  Path: offscreenRendererTestState.FakePath,
  Text: offscreenRendererTestState.FakeText,
  KonvaImage: offscreenRendererTestState.FakeImage,
}));

vi.mock('@plugin/renderer/imageAssetSource', () => ({
  canLoadRendererLocalImageAsDataUrl: () => true,
  loadRendererLocalImageAsDataUrl: offscreenRendererTestState.loadRendererLocalImageAsDataUrlMock,
  statRendererLocalImage: offscreenRendererTestState.statRendererLocalImageMock,
}));

vi.mock('../../renderChartResources/functions/renderChartToImage', () => ({
  renderChartToImage: offscreenRendererTestState.renderChartToImageMock,
}));

class TestImage {
  public naturalWidth = 800;
  public naturalHeight = 600;
  public crossOrigin: string | null = null;
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  private currentSrc = '';

  get src(): string {
    return this.currentSrc;
  }

  set src(value: string) {
    this.currentSrc = value;
    queueMicrotask(() => {
      if (offscreenRendererTestState.failImageLoads) {
        this.onerror?.();
      } else {
        this.onload?.();
      }
    });
  }

  async decode(): Promise<void> {
    if (offscreenRendererTestState.failImageLoads) {
      throw new Error('image decode failed');
    }
  }
}

const fixtureAdvanceProvider: RunAdvanceProvider = {
  getClusterAdvances: (clusters) => ({
    advances: clusters.map(() => 0.1),
    source: 'heuristic',
  }),
};

function finalizeFixtureTextNode(
  node: TextRenderNode,
  profile: TextLayoutProfile,
): TextRenderNode {
  const contract = resolveTextLayoutContractFromNode(node, {
    profile,
    sourceKind: 'generated',
  });
  node.layout = layoutTextNode({
    paragraphs: node.paragraphs,
    contract,
    defaultFontFamily: node.paragraphs[0]?.runs[0]?.fontFamily ?? 'Arial',
  }, fixtureAdvanceProvider);
  return node;
}

function createTextNode(): TextRenderNode {
  return finalizeFixtureTextNode({
    id: 'text-1',
    kind: 'text',
    box: { x: 1, y: 1, w: 3, h: 1.2, unit: 'in' },
    zIndex: 2,
    paragraphs: [{ runs: [{ text: 'Hello Konva', fontSize: 20, color: '#111111' }] }],
  }, 'plain-textbox');
}

function createNarrowAxisTitleNode(): TextRenderNode {
  return finalizeFixtureTextNode({
    id: 'axis-title',
    kind: 'text',
    box: { x: 5.18, y: 2.98, w: 0.18, h: 0.84, unit: 'in' },
    zIndex: 1,
    paragraphs: [...'单均逆向成本'].map((text) => ({
      align: 'center',
      lineSpacing: { kind: 'multiple', value: 1.18 },
      runs: [{ text, fontSize: 6.5 }],
    })),
    padding: { top: 0.05, right: 0.1, bottom: 0.05, left: 0.1 },
    wrap: 'word',
    overflow: 'clip',
    autoFitPolicy: 'resize-shape',
    verticalAlign: 'middle',
  }, 'plain-textbox');
}

function createShapeNode(): ShapeRenderNode {
  return {
    id: 'shape-1',
    kind: 'shape',
    box: { x: 0.5, y: 0.5, w: 2, h: 1.5, unit: 'in' },
    zIndex: 1,
    geometry: { type: 'preset', name: 'rect' },
    fill: { type: 'solid', color: '#FFEEAA' },
    innerText: finalizeFixtureTextNode({
      id: 'shape-1-text',
      kind: 'text',
      box: { x: 0.6, y: 0.6, w: 1.8, h: 1.2, unit: 'in' },
      zIndex: 1,
      paragraphs: [{ runs: [{ text: 'Inner label', fontSize: 14 }] }],
    }, 'shape-inner-text'),
  };
}

function createImageNode(): ImageRenderNode {
  return {
    id: 'image-1',
    kind: 'image',
    box: { x: 3, y: 0.5, w: 2, h: 2, unit: 'in' },
    zIndex: 3,
    assetRef: { type: 'embedded', partPath: '/tmp/image-a.png' },
    fitMode: 'cover',
    borderRadius: 12,
    flipH: true,
  };
}

function createChartNode(): ChartRenderNode {
  return {
    id: 'chart-1',
    kind: 'chart',
    box: { x: 1, y: 2.2, w: 3, h: 2, unit: 'in' },
    zIndex: 4,
    chartType: 'line',
    categories: ['Q1', 'Q2'],
    series: [{ name: 'Revenue', values: [10, 20] }],
    palette: ['#4472C4'],
  };
}

function createGroupNode(): GroupRenderNode {
  return {
    id: 'group-1',
    kind: 'group',
    box: { x: 5, y: 1, w: 2.5, h: 2.5, unit: 'in' },
    zIndex: 5,
    children: [createTextNode()],
  };
}

function createSlide(): SlideRenderModel {
  return {
    slideId: 'slide-1',
    index: 0,
    layoutKey: 'structured',
    background: {
      paint: { type: 'solid', color: '#FFFFFF' },
      imageSrc: '/tmp/bg.png',
    },
    elements: [
      createShapeNode(),
      createTextNode(),
      createImageNode(),
      createChartNode(),
      createGroupNode(),
    ],
  };
}

function createRasterRequest(slide = createSlide()) {
  return {
    requestId: `raster:${slide.slideId}`,
    slide,
    slideSize: { width: 10, height: 5.625, unit: 'in' as const },
    profile: {
      id: 'test-raster-v1',
      viewportWidthPx: 160,
      viewportHeightPx: 90,
      pixelRatio: 2,
      format: 'png' as const,
    },
  };
}

describe('slide rasterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    offscreenRendererTestState.stageInstances.length = 0;
    offscreenRendererTestState.failImageLoads = false;
    clearSharedRenderImageResourceRegistry();
    clearSharedRenderChartResourceRegistry();
    vi.stubGlobal('document', {
      createElement: (tagName: string) => {
        if (tagName === 'canvas') {
          return {
            width: 0,
            height: 0,
            toBlob: offscreenRendererTestState.canvasToBlobMock,
            getContext: () => ({
              font: '',
              measureText: (text: string) => ({ width: text.length * 8 }),
            }),
          };
        }
        return {
          remove: vi.fn(),
        };
      },
    });
    vi.stubGlobal('Image', TestImage);
    offscreenRendererTestState.loadRendererLocalImageAsDataUrlMock.mockImplementation(async (filePath) => {
      return {
        success: true,
        dataUrl: `data:image/png;base64,${filePath}`,
      };
    });
    offscreenRendererTestState.statRendererLocalImageMock.mockImplementation(async () => {
      return {
        success: true,
        size: 1,
        mtimeMs: 1,
      };
    });
    offscreenRendererTestState.renderChartToImageMock.mockResolvedValue(new Image());
    offscreenRendererTestState.createImageBitmapMock.mockImplementation(async (canvas) => (
      new offscreenRendererTestState.FakeImageBitmap(canvas.width, canvas.height)
    ));
    offscreenRendererTestState.canvasToBlobMock.mockImplementation((callback) => {
      callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
    });
    vi.stubGlobal('createImageBitmap', offscreenRendererTestState.createImageBitmapMock);
  });

  it('renders a slide with shared builders, preloaded images, and chart bitmaps', async () => {
    const { renderSlideRasterToImageBitmap } = await import('./renderSlideRaster');

    const bitmap = await renderSlideRasterToImageBitmap(createRasterRequest());

    expect(bitmap.width).toBe(320);
    expect(offscreenRendererTestState.loadRendererLocalImageAsDataUrlMock).toHaveBeenCalledTimes(2);
    expect(offscreenRendererTestState.loadRendererLocalImageAsDataUrlMock).toHaveBeenNthCalledWith(1, '/tmp/bg.png');
    expect(offscreenRendererTestState.loadRendererLocalImageAsDataUrlMock).toHaveBeenNthCalledWith(2, '/tmp/image-a.png');
    expect(offscreenRendererTestState.renderChartToImageMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'chart-1' }),
      2,
    );
    expect(offscreenRendererTestState.stageInstances).toHaveLength(1);
    expect(offscreenRendererTestState.stageInstances[0].destroyed).toBe(true);
    expect(offscreenRendererTestState.createImageBitmapMock).toHaveBeenCalledWith(
      offscreenRendererTestState.stageInstances[0].canvas,
    );
  });

  it('keeps a narrow vertical chart-axis title visible through the complete raster pipeline', async () => {
    const { renderSlideRasterToImageBitmap } = await import('./renderSlideRaster');
    const slide = createSlide();
    slide.background = { paint: { type: 'solid', color: '#FFFFFF' } };
    slide.elements = [createNarrowAxisTitleNode()];

    await renderSlideRasterToImageBitmap(createRasterRequest(slide));

    const stage = offscreenRendererTestState.stageInstances[0];
    const layer = stage?.children[0];
    const rootGroup = layer?.children[0];
    const axisTitleGroup = rootGroup?.children.find(
      (child) => child.config.x === 5.18 * 96,
    );

    expect(axisTitleGroup?.config).toEqual(expect.objectContaining({
      clipX: 0,
      clipY: 0,
      clipWidth: 0.18 * 96,
      clipHeight: 0.84 * 96,
    }));
    expect(axisTitleGroup?.children).toHaveLength(6);
    for (const glyph of axisTitleGroup?.children ?? []) {
      const x = glyph.config.x;
      expect(typeof x).toBe('number');
      // run advance 不是字形 paint 边界；普通文本不再给 Konva Text 设置
      // width，避免末字符先在 run 内被裁掉。正式裁剪只发生在外层文本框。
      expect(glyph.config).not.toHaveProperty('width');
      if (typeof x === 'number') {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(0.18 * 96 + 1);
      }
    }
  });

  it('fails closed when any raster image resource cannot be decoded', async () => {
    offscreenRendererTestState.failImageLoads = true;
    const { renderSlideRasterToPng } = await import('./renderSlideRaster');

    await expect(renderSlideRasterToPng(createRasterRequest())).rejects.toMatchObject({
      code: 'slides.raster.resource_load_failed',
    });
    expect(offscreenRendererTestState.stageInstances).toHaveLength(0);
  });

  it('dispatches non-rect shapes to v-line / v-path Konva primitives', async () => {
    const { renderSlideRasterToImageBitmap } = await import('./renderSlideRaster');

    const slide: SlideRenderModel = {
      slideId: 'slide-shapes',
      index: 0,
      layoutKey: 'structured',
      background: { paint: { type: 'solid', color: '#FFFFFF' } },
      elements: [
        {
          id: 'tri',
          kind: 'shape',
          box: { x: 0, y: 0, w: 1, h: 1, unit: 'in' },
          zIndex: 0,
          geometry: { type: 'preset', name: 'triangle' },
          fill: { type: 'solid', color: '#FF0000' },
        } satisfies ShapeRenderNode,
        {
          id: 'star',
          kind: 'shape',
          box: { x: 1, y: 0, w: 1, h: 1, unit: 'in' },
          zIndex: 1,
          geometry: { type: 'preset', name: 'star5' },
          fill: { type: 'solid', color: '#00FF00' },
        } satisfies ShapeRenderNode,
        {
          id: 'custom-path',
          kind: 'shape',
          box: { x: 2, y: 0, w: 1, h: 1, unit: 'in' },
          zIndex: 2,
          geometry: {
            type: 'path',
            viewBox: { width: 100, height: 100 },
            commands: [
              { type: 'moveTo', x: 0, y: 0 },
              { type: 'cubicTo', x1: 30, y1: 0, x2: 70, y2: 100, x: 100, y: 100 },
              { type: 'lineTo', x: 0, y: 100 },
              { type: 'close' },
            ],
            closed: true,
          },
          fill: { type: 'solid', color: '#0000FF' },
        } satisfies ShapeRenderNode,
      ],
    };

    await renderSlideRasterToImageBitmap(createRasterRequest(slide));

    const [stage] = offscreenRendererTestState.stageInstances;
    if (!stage) {
      throw new Error('Expected offscreen renderer to create a Konva stage');
    }

    type InspectableKonvaNode = {
      constructor: { name: string };
      children?: readonly InspectableKonvaNode[];
    };

    const allNodes: InspectableKonvaNode[] = [];
    function walk(node: InspectableKonvaNode): void {
      allNodes.push(node);
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          walk(child);
        }
      }
    }
    walk(stage);

    const primitiveNames = allNodes.map((n) => n.constructor.name);
    expect(primitiveNames).toContain('FakeLine');
    expect(primitiveNames).toContain('FakePath');
  });

  it('destroys the Konva stage when bitmap export fails', async () => {
    offscreenRendererTestState.createImageBitmapMock.mockRejectedValueOnce(new Error('bitmap export failed'));
    const { renderSlideRasterToImageBitmap } = await import('./renderSlideRaster');

    await expect(
      renderSlideRasterToImageBitmap(createRasterRequest()),
    ).rejects.toMatchObject({
      code: 'slides.raster.render_failed',
      message: 'bitmap export failed',
    });

    expect(offscreenRendererTestState.stageInstances).toHaveLength(1);
    expect(offscreenRendererTestState.stageInstances[0].destroyed).toBe(true);
  });

  it('exports worker-ready PNG bytes with request identity and physical dimensions', async () => {
    const { renderSlideRasterToPng } = await import('./renderSlideRaster');

    const result = await renderSlideRasterToPng(createRasterRequest());

    expect(result).toMatchObject({
      status: 'success',
      requestId: 'raster:slide-1',
      format: 'png',
      widthPx: 320,
      heightPx: 180,
    });
    expect(Array.from(result.bytes)).toEqual([137, 80, 78, 71]);
    expect(offscreenRendererTestState.canvasToBlobMock).toHaveBeenCalledWith(
      expect.any(Function),
      'image/png',
    );
  });

  it('fails with a stable code when the browser cannot encode PNG bytes', async () => {
    offscreenRendererTestState.canvasToBlobMock.mockImplementationOnce((callback) => {
      callback(null);
    });
    const { renderSlideRasterToPng } = await import('./renderSlideRaster');

    await expect(renderSlideRasterToPng(createRasterRequest())).rejects.toMatchObject({
      code: 'slides.raster.encode_failed',
    });
  });
});
