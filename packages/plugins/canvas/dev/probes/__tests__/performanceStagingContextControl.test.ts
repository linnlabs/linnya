import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCanvasStagingContextControl } from '../performanceStagingContextControl';

class Context {
  constructor(readonly settings: CanvasRenderingContext2DSettings) {}
  getContextAttributes() { return this.settings; }
}
class Offscreen {
  lastArgs: readonly unknown[] = [];
  getContext(mode: string, ...args: unknown[]) { this.lastArgs = [mode, ...args]; return new Context({ willReadFrequently: false }); }
}
const calls: { readonly target: Canvas; readonly args: readonly unknown[] }[] = [];
class Canvas {
  readonly parentElement;
  context: Context | null = null;
  failure: Error | null = null;
  constructor(readonly role: 'staging' | 'pixi' | 'other') {
    this.parentElement = { classList: { contains: (name: string) => role !== 'other' && name === 'canvas-raster-staging' } };
  }
  getAttribute(name: string) { return this.role === 'staging' && name === 'content' ? 'drawable' : null; }
  hasAttribute() { return false; }
  getContext(mode: string, ...args: unknown[]): unknown {
    calls.push({ target: this, args: [mode, ...args] });
    if (this.failure) throw this.failure;
    if (mode !== '2d') return null;
    if (this.context) return this.context;
    const settings = typeof args[0] === 'object' && args[0] !== null ? args[0] : {};
    this.context = new Context({ alpha: Reflect.get(settings, 'alpha') !== false,
      colorSpace: Reflect.get(settings, 'colorSpace') === 'display-p3' ? 'display-p3' : 'srgb', desynchronized: false,
      willReadFrequently: Reflect.get(settings, 'willReadFrequently') === true });
    return this.context;
  }
}
let control: ReturnType<typeof createCanvasStagingContextControl> | null = null;
beforeEach(() => {
  calls.length = 0; vi.stubGlobal('HTMLCanvasElement', Canvas); vi.stubGlobal('CanvasRenderingContext2D', Context); vi.stubGlobal('OffscreenCanvas', Offscreen);
});
afterEach(() => { control?.finish(); control = null; vi.unstubAllGlobals(); });

it('A保留原this/参数和已建context，匹配一次且不改Pixi或其它画布', () => {
  control = createCanvasStagingContextControl('A');
  const target = new Canvas('staging'), settings = { alpha: false }, other = new Canvas('other'), pixi = new Canvas('pixi');
  const first = target.getContext('2d', settings);
  expect(calls[0].target).toBe(target); expect(calls[0].args[1]).toBe(settings);
  expect(target.getContext('2d', { willReadFrequently: true })).toBe(first);
  other.getContext('2d'); pixi.getContext('webgl2');
  expect(calls[2].args).toEqual(['2d']); expect(calls[3].args).toEqual(['webgl2']);
  const facts = control.finish();
  expect(facts).toMatchObject({ arm: 'A', stagingContexts: 1, effective: true });
  expect(facts.contexts[0].actual).toMatchObject({ alpha: false, willReadFrequently: false });
});

it('B仅首次staging2d增加hint，保alpha/色域并原样透传其它目标及后续调用', () => {
  control = createCanvasStagingContextControl('B');
  const target = new Canvas('staging'), other = new Canvas('other'), settings = { alpha: false, colorSpace: 'display-p3' };
  const first = target.getContext('2d', settings);
  expect(calls[0].args).toEqual(['2d', { ...settings, willReadFrequently: true }]);
  expect(settings).toEqual({ alpha: false, colorSpace: 'display-p3' });
  expect(target.getContext('2d')).toBe(first); expect(calls[1].args).toEqual(['2d']);
  other.getContext('2d'); expect(calls[2].args).toEqual(['2d']);
  const tile = new Offscreen(), tileSettings = { alpha: false };
  expect(tile.getContext('2d', tileSettings).getContextAttributes().willReadFrequently).toBe(false);
  expect(tile.lastArgs[1]).toBe(tileSettings);
  expect(control.finish()).toMatchObject({ arm: 'B', stagingContexts: 1, effective: true,
    contexts: [{ actual: { alpha: false, colorSpace: 'display-p3', willReadFrequently: true } }] });
});

it('已建context忽略新hint时明确无效，原生异常保持身份且finally恢复descriptor', () => {
  const original = Object.getOwnPropertyDescriptor(Canvas.prototype, 'getContext');
  const target = new Canvas('staging'); target.getContext('2d');
  control = createCanvasStagingContextControl('B'); target.getContext('2d');
  expect(control.finish()).toMatchObject({ effective: false, contexts: [{ actual: { willReadFrequently: false } }] });
  control = createCanvasStagingContextControl('B');
  const broken = new Canvas('staging'), failure = new Error('native_context_failed'); broken.failure = failure;
  let caught: unknown;
  try { broken.getContext('2d'); } catch (error) { caught = error; }
  finally { expect(control.finish()).toMatchObject({ effective: false, contexts: [{ actual: null, error: failure.message }] }); }
  expect(caught).toBe(failure);
  expect(Object.getOwnPropertyDescriptor(Canvas.prototype, 'getContext')).toEqual(original);
});
