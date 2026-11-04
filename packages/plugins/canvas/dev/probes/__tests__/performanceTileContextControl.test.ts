import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCanvasTileContextControl } from '../performanceTileContextControl';
import { readCanvasPerformanceContextControl } from '../performanceContextControl';

class Canvas {
  width = 100; height = 80;
  private readonly attributes = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  getContext() { return null; }
}
class Host {
  readonly children: unknown[] = [];
  append(...nodes: unknown[]) { this.children.push(...nodes); }
  get firstElementChild() { return this.children[0] ?? null; }
  get childElementCount() { return this.children.length; }
}
class Bitmap { constructor(readonly width: number, readonly height: number) {} }
class Context {
  readonly calls: unknown[][] = [];
  constructor(readonly canvas: Tile, readonly settings: CanvasRenderingContext2DSettings) {}
  getContextAttributes() { return this.settings; }
  drawImage(...args: unknown[]) {
    this.canvas.check('drawImage');
    this.calls.push(args);
  }
}
class Tile {
  readonly calls: unknown[][] = [];
  context: Context | null = null;
  failure: { readonly stage: string; readonly error: Error } | null = null;
  constructor(readonly width: number, readonly height: number) {}
  check(stage: string) { if (this.failure?.stage === stage) throw this.failure.error; }
  getContext(mode: string, ...args: unknown[]) {
    this.check('getContext'); this.calls.push([mode, ...args]);
    if (mode !== '2d') return null;
    const settings = typeof args[0] === 'object' && args[0] !== null ? args[0] : {};
    this.context ??= new Context(this, { alpha: Reflect.get(settings, 'alpha') !== false,
      colorSpace: Reflect.get(settings, 'colorSpace') === 'display-p3' ? 'display-p3' : 'srgb',
      willReadFrequently: Reflect.get(settings, 'willReadFrequently') === true });
    return this.context;
  }
  transferToImageBitmap() { this.check('transferToImageBitmap'); return new Bitmap(this.width, this.height); }
}
let control: ReturnType<typeof createCanvasTileContextControl> | null = null;
function fixture() {
  const host = document.createElement('div'), staging = document.createElement('canvas');
  staging.setAttribute('content', 'drawable'); host.append(staging); return { host, staging };
}
beforeEach(() => {
  vi.stubGlobal('HTMLCanvasElement', Canvas); vi.stubGlobal('OffscreenCanvas', Tile);
  vi.stubGlobal('OffscreenCanvasRenderingContext2D', Context); vi.stubGlobal('ImageBitmap', Bitmap);
  vi.stubGlobal('document', { createElement: (tag: string) => tag === 'canvas' ? new Canvas() : new Host() });
});
afterEach(() => { control?.finish(); control = null; vi.unstubAllGlobals(); });

it('同一typed合同拒绝混合变量；A保原调用，B只改候选首次hint且以实际source/copy/transfer自证', () => {
  expect(readCanvasPerformanceContextControl({ staging: undefined, tile: undefined, bodyTrace: false })).toBeNull();
  expect(() => readCanvasPerformanceContextControl({ staging: 'A', tile: 'B', bodyTrace: true })).toThrow('conflicting');
  expect(() => readCanvasPerformanceContextControl({ staging: undefined, tile: 'B', bodyTrace: false })).toThrow('requires_body');
  const htmlMethod = Canvas.prototype.getContext;
  for (const arm of ['A', 'B'] as const) {
    const { host, staging } = fixture(); control = createCanvasTileContextControl(host, arm);
    const target = new Tile(20, 30), settings = { alpha: false, colorSpace: 'display-p3' };
    const context = target.getContext('2d', settings); if (!context) throw new Error('test_context_missing');
    expect(target.calls[0]).toEqual(['2d', arm === 'A' ? settings : { ...settings, willReadFrequently: true }]);
    if (arm === 'A') expect(target.calls[0][1]).toBe(settings);
    expect(settings).toEqual({ alpha: false, colorSpace: 'display-p3' });
    expect(target.getContext('2d')).toBe(context); expect(target.calls[1]).toEqual(['2d']);
    context.drawImage(staging, 1, 2, 20, 30, 0, 0, 20, 30);
    const bitmap = target.transferToImageBitmap(); expect(bitmap).toEqual(new Bitmap(20, 30));
    expect(context.calls[0][0]).toBe(staging);
    expect(new Tile(1, 1).getContext('webgl2')).toBeNull();
    expect(control.finish()).toMatchObject({ effective: true, uncontrolledCopies: 0, descriptorsRestored: true,
      contexts: [{ actual: { alpha: false, colorSpace: 'display-p3', willReadFrequently: arm === 'B' }, copyCompleted: 1, transferCompleted: 1 }] });
    expect(Canvas.prototype.getContext).toBe(htmlMethod);
  }
});

