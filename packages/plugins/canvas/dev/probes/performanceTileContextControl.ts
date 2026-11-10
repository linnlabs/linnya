import type { CanvasPerformanceContextArm } from './performanceContextControl';

interface AttributedOffscreenContext extends OffscreenCanvasRenderingContext2D { getContextAttributes(): CanvasRenderingContext2DSettings }
function canReadAttributes(context: OffscreenCanvasRenderingContext2D): context is AttributedOffscreenContext {
  // Chromium150已稳定开放，当前lib.dom尚未声明；缺方法时保留null让实验无效，不假造attrs。
  return typeof Reflect.get(context, 'getContextAttributes') === 'function';
}

interface TileContextFact {
  readonly id: number; readonly atMs: number; readonly width: number; readonly height: number; readonly settingsProvided: boolean;
  actual: CanvasRenderingContext2DSettings | null;
  copyCalls: number; stagingCopies: number; copyCompleted: number; transfers: number; transferCompleted: number; ordered: boolean;
  copyAtMs?: number; transferAtMs?: number; sourceWidth?: number; sourceHeight?: number;
  drawArguments?: readonly (number | null)[]; bitmapWidth?: number; bitmapHeight?: number;
  error?: { readonly stage: string; readonly message: string };
}
interface UnchangedContextFact {
  readonly atMs: number; readonly width: number; readonly height: number;
  actual: CanvasRenderingContext2DSettings | null; error?: string;
}

