// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelOverlapDetector } from './PanelOverlapDetector';

function createElementWithRect({ right, left = 0, top = 0, height = 20 }) {
  const element = document.createElement('div');
  Object.defineProperty(element, 'offsetTop', {
    configurable: true,
    value: top,
  });
  element.getBoundingClientRect = vi.fn(() => ({
    x: left,
    y: top,
    top,
    left,
    right,
    bottom: top + height,
    width: right - left,
    height,
    toJSON: () => ({}),
  }));
  return element;
}

function createPanelFinder({ blockElement, wrapper }) {
  return {
    findBlockElement: vi.fn(() => blockElement),
    findScrollContentWrapper: vi.fn(() => wrapper),
    findEditorShell: vi.fn(() => document.createElement('div')),
    findAnnotationPanel: vi.fn(() => null),
    getElementRect: vi.fn((element) => element.getBoundingClientRect()),
  };
}

function createAnnotationStore(annotation) {
  const annotations = [annotation];

  return {
    annotations: { value: annotations },
    getAnnotationById: vi.fn((id) => annotations.find((item) => item.id === id) ?? null),
    updateAnnotation: vi.fn(async (id, patch) => {
      const target = annotations.find((item) => item.id === id);
      if (target) Object.assign(target, patch);
      return true;
    }),
  };
}

describe('PanelOverlapDetector', () => {
  beforeEach(() => {
    globalThis.IntersectionObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes stale left back to the annotation handle anchor while resolving overlaps', async () => {
    const blockElement = createElementWithRect({ left: 0, right: 1300, top: 88 });
    blockElement.className = 'root-block-outer';
    const rootBlockBodyElement = createElementWithRect({ left: 240, right: 740, top: 88 });
    rootBlockBodyElement.className = 'root-block';
    blockElement.append(rootBlockBodyElement);
    const wrapper = createElementWithRect({ left: 140, right: 1140 });
    const annotation = {
      id: 'annotation-a',
      blockId: 'root-a',
      state: 'active',
      position: { top: 88, left: 1200 },
    };
    const annotationStore = createAnnotationStore(annotation);
    const detector = createPanelOverlapDetector(
      createPanelFinder({ blockElement, wrapper }),
      annotationStore,
      null
    );

    await detector.handlePanelOverlaps();

    expect(annotationStore.updateAnnotation).toHaveBeenCalledWith('annotation-a', {
      position: { top: 88, left: 638 },
    });
    expect(annotation.position).toEqual({ top: 88, left: 638 });
  });

  it('keeps creating annotation left untouched during overlap handling', async () => {
    const blockElement = createElementWithRect({ left: 0, right: 1300, top: 88 });
    blockElement.className = 'root-block-outer';
    const rootBlockBodyElement = createElementWithRect({ left: 240, right: 740, top: 88 });
    rootBlockBodyElement.className = 'root-block';
    blockElement.append(rootBlockBodyElement);
    const wrapper = createElementWithRect({ left: 140, right: 1140 });
    const annotation = {
      id: 'annotation-a',
      blockId: 'root-a',
      state: 'creating',
      position: { top: 88, left: 1200 },
    };
    const annotationStore = createAnnotationStore(annotation);
    const detector = createPanelOverlapDetector(
      createPanelFinder({ blockElement, wrapper }),
      annotationStore,
      null
    );

    await detector.handlePanelOverlaps();

    expect(annotationStore.updateAnnotation).not.toHaveBeenCalled();
    expect(annotation.position).toEqual({ top: 88, left: 1200 });
  });
});
