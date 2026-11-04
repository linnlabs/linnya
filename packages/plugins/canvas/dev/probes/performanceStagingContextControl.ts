export type CanvasStagingContextArm = 'A' | 'B';

interface ContextFact {
  readonly atMs: number;
  readonly settingsProvided: boolean;
  readonly actual: CanvasRenderingContext2DSettings | null;
  readonly error?: string;
}

/** 仅固定夹具自己的staging；实验不能顺带切换Pixi、地图或逐片Offscreen目标。 */
export function createCanvasStagingContextControl(arm: CanvasStagingContextArm) {
  const prototype = HTMLCanvasElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getContext'), original: unknown = descriptor?.value;
  if (!descriptor || typeof original !== 'function') throw new Error('staging_context_native_method_missing');
  const seen = new WeakSet<HTMLCanvasElement>(), contexts: ContextFact[] = [];
  const installedAtMs = performance.now();
  let active = true;
  Object.defineProperty(prototype, 'getContext', { ...descriptor, value: function(this: unknown, ...args: unknown[]) {
    if (!(this instanceof HTMLCanvasElement) || args[0] !== '2d'
      || !this.parentElement?.classList.contains('canvas-raster-staging')
      || !(this.getAttribute('content') === 'drawable' || this.hasAttribute('layoutsubtree')) || seen.has(this)) {
      return Reflect.apply(original, this, args);
    }
    seen.add(this);
    const atMs = performance.now(), settingsProvided = args[1] !== undefined;
    // 首次创建时只改标准hint；原有alpha/色域等设置继续原样传递。
    const settings = typeof args[1] === 'object' && args[1] !== null ? args[1] : {};
    const forwarded = arm === 'B' ? [args[0], { ...settings, willReadFrequently: true }, ...args.slice(2)] : args;
    try {
      const result: unknown = Reflect.apply(original, this, forwarded);
      contexts.push({ atMs, settingsProvided, actual: result instanceof CanvasRenderingContext2D ? result.getContextAttributes() : null });
      return result;
    } catch (error) {
      contexts.push({ atMs, settingsProvided, actual: null, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  } });
  return {
    finish() {
      if (active) { Object.defineProperty(prototype, 'getContext', descriptor); active = false; }
      return { diagnostic: 'staging-context-control', arm, clock: 'unmodified-performance.now', timeOrigin: performance.timeOrigin,
        installedAtMs, requestedWillReadFrequently: arm === 'B', stagingContexts: contexts.length, contexts,
        effective: contexts.length === 1 && contexts[0].actual !== null && (arm === 'A' || contexts[0].actual.willReadFrequently === true) };
    },
  };
}
