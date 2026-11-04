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
}

/** 观察器只在显式ZOOM_TRACE阶段存在，不能以其结果替代无分析器硬件门槛。 */
export function createCanvasZoomTimeline(readState: () => CanvasZoomTraceState) {
  const frames: { readonly timestamp: number; readonly observedAt: number; readonly state: CanvasZoomTraceState }[] = [];
  const paints: number[] = [];
  const startedAt = performance.now(), initial = readState();
  performance.mark('canvas-probe:zoom-start');
  const painted = (event: Event) => {
    if (!(event.target instanceof HTMLCanvasElement)) return;
    const now = performance.now(); paints.push(now); performance.mark('canvas-probe:zoom-paint');
  };
  document.addEventListener('paint', painted, true);
  return {
    frame(timestamp: number) {
      const observedAt = performance.now();
      performance.mark('canvas-probe:zoom-frame', { startTime: timestamp });
      frames.push({ timestamp, observedAt, state: readState() });
    },
    finish() {
      document.removeEventListener('paint', painted, true); performance.mark('canvas-probe:zoom-end');
      return { timeOrigin: performance.timeOrigin, startedAt, endedAt: performance.now(), initial,
        final: readState(), frames, paints };
    },
  };
}
