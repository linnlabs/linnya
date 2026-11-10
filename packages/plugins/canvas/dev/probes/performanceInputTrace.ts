import type { CanvasKernelIntent } from '../../src/renderer/kernel';
import { createCanvasInputEvents } from './performanceInputEvents';

/** 仅INPUT_TRACE安装：document捕获可分辨事件没送到与送到其它DOM，绝不改变焦点或事件。 */
export function createCanvasPerformanceInputTrace(ports: {
  readonly readCanvas: () => HTMLCanvasElement | null;
  readonly readState: (point: { readonly x: number; readonly y: number } | null) => unknown;
}) {
  const stream = createCanvasInputEvents(), startedAt = performance.now();
  let point: { readonly x: number; readonly y: number } | null = null;
  const record = (event: unknown) => stream.record({ atMs: performance.now(), event, state: ports.readState(point) });
  const pointer = (event: PointerEvent) => {
    const canvas = ports.readCanvas(), bounds = canvas?.getBoundingClientRect();
    point = bounds ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top } : null;
    record({ kind: event.type, timestamp: event.timeStamp, targetIsMainCanvas: event.target === canvas,
      targetTag: event.target instanceof Element ? event.target.tagName : null, isTrusted: event.isTrusted,
      pointerId: event.pointerId, pointerType: event.pointerType, button: event.button, buttons: event.buttons,
      clientX: event.clientX, clientY: event.clientY, offsetX: event.offsetX, offsetY: event.offsetY });
  };
  const focus = (event: FocusEvent) => record({ kind: `window-${event.type}`, timestamp: event.timeStamp });
  const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;
  for (const type of types) document.addEventListener(type, pointer, true);
  window.addEventListener('focus', focus); window.addEventListener('blur', focus);
  record({ kind: 'start' });
  return {
    intent(intent: CanvasKernelIntent) { record({ kind: 'intent', intent }); },
    finish() {
      for (const type of types) document.removeEventListener(type, pointer, true);
      window.removeEventListener('focus', focus); window.removeEventListener('blur', focus);
      record({ kind: 'finish' });
      return { clock: 'renderer-performance', timeOrigin: performance.timeOrigin, startedAt, endedAt: performance.now(), ...stream.read() };
    },
  };
}