/** 固定text夹具的事后归属自证，不是生产级的先验Offscreen隔离。 */
export function createCanvasTileContextControl(host: HTMLElement, arm: CanvasPerformanceContextArm) {
  const restore: (() => void)[] = [], seen = new WeakSet<OffscreenCanvas>();
  const targets = new WeakMap<OffscreenCanvas, TileContextFact>(), contexts: TileContextFact[] = [];
  const unchangedContexts: UnchangedContextFact[] = [];
  const installedAtMs = performance.now();
  let staging: HTMLCanvasElement | null = null, stagingChanged = false, uncontrolledCopies = 0, overflow = 0;
  const readStaging = () => {
    const current = host.firstElementChild;
    if (host.childElementCount !== 1 || !(current instanceof HTMLCanvasElement)
      || !(current.getAttribute('content') === 'drawable' || current.hasAttribute('layoutsubtree'))) return null;
    if (staging && staging !== current) { stagingChanged = true; return null; }
    staging = current; return current;
  };
  const observe = (target: object, name: string, invoke: (call: (args: readonly unknown[]) => unknown, context: unknown, args: readonly unknown[]) => unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, name), original: unknown = descriptor?.value;
    if (!descriptor || typeof original !== 'function') throw new Error(`tile_context_native_method_missing:${name}`);
    Object.defineProperty(target, name, { ...descriptor, value: function(this: unknown, ...args: unknown[]) {
      return invoke(forwarded => Reflect.apply(original, this, forwarded), this, args);
    } });
    restore.push(() => Object.defineProperty(target, name, descriptor));
  };
  const failed = (fact: TileContextFact, stage: string, error: unknown) => {
    fact.error = { stage, message: error instanceof Error ? error.message : String(error) };
  };
  const dispose = () => { for (const undo of restore.splice(0).reverse()) undo(); };
  try {
    observe(OffscreenCanvas.prototype, 'getContext', (call, context, args) => {
      if (!(context instanceof OffscreenCanvas) || args[0] !== '2d' || seen.has(context)) return call(args);
      seen.add(context);
      const settings = typeof args[1] === 'object' && args[1] !== null ? args[1] : {};
      // Pixi字体测量本来就显式true；两臂都原样传递，不把不改变的调用混成tile候选。
      if (Reflect.get(settings, 'willReadFrequently') === true) {
        if (contexts.length + unchangedContexts.length >= 16384) { overflow++; return call(args); }
        const fact: UnchangedContextFact = { atMs: performance.now(), width: context.width, height: context.height, actual: null };
        unchangedContexts.push(fact);
        try {
          const result = call(args);
          fact.actual = result instanceof OffscreenCanvasRenderingContext2D && canReadAttributes(result) ? result.getContextAttributes() : null;
          return result;
        } catch (error) { fact.error = error instanceof Error ? error.message : String(error); throw error; }
      }
      if (!readStaging()) return call(args);
      if (contexts.length + unchangedContexts.length >= 16384) { overflow++; return call(args); }
      const fact: TileContextFact = { id: contexts.length + 1, atMs: performance.now(), width: context.width, height: context.height,
        settingsProvided: args[1] !== undefined, actual: null, copyCalls: 0, stagingCopies: 0, copyCompleted: 0, transfers: 0, transferCompleted: 0, ordered: true };
      targets.set(context, fact); contexts.push(fact);
      const forwarded = arm === 'B' ? [args[0], { ...settings, willReadFrequently: true }, ...args.slice(2)] : args;
      try {
        const result = call(forwarded);
        fact.actual = result instanceof OffscreenCanvasRenderingContext2D && canReadAttributes(result) ? result.getContextAttributes() : null;
        return result;
      } catch (error) { failed(fact, 'getContext', error); throw error; }
    });
    observe(OffscreenCanvasRenderingContext2D.prototype, 'drawImage', (call, context, args) => {
      if (!(context instanceof OffscreenCanvasRenderingContext2D)) return call(args);
      const source = args[0], current = readStaging(), fact = targets.get(context.canvas);
      if (!fact) { if (current && source === current) uncontrolledCopies++; return call(args); }
      fact.copyCalls++; fact.copyAtMs = performance.now();
      if (fact.transfers) fact.ordered = false;
      // context首次创建时尚无source；只有后续真实copy能证明候选归属，不能凭调用栈猜。
      if (current && source === current) { fact.stagingCopies++; fact.sourceWidth = current.width; fact.sourceHeight = current.height; }
      fact.drawArguments = args.slice(1).map(value => typeof value === 'number' ? value : null);
      try { const result = call(args); fact.copyCompleted++; return result; }
      catch (error) { failed(fact, 'drawImage', error); throw error; }
    });
    observe(OffscreenCanvas.prototype, 'transferToImageBitmap', (call, context, args) => {
      if (!(context instanceof OffscreenCanvas)) return call(args);
      const fact = targets.get(context); if (!fact) return call(args);
      fact.transfers++; fact.transferAtMs = performance.now();
      if (fact.copyCompleted !== 1) fact.ordered = false;
      try {
        const result = call(args); fact.transferCompleted++;
        if (result instanceof ImageBitmap) { fact.bitmapWidth = result.width; fact.bitmapHeight = result.height; }
        return result;
      } catch (error) { failed(fact, 'transferToImageBitmap', error); throw error; }
    });
  } catch (error) { dispose(); throw error; }
  return {
    finish() {
      // 外层body先卸载paint观察器，再到这里逆序卸载control，避免复活已结束的wrapper。
      dispose();
      return { diagnostic: 'tile-context-control', arm, clock: 'unmodified-performance.now', timeOrigin: performance.timeOrigin,
        installedAtMs, requestedWillReadFrequently: arm === 'B', stagingCanvases: staging ? 1 : 0,
        stagingChanged, uncontrolledCopies, overflow, descriptorsRestored: true, contexts, unchangedContexts,
        effective: !!staging && !stagingChanged && !uncontrolledCopies && !overflow && contexts.length > 0 && contexts.every(fact =>
          fact.actual?.willReadFrequently === (arm === 'B') && !fact.error && fact.ordered
          && fact.copyCalls === 1 && fact.stagingCopies === 1 && fact.copyCompleted === 1 && fact.transfers === 1 && fact.transferCompleted === 1) };
    },
  };
}
