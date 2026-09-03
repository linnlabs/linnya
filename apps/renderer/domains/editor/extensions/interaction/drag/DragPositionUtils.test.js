// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateTargetIndex } from './DragPositionUtils';

function createRootBlockOuter(id, rect) {
  const outer = document.createElement('div');
  outer.className = 'root-block-outer';
  outer.dataset.id = id;
  outer.getBoundingClientRect = vi.fn(() => ({
    ...rect,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  }));
  document.body.appendChild(outer);
  return outer;
}

function createEditor(blockIds) {
  return {
    state: {
      doc: {
        content: {
          content: blockIds.map((id) => ({
            attrs: { id },
          })),
        },
      },
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('calculateTargetIndex', () => {
  it('uses the viewport anchor block instead of querying every root block', () => {
    const anchor = createRootBlockOuter('block-2', {
      left: 100,
      right: 900,
      top: 200,
      bottom: 300,
      width: 800,
      height: 100,
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [anchor]),
    });
    const querySelector = vi.spyOn(document, 'querySelector');

    const index = calculateTargetIndex(createEditor(['block-0', 'block-1', 'block-2']), {
      clientX: 480,
      clientY: 220,
    });

    expect(index).toBe(2);
    expect(document.elementsFromPoint).toHaveBeenCalledTimes(1);
    expect(querySelector).not.toHaveBeenCalled();
  });

  it('returns the position after the anchor when the pointer is below midpoint', () => {
    const anchor = createRootBlockOuter('block-2', {
      left: 100,
      right: 900,
      top: 200,
      bottom: 300,
      width: 800,
      height: 100,
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [anchor]),
    });

    const index = calculateTargetIndex(createEditor(['block-0', 'block-1', 'block-2']), {
      clientX: 480,
      clientY: 280,
    });

    expect(index).toBe(3);
  });
});
