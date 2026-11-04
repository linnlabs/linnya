// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createCanvasDocumentFocusSpan, createCanvasPerformanceFocusQualification } from '../performanceFocusQualification';

class FocusSource extends EventEmitter {
  focused = true;
  isFocused() { return this.focused; }
}
class Window extends FocusSource { readonly webContents = new FocusSource(); }
const clock = { timeOrigin: 1000, now: () => 10 };
const documentFocus = { start: true, end: true, firstLossAtMs: null };
afterEach(() => { vi.restoreAllMocks(); });

it('三段实际边界和段内状态均合格才准入，结束卸载owned blur监听', () => {
  const window = new Window(), focus = createCanvasPerformanceFocusQualification(window, ['pan', 'zoom', 'drag'], clock);
  for (const gesture of ['pan', 'zoom', 'drag'] as const) { focus.begin(gesture); focus.finish({ documentFocus }); }
  const result = focus.read();
  expect(result.qualified).toBe(true); expect(result.segments).toHaveLength(3); expect(result.firstViolation).toBe(null);
  expect(window.listenerCount('blur')).toBe(0); expect(window.webContents.listenerCount('blur')).toBe(0);
});

it('窗口中途失焦又返回，边界为true且move500仍不能恢复采样资格', () => {
  const window = new Window(), focus = createCanvasPerformanceFocusQualification(window, ['drag'], clock);
  focus.begin('drag'); window.focused = false; window.emit('blur'); window.focused = true;
  focus.finish({ documentFocus, movedCards: 500 });
  const result = focus.read(), segment = result.segments[0];
  expect(segment.native.start.window).toBe(true); expect(segment.native.end.window).toBe(true);
  expect(result.qualified).toBe(false); expect(segment.reasons).toContain('native_focus_lost_during_gesture');
  expect(segment.native.firstLoss).toEqual({ source: 'window', atMs: 10 });
});

it('Renderer段内blur不因重新聚焦消失；finish后不再记录其它段的事件', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const span = createCanvasDocumentFocusSpan(); window.dispatchEvent(new FocusEvent('blur'));
  const observed = span.finish(), windowPort = new Window();
  const focus = createCanvasPerformanceFocusQualification(windowPort, ['zoom'], clock); focus.begin('zoom'); focus.finish({ documentFocus: observed });
  expect(observed.start).toBe(true); expect(observed.end).toBe(true); expect(observed.firstLossAtMs).not.toBe(null);
  expect(focus.read().segments[0].reasons).toContain('document_focus_lost_during_gesture');
  window.dispatchEvent(new FocusEvent('blur')); expect(span.finish()).toEqual(observed);
});

it('失焦边界或异常缺少Renderer事实都不准入，失败收口保留第一现场并清理监听', () => {
  const window = new Window(); window.focused = false;
  const focus = createCanvasPerformanceFocusQualification(window, ['pan'], clock); focus.begin('pan');
  expect(() => focus.finish({ frames: 10 })).toThrow(); focus.abort();
  expect(focus.read().qualified).toBe(false);
  expect(focus.read().segments[0].reasons).toEqual(['native_start_unfocused', 'native_end_unfocused', 'gesture_incomplete']);
  expect(window.listenerCount('blur')).toBe(0); expect(window.webContents.listenerCount('blur')).toBe(0);
});
