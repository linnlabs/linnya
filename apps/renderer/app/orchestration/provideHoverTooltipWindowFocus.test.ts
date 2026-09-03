// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElectronHoverTooltipWindowFocusPort } from './provideHoverTooltipWindowFocus';

afterEach(() => {
  Reflect.deleteProperty(window, 'electronAPI');
  vi.restoreAllMocks();
});

describe('createElectronHoverTooltipWindowFocusPort', () => {
  it('把 Electron 窗口焦点订阅和清理原样适配到 Renderer UI port', () => {
    const removeListener = vi.fn();
    const onWindowFocusState = vi.fn(() => removeListener);
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { onWindowFocusState },
    });
    const listener = vi.fn();

    const unsubscribe = createElectronHoverTooltipWindowFocusPort().subscribe(listener);
    expect(onWindowFocusState).toHaveBeenCalledWith(listener);

    unsubscribe();
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it('普通浏览器夹具没有 Electron preload 时保持 browser-only 语义', () => {
    expect(() => createElectronHoverTooltipWindowFocusPort().subscribe(() => undefined)()).not.toThrow();
  });
});
