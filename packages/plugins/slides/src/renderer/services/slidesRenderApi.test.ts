import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresentationRenderModel } from '../types/render';

const renderApiMocks = vi.hoisted(() => ({
  invokeRendererPluginIpc: vi.fn(),
}));

vi.mock('@plugin/renderer/pluginIpcClient', () => ({
  invokeRendererPluginIpc: renderApiMocks.invokeRendererPluginIpc,
}));

describe('slidesRenderApi', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns backend render model when slides:render-model succeeds', async () => {
    const model: PresentationRenderModel = {
      presentationId: 'node-1',
      title: 'Deck',
      version: 1,
      sourceKind: 'generated',
      slideSize: { width: 10, height: 5.625, unit: 'in' },
      slides: [],
      capabilities: {
        hasSemanticRender: true,
        hasReferencePreview: false,
        hasHitTest: true,
        hasSelection: true,
      },
    };
    renderApiMocks.invokeRendererPluginIpc.mockResolvedValue({
      success: true,
      data: model,
    });

    const { slidesRenderApi } = await import('./slidesRenderApi');
    const result = await slidesRenderApi.getRenderModel('node-1');

    expect(result).toEqual(model);
    expect(renderApiMocks.invokeRendererPluginIpc).toHaveBeenCalledWith(
      'slides',
      'slides:render-model',
      { nodeId: 'node-1' },
    );
  });

  it('treats render-model not found as a hard error instead of rebuilding from DeckPreview', async () => {
    renderApiMocks.invokeRendererPluginIpc.mockResolvedValue({
      success: false,
      error: 'not found',
    });

    const { slidesRenderApi } = await import('./slidesRenderApi');

    await expect(slidesRenderApi.getRenderModel('node-1')).rejects.toThrow('not found');
  });

  it('propagates render-model IPC errors without rebuilding from preview data', async () => {
    renderApiMocks.invokeRendererPluginIpc.mockResolvedValue({
      success: false,
      error: 'render failed',
    });

    const { slidesRenderApi } = await import('./slidesRenderApi');

    await expect(slidesRenderApi.getRenderModel('node-1')).rejects.toThrow('render failed');
  });
});
