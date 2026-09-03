// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectNearViewportRootBlockIds,
  collectSampledViewportRootBlocks,
} from './rootBlockViewportSnapshot';

function setRect(el: HTMLElement, rect: {
  top: number;
  left?: number;
  bottom: number;
  right?: number;
  width?: number;
  height?: number;
}): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: rect.top,
      left: rect.left ?? 0,
      bottom: rect.bottom,
      right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 100),
      width: rect.width ?? 100,
      height: rect.height ?? rect.bottom - rect.top,
      x: rect.left ?? 0,
      y: rect.top,
      toJSON: () => ({}),
    }),
  });
}

function createRootBlock(blockId: string): HTMLElement {
  const outer = document.createElement('div');
  outer.className = 'root-block-outer';
  outer.dataset.id = blockId;

  const inner = document.createElement('div');
  inner.className = 'root-block';
  outer.append(inner);
  return outer;
}

describe('rootBlockViewportSnapshot', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'elementsFromPoint');
    vi.restoreAllMocks();
  });

  it('collects visible root blocks by viewport sampling', () => {
    const root = document.createElement('div');
    const first = createRootBlock('first');
    const second = createRootBlock('second');
    root.append(first, second);

    setRect(root, { top: 0, left: 0, bottom: 200, right: 300, width: 300 });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn((_x: number, y: number) => {
        if (y < 100) return [first.firstElementChild as HTMLElement];
        return [second.firstElementChild as HTMLElement];
      }),
    });

    expect(collectSampledViewportRootBlocks({
      editorRoot: root,
      scrollRoot: null,
    })).toEqual([first, second]);
    expect(collectNearViewportRootBlockIds(root, null)).toEqual(['first', 'second']);
  });

  it('does not measure every root block when browser point sampling is available', () => {
    const root = document.createElement('div');
    const visible = createRootBlock('visible');
    const hiddenBlocks = Array.from({ length: 1000 }, (_, index) => {
      const block = createRootBlock(`hidden-${index}`);
      Object.defineProperty(block, 'getBoundingClientRect', {
        configurable: true,
        value: () => {
          throw new Error('offscreen block should not be measured');
        },
      });
      return block;
    });
    root.append(visible, ...hiddenBlocks);
    setRect(root, { top: 0, left: 0, bottom: 400, right: 300, width: 300 });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [visible.firstElementChild as HTMLElement]),
    });

    expect(collectNearViewportRootBlockIds(root, null)).toEqual(['visible']);
  });
});
