interface PaintTraceEvent {
  readonly kind: string; readonly atMs: number; readonly canvasId?: number; readonly requestId?: number;
  readonly width?: number; readonly height?: number; readonly cssWidth?: string; readonly cssHeight?: string;
  readonly fragments?: number; readonly measuredCards?: number; readonly durationMs?: number; readonly completed?: boolean;
  readonly targetWidth?: number; readonly targetHeight?: number;
  readonly api?: 'webgl1' | 'webgl2'; readonly method?: string; readonly startedAtMs?: number;
  readonly sourceKind?: string; readonly sourceWidth?: number; readonly sourceHeight?: number;
  readonly timeout?: Readonly<Record<string, string | number | boolean | null>>;
}
interface CanvasPaintIdentity { readonly id: number; measuredCards: number; requestId: number }

/** 只识别原调用已提供的source和尺寸，不访问像素或假定WebGL2使用WebGL1的重载位置。 */
export function canvasTextureUploadFacts(method: 'texImage2D' | 'texSubImage2D', args: readonly unknown[]) {
  const index = method === 'texImage2D' && args.length === 6 ? 5 : method === 'texSubImage2D' && args.length === 7 ? 6 : 8;
  const source = args[index];
  let sourceKind = 'unknown', sourceWidth: number | undefined, sourceHeight: number | undefined;
  if (source === null) sourceKind = 'null-allocation';
  else if (typeof source === 'number') sourceKind = 'buffer-offset';
  else if (ArrayBuffer.isView(source)) sourceKind = 'typed-array';
  else if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) { sourceKind = 'canvas'; sourceWidth = source.width; sourceHeight = source.height; }
  else if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) { sourceKind = 'image-bitmap'; sourceWidth = source.width; sourceHeight = source.height; }
  else if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) { sourceKind = 'offscreen-canvas'; sourceWidth = source.width; sourceHeight = source.height; }
  const widthIndex = method === 'texImage2D' ? 3 : 4;
  const argumentWidth = args[widthIndex], argumentHeight = args[widthIndex + 1];
  const width = args.length >= 9 && typeof argumentWidth === 'number' ? argumentWidth : sourceWidth;
  const height = args.length >= 9 && typeof argumentHeight === 'number' ? argumentHeight : sourceHeight;
  return { method, sourceKind, sourceWidth, sourceHeight, width, height };
}

