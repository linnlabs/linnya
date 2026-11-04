import type { CanvasCamera } from '../../src/shared';

export interface CanvasZoomTraceState {
  readonly renders: number;
  readonly rasterCards: number;
  readonly bitmaps: number;
  readonly bitmapBytes: number;
  readonly fadingCards: number;
  readonly pending: number;
  readonly running: boolean;
  readonly completed: number;
  readonly activeImages: number;
  readonly activePreviews: number;
  readonly activeReferences: number;
  readonly camera?: CanvasCamera;
  readonly viewportCards?: number;
  readonly identityBytes?: number;
  readonly requestedTiles?: number;
  readonly requestedPixels?: number;
  readonly discarded?: number;
}

/** 观察器只在显式ZOOM_TRACE阶段存在，不能以其结果替代无分析器硬件门槛。 */
export function createCanvasZoomTimeline(readState: () => CanvasZoomTraceState, phase: 'zoom' | 'visible-update' = 'zoom', captureInputs = false) {
  const frames: { readonly timestamp: number; readonly observedAt: number; readonly state: CanvasZoomTraceState }[] = [];
  const paints: number[] = [];
  const wheelInputs: { readonly timestamp: number; readonly receivedAt: number; readonly deltaX: number; readonly deltaY: number;
    readonly x: number; readonly y: number; readonly control: boolean }[] = [];
  const startedAt = performance.now(), initial = readState();
  const prefix = `canvas-probe:${phase}`;
  performance.mark(`${prefix}-start`);
  const painted = (event: Event) => {
    if (!(event.target instanceof HTMLCanvasElement)) return;
    const now = performance.now(); paints.push(now); performance.mark(`${prefix}-paint`);
  };
  const wheel = (event: WheelEvent) => {
    const receivedAt = performance.now();
    wheelInputs.push({ timestamp: event.timeStamp, receivedAt, deltaX: event.deltaX, deltaY: event.deltaY, x: event.clientX, y: event.clientY, control: event.ctrlKey });
    performance.mark(`${prefix}-wheel`, { startTime: receivedAt });
  };
  document.addEventListener('paint', painted, true);
  if (captureInputs) document.addEventListener('wheel', wheel, true);
  return {
    frame(timestamp: number) {
      const observedAt = performance.now();
      performance.mark(`${prefix}-frame`, { startTime: timestamp });
      frames.push({ timestamp, observedAt, state: readState() });
    },
    finish() {
      document.removeEventListener('paint', painted, true);
      if (captureInputs) document.removeEventListener('wheel', wheel, true);
      performance.mark(`${prefix}-end`);
      return { timeOrigin: performance.timeOrigin, startedAt, endedAt: performance.now(), initial,
        final: readState(), frames, paints, ...(captureInputs ? { wheelInputs } : {}) };
    },
  };
}
