import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import type { PresentationRenderModel } from '@plugin/slides/shared';
import type { PresentationExportRuntimePorts } from '../definitions/presentationExportPorts';
import { PresentationExportRuntime } from './PresentationExportRuntime';

const PNG_BYTES = Buffer.from('png-page');

function createRenderModel(): PresentationRenderModel {
  return {
    presentationId: 'deck-1',
    title: 'Deck',
    version: 1,
    sourceKind: 'generated',
    slideSize: { width: 13.333, height: 7.5, unit: 'in' },
    slides: [1, 2].map(index => ({
      slideId: `slide-${index}`,
      index: index - 1,
      layoutKey: 'blank',
      background: { color: '#FFFFFF' },
      elements: [],
    })),
    capabilities: {
      hasSemanticRender: true,
      hasReferencePreview: false,
      hasHitTest: true,
      hasSelection: true,
    },
  };
}

function createPorts(): PresentationExportRuntimePorts {
  return {
    loadNativePptx: vi.fn(async () => ({
      buffer: Buffer.from([80, 75, 3, 4]),
      fileName: 'Deck.pptx',
    })),
    loadRasterSource: vi.fn(async () => ({
      renderModel: createRenderModel(),
      deckSpec: {
        title: 'Deck',
        slides: [1, 2].map(slideNumber => ({
          slideNumber,
          spec: { type: 'structured' as const, elements: [] },
        })),
      },
    })),
    rasterizePages: vi.fn(async (request, options) => {
      const pages = request.slideNumbers.map(slideNumber => ({
        slideNumber,
        slideId: `slide-${slideNumber}`,
        bytes: PNG_BYTES,
        byteLength: PNG_BYTES.byteLength,
        sha256: 'hash',
        widthPx: request.profile.viewportWidthPx,
        heightPx: request.profile.viewportHeightPx,
      }));
      pages.forEach((_page, index) => options?.onPageCompleted?.({
        completedPages: index + 1,
        totalPages: pages.length,
      }));
      return {
        widthPx: request.profile.viewportWidthPx,
        heightPx: request.profile.viewportHeightPx,
        pages,
      };
    }),
    reportImageProgress: vi.fn(),
    renderRasterPdf: vi.fn(async () => Buffer.from('%PDF')),
    assembleDeck: vi.fn(async () => Buffer.from([80, 75, 3, 4, 5])),
    commitArtifact: vi.fn(async request => ({
      fileName: request.extension === 'zip' ? 'Deck-images.zip' : `Deck.${request.extension}`,
      byteLength: request.bytes.byteLength,
    })),
  };
}

