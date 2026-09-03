// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlockVisibilityManager } from './useBlockVisibilityManager';
import { setFlag } from '../services/editorFeatureFlags';

interface ObservedEntry {
  target: Element;
  observer: MockIntersectionObserver;
}

const observedEntries: ObservedEntry[] = [];

class MockIntersectionObserver {
  private readonly callback: IntersectionObserverCallback;
  readonly rootMargin?: string;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.rootMargin = options?.rootMargin;
  }

  observe(target: Element): void {
    observedEntries.push({ target, observer: this });
  }

  unobserve(target: Element): void {
    const index = observedEntries.findIndex((entry) => entry.target === target && entry.observer === this);
    if (index >= 0) observedEntries.splice(index, 1);
  }

  disconnect(): void {
    for (let index = observedEntries.length - 1; index >= 0; index -= 1) {
      if (observedEntries[index]?.observer === this) {
        observedEntries.splice(index, 1);
      }
    }
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(target: Element, isIntersecting: boolean): void {
    this.callback(
      [
        {
          target,
          isIntersecting,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver
    );
  }
}

describe('createBlockVisibilityManager', () => {
  afterEach(() => {
    observedEntries.length = 0;
    setFlag('renderVirtualizationDebugLogging', false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('notifies subscribers when a registered block changes visibility', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    const manager = createBlockVisibilityManager({ getRoot: () => null });
    const listener = vi.fn();
    manager.subscribe(listener);

    const el = document.createElement('div');
    el.dataset.id = 'block-a';
    manager.registerBlockVisibility('block-a', el);

    const nearEntry = observedEntries.find(
      (entry) => entry.target === el && entry.observer.rootMargin === '420px 0px'
    );
    expect(nearEntry).toBeDefined();

    nearEntry?.observer.emit(el, false);

    expect(manager.getBlockVisibilityState('block-a').isNearViewport.value).toBe(false);
    expect(listener).toHaveBeenCalledWith({
      blockId: 'block-a',
      band: 'nearViewport',
      isVisible: false,
      el,
    });
  });

  it('debug flag 关闭时不输出可见性日志', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    const manager = createBlockVisibilityManager({ getRoot: () => null });
    const el = document.createElement('div');
    el.dataset.id = 'block-a';

    manager.registerBlockVisibility('block-a', el);

    expect(consoleInfo).not.toHaveBeenCalled();
  });
});
