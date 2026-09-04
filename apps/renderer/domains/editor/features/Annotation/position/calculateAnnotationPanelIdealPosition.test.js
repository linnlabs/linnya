// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { calculateAnnotationPanelIdealPosition } from './calculateAnnotationPanelIdealPosition';

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

describe('calculateAnnotationPanelIdealPosition', () => {
  it('anchors x to the stable rootBlock right edge instead of the transient annotation handle', () => {
    const blockElement = createElementWithRect({ left: 0, right: 1200, top: 124.44 });
    blockElement.className = 'root-block-outer';
    const rootBlockBodyElement = createElementWithRect({ left: 200, right: 680, top: 124.44 });
    rootBlockBodyElement.className = 'root-block';
    blockElement.append(rootBlockBodyElement);
    const annotationLayer = createElementWithRect({ left: 120, right: 1120 });
    const transientHandle = createElementWithRect({ left: 900, right: 926 });
    const panelFinder = {
      findBlockElement: vi.fn(() => blockElement),
      findAnnotationLayer: vi.fn(() => annotationLayer),
      findAnnotationHandle: vi.fn(() => transientHandle),
      getElementRect: vi.fn((element) => element.getBoundingClientRect()),
    };

    const position = calculateAnnotationPanelIdealPosition({
      blockId: 'root-a',
      editor: null,
      panelFinder,
      includePositionStyle: true,
    });

    expect(position).toEqual({
      top: '124.4px',
      left: '598px',
      position: 'absolute',
    });
    expect(panelFinder.findAnnotationHandle).not.toHaveBeenCalled();
  });

  it('keeps x unchanged when the annotation handle is missing during Host surface churn', () => {
    const blockElement = createElementWithRect({ left: 0, right: 1300, top: 88 });
    blockElement.className = 'root-block-outer';
    const rootBlockBodyElement = createElementWithRect({ left: 240, right: 740, top: 88 });
    rootBlockBodyElement.className = 'root-block';
    blockElement.append(rootBlockBodyElement);
    const annotationLayer = createElementWithRect({ left: 140, right: 1140 });
    const panelFinder = {
      findBlockElement: vi.fn(() => blockElement),
      findAnnotationLayer: vi.fn(() => annotationLayer),
      findAnnotationHandle: vi.fn(() => null),
      getElementRect: vi.fn((element) => element.getBoundingClientRect()),
    };

    const position = calculateAnnotationPanelIdealPosition({
      blockId: 'root-a',
      editor: null,
      panelFinder,
    });

    expect(position).toEqual({
      top: '88px',
      left: '638px',
    });
    expect(panelFinder.findAnnotationHandle).not.toHaveBeenCalled();
  });

  it('uses the actual annotation layer as both x and y coordinate origin', () => {
    const blockElement = createElementWithRect({ left: 0, right: 1300, top: 24 });
    blockElement.className = 'root-block-outer';
    const rootBlockBodyElement = createElementWithRect({ left: 520, right: 1260, top: 340 });
    rootBlockBodyElement.className = 'root-block';
    blockElement.append(rootBlockBodyElement);
    const annotationLayer = createElementWithRect({ left: 400, right: 1400, top: 200 });
    const panelFinder = {
      findBlockElement: vi.fn(() => blockElement),
      findAnnotationLayer: vi.fn(() => annotationLayer),
      getElementRect: vi.fn((element) => element.getBoundingClientRect()),
    };

    const position = calculateAnnotationPanelIdealPosition({
      blockId: 'root-in-right-pane',
      editor: null,
      panelFinder,
    });

    expect(position).toEqual({
      top: '140px',
      left: '898px',
    });
  });
});