/** 仅诊断入口安装：保留原生调用、this、重载参数、返回值和异常，不驱动任何paint。 */
export function createCanvasPerformancePaintTrace() {
  const events: PaintTraceEvent[] = [], restore: (() => void)[] = [];
  const identities = new WeakMap<HTMLCanvasElement, CanvasPaintIdentity>();
  const copies = new WeakMap<OffscreenCanvas, CanvasPaintIdentity>();
  let canvasCount = 0, requestCount = 0, overflow = 0, latest: CanvasPaintIdentity | undefined;
  const identity = (canvas: HTMLCanvasElement) => {
    let value = identities.get(canvas);
    if (!value) { value = { id: ++canvasCount, measuredCards: 0, requestId: 0 }; identities.set(canvas, value); }
    return value;
  };
  const record = (kind: string, data: Omit<PaintTraceEvent, 'kind' | 'atMs'> = {}) => {
    if (events.length >= 16384) { overflow++; return; }
    events.push({ kind, atMs: performance.now(), ...data });
  };
  const frame = (canvas: HTMLCanvasElement) => {
    const value = identity(canvas);
    return { canvasId: value.id, requestId: value.requestId, width: canvas.width, height: canvas.height,
      cssWidth: canvas.style.width, cssHeight: canvas.style.height,
      fragments: canvas.firstElementChild?.childElementCount ?? 0, measuredCards: value.measuredCards };
  };
  const observe = (target: object, name: string, invoke: (call: () => unknown, context: unknown, args: readonly unknown[]) => unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, name), original: unknown = descriptor?.value;
    if (!descriptor || typeof original !== 'function') throw new Error(`paint_trace_native_method_missing:${name}`);
    Object.defineProperty(target, name, { ...descriptor, value: function(this: unknown, ...args: unknown[]) {
      return invoke(() => Reflect.apply(original, this, args), this, args);
    } });
    restore.push(() => Object.defineProperty(target, name, descriptor));
  };
  const timed = (kind: string, data: Omit<PaintTraceEvent, 'kind' | 'atMs'>, call: () => unknown) => {
    const started = performance.now(); let completed = false; record(`${kind}-start`, data);
    try { const result = call(); completed = true; return result; }
    finally { record(`${kind}-end`, { ...data, durationMs: performance.now() - started, completed }); }
  };
  const painted = (event: Event) => {
    if (event.target instanceof HTMLCanvasElement && identities.has(event.target)) record('paint', frame(event.target));
  };
  const observer = new MutationObserver(records => {
    for (const mutation of records) {
      const viewport = mutation.target;
      if (!(viewport instanceof HTMLElement) || !(viewport.parentElement instanceof HTMLCanvasElement)) continue;
      const first = viewport.firstElementChild;
      // 正式measure批先安装每卡一个非定位source，atlas批随后安装绝对定位的每片slot。
      if (first instanceof HTMLElement && first.style.position !== 'absolute') identity(viewport.parentElement).measuredCards = viewport.childElementCount;
    }
  });
  const dispose = () => { observer.disconnect(); document.removeEventListener('paint', painted, true); for (const undo of restore.splice(0).reverse()) undo(); };
  try {
    observer.observe(document.body, { childList: true, subtree: true }); document.addEventListener('paint', painted, true);
    observe(HTMLCanvasElement.prototype, 'requestPaint', (call, context) => {
      if (context instanceof HTMLCanvasElement) {
        latest = identity(context); latest.requestId = ++requestCount; record('request-paint', frame(context));
      }
      return call();
    });
    observe(CanvasRenderingContext2D.prototype, 'drawElementImage', (call, context) => context instanceof CanvasRenderingContext2D
      ? timed('draw-element', frame(context.canvas), call) : call());
    observe(OffscreenCanvasRenderingContext2D.prototype, 'drawImage', (call, context, args) => {
      const source = args[0];
      if (!(context instanceof OffscreenCanvasRenderingContext2D) || !(source instanceof HTMLCanvasElement) || !identities.has(source)) return call();
      copies.set(context.canvas, identity(source));
      return timed('copy', { ...frame(source), targetWidth: context.canvas.width, targetHeight: context.canvas.height }, call);
    });
    observe(OffscreenCanvas.prototype, 'transferToImageBitmap', (call, context) => {
      if (!(context instanceof OffscreenCanvas)) return call();
      const value = copies.get(context);
      return value ? timed('transfer', { canvasId: value.id, requestId: value.requestId, width: context.width, height: context.height }, call) : call();
    });
    for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const method of ['texImage2D', 'texSubImage2D'] as const) observe(prototype, method, (call, context, args) => {
        const startedAtMs = performance.now(), facts = canvasTextureUploadFacts(method, args);
        const api = context instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl1'; let completed = false;
        try { const value = call(); completed = true; return value; }
        finally { record('texture-upload', { ...facts, api, startedAtMs, durationMs: performance.now() - startedAtMs, completed }); }
      });
    }
    const original = console.error;
    console.error = (...args: unknown[]) => {
      if (args[0] === '[Canvas] HTML paint timeout') {
        const input = args[1], timeout: Record<string, string | number | boolean | null> = {};
        if (typeof input === 'object' && input !== null) for (const key of ['visibility', 'connected', 'requestPaint', 'width', 'height', 'display', 'timeoutMs']) {
          const value: unknown = Reflect.get(input, key);
          if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') timeout[key] = value;
        }
        record('paint-timeout', { canvasId: latest?.id, requestId: latest?.requestId, timeout });
      }
      original.apply(console, args);
    };
    restore.push(() => { console.error = original; });
  } catch (error) { dispose(); throw error; }
  return {
    finish() { dispose(); return { diagnostic: 'paint-lifecycle-real-calls', timeOrigin: performance.timeOrigin,
      clock: 'unmodified-performance.now', events, canvasCount, requestCount, overflow }; },
  };
}
