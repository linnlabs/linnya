import { describe, expect, it } from 'vitest';
import {
  resolveSlideStageRenderState,
  type SlideStageRenderStateInput,
} from './slideStageRenderState';

function makeInput(overrides: Partial<SlideStageRenderStateInput> = {}): SlideStageRenderStateInput {
  return {
    hasTargetSlideRender: true,
    hasDisplayedSlideRender: true,
    preparingVisualResources: false,
    visualResourcePreparationFailed: false,
    currentSlideKonvaCompatible: true,
    hasRenderSlideSize: true,
    sourceSelectionModeEnabled: false,
    canEditSourceSelection: true,
    ...overrides,
  };
}

describe('resolveSlideStageRenderState', () => {
  it('renders with Konva when render-model has a compatible current slide', () => {
    const state = resolveSlideStageRenderState(makeInput({
      sourceSelectionModeEnabled: false,
    }));

    expect(state.renderMode).toBe('konva');
    expect(state.shouldRenderKonva).toBe(true);
    expect(state.canSelectSourceElements).toBe(false);
  });

  it('enables source selection without changing the render mode', () => {
    const state = resolveSlideStageRenderState(makeInput({
      sourceSelectionModeEnabled: true,
    }));

    expect(state.renderMode).toBe('konva');
    expect(state.canSelectSourceElements).toBe(true);
    expect(state.shouldShowSourcePrompt).toBe(true);
  });

  it('reports a render error instead of using a second renderer when Konva cannot render the current slide', () => {
    const state = resolveSlideStageRenderState(makeInput({
      hasRenderSlideSize: false,
      sourceSelectionModeEnabled: true,
    }));

    expect(state.renderMode).toBe('error');
    expect(state.shouldRenderKonva).toBe(false);
    expect(state.canSelectSourceElements).toBe(false);
  });

  it('keeps a prepared frame visible while the next page resources are loading', () => {
    const state = resolveSlideStageRenderState(makeInput({
      preparingVisualResources: true,
    }));

    expect(state.renderMode).toBe('konva');
    expect(state.hasRenderableSlide).toBe(true);
  });

  it('uses the neutral loading state before the first visual frame is ready', () => {
    const state = resolveSlideStageRenderState(makeInput({
      hasDisplayedSlideRender: false,
      currentSlideKonvaCompatible: false,
      preparingVisualResources: true,
    }));

    expect(state.renderMode).toBe('loading');
    expect(state.hasRenderableSlide).toBe(false);
  });

  it('reports the real visual preparation failure instead of a page-selection empty state', () => {
    const state = resolveSlideStageRenderState(makeInput({
      hasDisplayedSlideRender: false,
      currentSlideKonvaCompatible: false,
      visualResourcePreparationFailed: true,
    }));

    expect(state.renderMode).toBe('error');
    expect(state.hasRenderableSlide).toBe(false);
  });

  it('reports an empty deck only when render-model has no current page', () => {
    const state = resolveSlideStageRenderState(makeInput({
      hasTargetSlideRender: false,
      hasDisplayedSlideRender: false,
      currentSlideKonvaCompatible: false,
    }));

    expect(state.renderMode).toBe('empty');
    expect(state.hasRenderableSlide).toBe(false);
  });
});
