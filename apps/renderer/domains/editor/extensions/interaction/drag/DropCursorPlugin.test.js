// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupDropIndicator,
  getDropPosition,
  handleDragOver,
  hideDropIndicator,
  showDropIndicator,
} from './DropCursorPlugin';

function createRootBlockOuter(rect) {
  const outer = document.createElement('div');
  outer.className = 'root-block-outer';
  const inner = document.createElement('div');
  inner.className = 'root-block';
  outer.appendChild(inner);

  outer.getBoundingClientRect = vi.fn(() => ({
    ...rect,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  }));
  inner.getBoundingClientRect = vi.fn(() => ({
    left: 120,
    right: 860,
    top: rect.top,
    bottom: rect.bottom,
    width: 740,
    height: rect.height,
    x: 120,
    y: rect.top,
    toJSON: () => rect,
  }));

  document.body.appendChild(outer);
  return outer;
}

afterEach(() => {
  cleanupDropIndicator();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DropCursorPlugin', () => {
  it('uses viewport point sampling instead of scanning all root blocks', () => {
    const rootBlock = createRootBlockOuter({
      left: 100,
      right: 900,
      top: 200,
      bottom: 320,
      width: 800,
      height: 120,
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [rootBlock]),
    });
    const queryAll = vi.spyOn(document, 'querySelectorAll');

    const position = getDropPosition({ clientX: 480, clientY: 250 });

    expect(position).toMatchObject({
      top: 200,
      index: -1,
      left: 120,
      width: 740,
    });
    expect(document.elementsFromPoint).toHaveBeenCalledTimes(1);
    expect(queryAll).not.toHaveBeenCalled();
  });

  it('places the indicator after the sampled block when the pointer is below the midpoint', () => {
    const rootBlock = createRootBlockOuter({
      left: 100,
      right: 900,
      top: 200,
      bottom: 320,
      width: 800,
      height: 120,
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [rootBlock]),
    });

    const position = getDropPosition({ clientX: 480, clientY: 300 });

    expect(position?.top).toBe(320);
  });

  it('applies sampled block width without querying every block', () => {
    const queryAll = vi.spyOn(document, 'querySelectorAll');

    showDropIndicator({
      top: 180,
      left: 120,
      width: 740,
    });

    const indicator = document.querySelector('.custom-drop-indicator');
    expect(indicator?.style.top).toBe('180px');
    expect(indicator?.style.left).toBe('120px');
    expect(indicator?.style.width).toBe('740px');
    expect(queryAll).not.toHaveBeenCalled();

    hideDropIndicator();
    expect(indicator?.style.display).toBe('none');
  });

  it('coalesces dragover DOM measurement into one animation frame', () => {
    const rootBlock = createRootBlockOuter({
      left: 100,
      right: 900,
      top: 200,
      bottom: 320,
      width: 800,
      height: 120,
    });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [rootBlock]),
    });

    let rafCallback = null;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
      rafCallback = callback;
      return 42;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const firstEvent = {
      clientX: 480,
      clientY: 240,
      dataTransfer: { types: [], dropEffect: '' },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    const latestEvent = {
      clientX: 480,
      clientY: 300,
      dataTransfer: { types: [], dropEffect: '' },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    handleDragOver(firstEvent);
    handleDragOver(latestEvent);

    expect(document.elementsFromPoint).not.toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(firstEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(latestEvent.preventDefault).toHaveBeenCalledTimes(1);

    rafCallback();

    expect(document.elementsFromPoint).toHaveBeenCalledTimes(1);
    expect(document.elementsFromPoint).toHaveBeenCalledWith(480, 300);
    expect(document.querySelector('.custom-drop-indicator')?.style.top).toBe('320px');
    expect(window.__EDITOR_DRAG_PERF__?.getLast()).toMatchObject({
      kind: 'dragover-frame',
      eventCount: 2,
      hasDropPosition: true,
    });
  });
});