describe('PresentationExportRuntime', () => {
  it('把 current native PPTX 直接提交到 Host target，不把 bytes 返回 renderer', async () => {
    const ports = createPorts();
    const runtime = new PresentationExportRuntime(ports);

    await expect(runtime.export({
      nodeId: 'deck-1',
      targetToken: 'target-1',
      format: 'pptx',
      chartMode: 'native',
    })).resolves.toEqual({
      format: 'pptx',
      fileName: 'Deck.pptx',
      byteLength: 4,
    });
    expect(ports.loadNativePptx).toHaveBeenCalledWith('deck-1');
    expect(ports.loadRasterSource).not.toHaveBeenCalled();
    expect(ports.commitArtifact).toHaveBeenCalledWith({
      pluginId: 'slides',
      targetToken: 'target-1',
      extension: 'pptx',
      mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      bytes: Buffer.from([80, 75, 3, 4]),
    });
  });

  it('按所选宽度把同源 PNG 页面打包为有序 ZIP', async () => {
    const ports = createPorts();
    const runtime = new PresentationExportRuntime(ports);

    const result = await runtime.export({
      nodeId: 'deck-1',
      targetToken: 'target-images',
      format: 'images',
      widthPx: 3840,
      exportId: 'export-images',
    });

    expect(result.format).toBe('images');
    expect(ports.rasterizePages).toHaveBeenCalledWith(expect.objectContaining({
      slideNumbers: [1, 2],
    }), {
      onPageCompleted: expect.any(Function),
    });
    const rasterRequest = vi.mocked(ports.rasterizePages).mock.calls[0][0];
    expect(Math.round(
      rasterRequest.profile.viewportWidthPx * rasterRequest.profile.pixelRatio,
    )).toBe(3840);
    const commitRequest = vi.mocked(ports.commitArtifact).mock.calls[0][0];
    const archive = await JSZip.loadAsync(commitRequest.bytes);
    expect(Object.keys(archive.files)).toEqual(['slide-001.png', 'slide-002.png']);
    expect(await archive.file('slide-001.png')?.async('uint8array'))
      .toEqual(new Uint8Array(PNG_BYTES));
    expect(ports.reportImageProgress).toHaveBeenNthCalledWith(1, {
      exportId: 'export-images',
      completedPages: 0,
      totalPages: 2,
    });
    expect(ports.reportImageProgress).toHaveBeenNthCalledWith(2, {
      exportId: 'export-images',
      completedPages: 1,
      totalPages: 2,
    });
    expect(ports.reportImageProgress).toHaveBeenNthCalledWith(3, {
      exportId: 'export-images',
      completedPages: 2,
      totalPages: 2,
    });
  });

  it('PDF 无额外设置，固定使用高清页面并保持文稿物理尺寸', async () => {
    const ports = createPorts();
    const runtime = new PresentationExportRuntime(ports);

    await runtime.export({
      nodeId: 'deck-1',
      targetToken: 'target-pdf',
      format: 'pdf',
    });

    const rasterRequest = vi.mocked(ports.rasterizePages).mock.calls[0][0];
    expect(Math.round(
      rasterRequest.profile.viewportWidthPx * rasterRequest.profile.pixelRatio,
    )).toBe(1920);
    expect(ports.renderRasterPdf).toHaveBeenCalledWith({
      pageWidthInches: 13.333,
      pageHeightInches: 7.5,
      pages: [PNG_BYTES, PNG_BYTES],
    });
    expect(ports.commitArtifact).toHaveBeenCalledWith(expect.objectContaining({
      targetToken: 'target-pdf',
      extension: 'pdf',
      mediaType: 'application/pdf',
      bytes: Buffer.from('%PDF'),
    }));
  });

  it('PPTX 图片模式只把 generated chart 替换为透明 PNG，其他元素保持原生', async () => {
    const renderModel = createRenderModel();
    renderModel.slides[0].elements = [{
      id: 's1-generated-0',
      kind: 'chart',
      box: { x: 1, y: 2, w: 6, h: 3, unit: 'in' },
      zIndex: 0,
      chartType: 'column',
      categories: ['A'],
      series: [{ name: 'S', values: [1] }],
      palette: ['#123456'],
    }];
    const ports: PresentationExportRuntimePorts = {
      ...createPorts(),
      loadRasterSource: vi.fn(async () => ({
        renderModel,
        deckSpec: {
          title: 'Deck',
          slides: [{
            slideNumber: 1,
            spec: {
              type: 'structured',
              elements: [{
                type: 'chart',
                chartType: 'bar',
                data: {
                  categories: ['A'],
                  series: [{ name: 'S', labels: ['A'], values: [1] }],
                },
                position: { x: 1, y: 2, w: 6, h: 3 },
              }],
            },
          }],
        },
      })),
    };
    const runtime = new PresentationExportRuntime(ports);

    await runtime.export({
      nodeId: 'deck-1',
      targetToken: 'target-chart-image',
      format: 'pptx',
      chartMode: 'image',
    });

    const chartRasterRequest = vi.mocked(ports.rasterizePages).mock.calls[0][0];
    expect(chartRasterRequest.profile.transparentBackground).toBe(true);
    expect(Math.round(
      chartRasterRequest.profile.viewportWidthPx * chartRasterRequest.profile.pixelRatio,
    )).toBe(1152);
    const assembledDeck = vi.mocked(ports.assembleDeck).mock.calls[0][1];
    const element = assembledDeck.slides[0].spec.elements[0];
    expect(element).toMatchObject({
      type: 'image',
      position: { x: 1, y: 2, w: 6, h: 3 },
      fitMode: 'contain',
      src: { kind: 'data_uri' },
    });
    expect(ports.loadNativePptx).not.toHaveBeenCalled();
  });
});
