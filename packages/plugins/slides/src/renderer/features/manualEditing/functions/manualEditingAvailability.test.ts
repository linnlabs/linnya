import { describe, expect, it } from 'vitest';
import type { PresentationRenderModel } from '../../../types/render';
import { resolveManualEditingAvailability } from './manualEditingAvailability';

const model: PresentationRenderModel = {
  presentationId: 'deck-1',
  title: 'Deck',
  version: 3,
  sourceKind: 'generated',
  slideSize: { width: 10, height: 5.625, unit: 'in' },
  capabilities: {
    hasSemanticRender: true,
    hasReferencePreview: false,
    hasHitTest: true,
    hasSelection: true,
  },
  slides: [{
    slideId: 'slide-1',
    index: 0,
    layoutKey: 'freeform',
    background: { paint: { type: 'none' } },
    elements: [{
      id: 'authoring-overview-hero',
      kind: 'image',
      box: { x: 1, y: 1, w: 2, h: 2, unit: 'in' },
      zIndex: 1,
      sourceSpan: { startLine: 3, endLine: 3 },
      authoringRef: { slideKey: 'overview', editKey: 'hero', targetKind: 'image' },
      authoringEdit: { capabilities: ['translate'] },
      src: 'data:image/png;base64,AA==',
    }],
  }],
};

describe('manual editing availability', () => {
  it('requires the render model to match the exact ready revision', () => {
    expect(resolveManualEditingAvailability({
      buildState: {
        state: 'ready', presentationId: 'deck-1', versionId: 'revision-3',
        versionNumber: 2, sourceHash: 'a'.repeat(64),
      },
      renderModel: model,
      currentSlide: model.slides[0],
    })).toMatchObject({ available: false, reason: 'version_not_ready' });
  });

  it('enables editing only when the current generated slide has authoring targets', () => {
    expect(resolveManualEditingAvailability({
      buildState: {
        state: 'ready', presentationId: 'deck-1', versionId: 'revision-3',
        versionNumber: 3, sourceHash: 'a'.repeat(64),
      },
      renderModel: model,
      currentSlide: model.slides[0],
    })).toEqual({ available: true, editableTargetCount: 1 });
  });
});
