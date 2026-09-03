import { describe, expect, it, vi } from 'vitest';
import type {
  PresentationRenderModel,
  ToolFeedbackPayload,
} from '@plugin/slides/shared';
import { PresentationInspectionRuntime } from './PresentationInspectionRuntime';

function createRenderModel(): PresentationRenderModel {
  return {
    presentationId: 'deck-1',
    title: 'Deck',
    version: 7,
    sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    slides: Array.from({ length: 3 }, (_, index) => ({
      slideId: `slide-${index + 1}`,
      index,
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

function createFeedback(
  presentationId: string,
  versionId: string,
  renderModel: PresentationRenderModel,
): ToolFeedbackPayload {
  return {
    artifact: {
      presentationId,
      versionId,
      slideCount: renderModel.slides.length,
    },
    pageSummaries: [],
    sceneGraph: [],
    spatialAnalysis: [],
    buildStatus: { state: 'ready' },
    findings: [],
  };
}

describe('PresentationInspectionRuntime', () => {
  it('用同一版本快照完成页选择、截断和 quality feedback 构建', async () => {
    const renderModel = createRenderModel();
    const buildFeedback = vi.fn(async (
      presentationId: string,
      versionId: string,
      selectedModel: PresentationRenderModel,
    ) => createFeedback(presentationId, versionId, selectedModel));
    const runtime = new PresentationInspectionRuntime({
      loadSnapshot: vi.fn(async () => ({
        versionId: 'version-uuid-7',
        renderModel,
      })),
      loadSourceLocations: vi.fn(async () => new Map([[2, {
        file: 'deck.js' as const,
        slideNumber: 2,
        startLine: 10,
        endLine: 20,
      }]])),
      buildFeedback,
    });

    const result = await runtime.inspect({
      presentationId: 'deck-1',
      selection: { kind: 'range', fromSlideNumber: 2, toSlideNumber: 3 },
      maxSlides: 1,
      includeHeuristics: true,
    });

    expect(result.versionId).toBe('version-uuid-7');
    expect(result.totalSlideCount).toBe(3);
    expect(result.requestedSlideNumbers).toEqual([2, 3]);
    expect(result.renderModel.slides.map((slide) => slide.index + 1)).toEqual([2]);
    expect(result.truncated).toBe(true);
    expect(result.feedback.artifact).toEqual({
      presentationId: 'deck-1',
      versionId: 'version-uuid-7',
      slideCount: 1,
    });
    expect(buildFeedback).toHaveBeenCalledWith(
      'deck-1',
      'version-uuid-7',
      expect.objectContaining({ slides: [expect.objectContaining({ slideId: 'slide-2' })] }),
      expect.any(Map),
      {
        includeHeuristics: true,
        sourceLocations: expect.any(Map),
      },
    );
  });
});
