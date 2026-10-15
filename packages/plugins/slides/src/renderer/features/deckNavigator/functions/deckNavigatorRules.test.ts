import { describe, expect, it } from 'vitest';
import type { SlidesDocumentBuildState } from '@plugin/slides/shared/documentSource';
import type { PresentationRenderModel } from '../../../types/render';
import { resolveBlankSlideInsertion } from './blankSlideInsertion';
import { resolveNearestScrollOffset } from './nearestScrollOffset';
import { resolveSlideGridLayout } from './slideGridLayout';
import { resolveSlideNavigationIndex } from './slideKeyboardNavigation';

const READY: SlidesDocumentBuildState = {
  state: 'ready',
  presentationId: 'deck-1',
  versionId: 'revision-3',
  versionNumber: 3,
  sourceHash: 'a'.repeat(64),
};

function makeModel(overrides: Partial<PresentationRenderModel> = {}): PresentationRenderModel {
  return {
    presentationId: 'deck-1',
    title: 'Deck',
    version: 3,
    sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    slides: [0, 1, 2].map(index => ({
      slideId: `slide-${index}`,
      index,
      layoutKey: 'freeform',
      background: { paint: { type: 'none' } },
      elements: [],
    })),
    capabilities: { hasSemanticRender: true, hasReferencePreview: false, hasHitTest: true, hasSelection: true },
    ...overrides,
  };
}

describe('resolveSlideGridLayout', () => {
  it('fits as many minimum-width columns as possible and shares the remaining width', () => {
    const layout = resolveSlideGridLayout({ viewportWidth: 1200, slideSize: undefined, slideCount: 10 });

    expect(layout.columns).toBe(4);
    expect(layout.cellWidth).toBe(266);
    expect(layout.thumbnailHeight).toBe(150);
    expect(layout.rows).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
    expect(layout.rasterWidth).toBe(320);
  });

  it('keeps one readable column in a narrow pane and caps very wide cards', () => {
    expect(resolveSlideGridLayout({ viewportWidth: 180, slideSize: undefined, slideCount: 2 }))
      .toMatchObject({ columns: 1, cellWidth: 240 });
    expect(resolveSlideGridLayout({ viewportWidth: 500, slideSize: undefined, slideCount: 1 }))
      .toMatchObject({ columns: 1, cellWidth: 360, rasterWidth: 384 });
  });

  it('derives card height from the document aspect ratio', () => {
    const layout = resolveSlideGridLayout({
      viewportWidth: 1200,
      slideSize: { width: 7.5, height: 10 },
      slideCount: 0,
    });
    expect(layout.thumbnailHeight).toBe(Math.round(layout.cellWidth / 0.75));
    expect(layout.rows).toEqual([]);
  });
});

describe('resolveSlideNavigationIndex', () => {
  const grid = { slideCount: 10, columns: 4 };

  it('moves within the filmstrip without wrapping', () => {
    expect(resolveSlideNavigationIndex({ key: 'ArrowLeft', currentIndex: 0, slideCount: 3, columns: 1 })).toBe(0);
    expect(resolveSlideNavigationIndex({ key: 'ArrowRight', currentIndex: 2, slideCount: 3, columns: 1 })).toBe(2);
    expect(resolveSlideNavigationIndex({ key: 'End', currentIndex: 0, slideCount: 3, columns: 1 })).toBe(2);
  });

  it('moves by rows in the grid and lands on the last slide of a shorter final row', () => {
    expect(resolveSlideNavigationIndex({ ...grid, key: 'ArrowDown', currentIndex: 1 })).toBe(5);
    expect(resolveSlideNavigationIndex({ ...grid, key: 'ArrowDown', currentIndex: 7 })).toBe(9);
    expect(resolveSlideNavigationIndex({ ...grid, key: 'ArrowDown', currentIndex: 9 })).toBe(9);
    expect(resolveSlideNavigationIndex({ ...grid, key: 'ArrowUp', currentIndex: 2 })).toBe(2);
    expect(resolveSlideNavigationIndex({ ...grid, key: 'ArrowUp', currentIndex: 9 })).toBe(5);
    expect(resolveSlideNavigationIndex({ ...grid, key: 'Home', currentIndex: 9 })).toBe(0);
  });
});

describe('resolveBlankSlideInsertion', () => {
  const base = { documentId: 'deck-1', buildState: READY, renderModel: makeModel(), currentSlideIndex: 1 };

  it('inserts after the current slide of the visible ready revision', () => {
    expect(resolveBlankSlideInsertion(base)).toEqual({ available: true, index: 2 });
    expect(resolveBlankSlideInsertion({ ...base, currentSlideIndex: 2 })).toEqual({ available: true, index: 3 });
  });

  it('is unavailable for drafts, non-generated decks and a stale visible revision', () => {
    expect(resolveBlankSlideInsertion({ ...base, buildState: null }))
      .toEqual({ available: false, reason: 'build_not_ready' });
    expect(resolveBlankSlideInsertion({ ...base, renderModel: makeModel({ sourceKind: 'imported' }) }))
      .toEqual({ available: false, reason: 'source_not_generated' });
    expect(resolveBlankSlideInsertion({ ...base, renderModel: makeModel({ version: 2 }) }))
      .toEqual({ available: false, reason: 'version_not_ready' });
  });
});

describe('resolveNearestScrollOffset', () => {
  const viewport = { scrollOffset: 100, viewportSize: 400, inset: 16 };

  it('keeps a visible item in place', () => {
    expect(resolveNearestScrollOffset({ ...viewport, start: 200, end: 300 })).toBeNull();
  });

  it('scrolls the least distance to reveal an item before or after the viewport', () => {
    expect(resolveNearestScrollOffset({ ...viewport, start: 40, end: 140 })).toBe(24);
    expect(resolveNearestScrollOffset({ ...viewport, start: 450, end: 550 })).toBe(166);
    expect(resolveNearestScrollOffset({ ...viewport, scrollOffset: 0, start: 0, end: 100 })).toBeNull();
  });
});