it('其它来源、未完成链、旧context忽略hint和未受控copy都明确无效，不冒充tile实验', () => {
  for (const mismatch of ['other-source', 'unfinished', 'old-context', 'missing-attributes']) {
    const { host, staging } = fixture(), target = new Tile(20, 30);
    if (mismatch === 'old-context') target.getContext('2d');
    if (mismatch === 'missing-attributes') {
      const existing = target.getContext('2d', { willReadFrequently: true });
      if (!existing) throw new Error('test_context_missing');
      Object.defineProperty(existing, 'getContextAttributes', { value: undefined });
    }
    control = createCanvasTileContextControl(host, 'B');
    const context = target.getContext('2d'); if (!context) throw new Error('test_context_missing');
    context.drawImage(mismatch === 'other-source' ? document.createElement('canvas') : staging, 0, 0);
    if (mismatch !== 'unfinished') target.transferToImageBitmap();
    const facts = control.finish(); expect(facts.effective).toBe(false);
    if (mismatch === 'missing-attributes') expect(facts.contexts[0].actual).toBeNull();
  }
  const host = document.createElement('div'), staging = document.createElement('canvas'); staging.setAttribute('content', 'drawable');
  control = createCanvasTileContextControl(host, 'B');
  const target = new Tile(20, 30), context = target.getContext('2d'); if (!context) throw new Error('test_context_missing');
  host.append(staging); context.drawImage(staging, 0, 0); target.transferToImageBitmap();
  expect(control.finish()).toMatchObject({ effective: false, uncontrolledCopies: 1, contexts: [] });
});

it('原生异常保身份，paint先卸载后control逆序还原；安装中断也不残留自有wrapper', () => {
  const originals = [Object.getOwnPropertyDescriptor(Tile.prototype, 'getContext'),
    Object.getOwnPropertyDescriptor(Context.prototype, 'drawImage'), Object.getOwnPropertyDescriptor(Tile.prototype, 'transferToImageBitmap')];
  for (const stage of ['getContext', 'drawImage', 'transferToImageBitmap']) {
    const { host, staging } = fixture(); control = createCanvasTileContextControl(host, 'B');
    const target = new Tile(20, 30), error = new Error(`native_${stage}`); target.failure = { stage, error };
    let caught: unknown;
    try { const context = target.getContext('2d'); context?.drawImage(staging, 0, 0); target.transferToImageBitmap(); }
    catch (failure) { caught = failure; }
    expect(caught).toBe(error);
    // 模拟已有paint observer的外层descriptor，必须先卸载它再收control。
    const paintDescriptor = Object.getOwnPropertyDescriptor(Context.prototype, 'drawImage');
    if (!paintDescriptor) throw new Error('test_descriptor_missing');
    Object.defineProperty(Context.prototype, 'drawImage', { ...paintDescriptor, value() {} });
    Object.defineProperty(Context.prototype, 'drawImage', paintDescriptor);
    const restored = vi.spyOn(Object, 'defineProperty');
    const facts = control.finish(), order = restored.mock.calls.map(call => call[1]); restored.mockRestore();
    expect(facts).toMatchObject({ effective: false, descriptorsRestored: true, contexts: [{ error: { stage, message: error.message } }] });
    expect(order).toEqual(['transferToImageBitmap', 'drawImage', 'getContext']);
  }
  const transfer = originals[2]; if (!transfer) throw new Error('test_descriptor_missing');
  Reflect.deleteProperty(Tile.prototype, 'transferToImageBitmap');
  try { expect(() => createCanvasTileContextControl(fixture().host, 'B')).toThrow('native_method_missing'); }
  finally { Object.defineProperty(Tile.prototype, 'transferToImageBitmap', transfer); }
  expect(Object.getOwnPropertyDescriptor(Tile.prototype, 'getContext')).toEqual(originals[0]);
  expect(Object.getOwnPropertyDescriptor(Context.prototype, 'drawImage')).toEqual(originals[1]);
});
