// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createHtmlCardRasterizer } from '../functions/createHtmlCardRasterizer';
import type { HtmlElementImage } from '../definitions/htmlCanvasElementImage';

const methods = ['transferControlToOffscreen', 'captureElementImage', 'requestPaint'];
const originalMethods = new Map(methods.map(name => [name, Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, name)]));
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const [name, descriptor] of originalMethods) {
    if (descriptor) Object.defineProperty(HTMLCanvasElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLCanvasElement.prototype, name);
  }
});

class Bitmap implements ImageBitmap {
  readonly close = vi.fn();
  constructor(readonly width: number, readonly height: number) {}
}
class Snapshot implements HtmlElementImage {
  readonly close = vi.fn();
  readonly width = 100;
  readonly height = 60;
  constructor(readonly owner: HTMLCanvasElement) {}
}

function fixture() {
  const canvases: CopyCanvas[] = [], bitmaps: Bitmap[] = [], snapshots: Snapshot[] = [];
  let transferFailure: { readonly ordinal: number; readonly error: Error } | undefined;
  let sendPaint = true;
  const requested = Promise.withResolvers<HTMLCanvasElement>();
  class CopyCanvas {
    owner: HTMLCanvasElement | null = null;
    readonly context = {
      setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(),
      drawElementImage: vi.fn((snapshot: Snapshot) => {
        // 150原生身份规则：独立copy目标不能重放别的canvas的paint record。
        if (!this.owner || this.owner !== snapshot.owner) throw new DOMException('different canvas', 'InvalidStateError');
      }),
    };
    constructor(public width: number, public height: number) { canvases.push(this); }
    getContext() { return this.context; }
    transferToImageBitmap() {
      if (transferFailure?.ordinal === bitmaps.length + 1) throw transferFailure.error;
      const bitmap = new Bitmap(this.width, this.height); bitmaps.push(bitmap); return bitmap;
    }
  }
  vi.stubGlobal('OffscreenCanvas', CopyCanvas);
  const transfer = vi.fn(function (this: HTMLCanvasElement) {
    const target = new CopyCanvas(this.width, this.height); target.owner = this;
    // 转移后的HTML bitmap setter真实会抛错，不能让测试替实现吞掉旧setter。
    for (const dimension of ['width', 'height']) Object.defineProperty(this, dimension, {
      configurable: true, get: () => 300,
      set: () => { throw new DOMException('transferred canvas', 'InvalidStateError'); },
    });
    return target;
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', { configurable: true, value: transfer });
  Object.defineProperty(HTMLCanvasElement.prototype, 'captureElementImage', { configurable: true, value: function (this: HTMLCanvasElement) {
    const snapshot = new Snapshot(this); snapshots.push(snapshot); return snapshot;
  } });
  Object.defineProperty(HTMLCanvasElement.prototype, 'requestPaint', { configurable: true, value: function (this: HTMLCanvasElement) {
    requested.resolve(this); if (sendPaint) this.dispatchEvent(new Event('paint'));
  } });
  const htmlContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  const document = window.document.implementation.createHTMLDocument(), host = document.createElement('div'); document.body.append(host);
  Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 60));
  const rasterizer = createHtmlCardRasterizer({ host, maxTextureEdge: 128 });
  const element = document.createElement('div'); element.textContent = '同一正文宽度';
  return { host, element, rasterizer, canvases, bitmaps, snapshots, transfer, htmlContext, requested,
    waitForPaint() { sendPaint = false; }, failTransfer(ordinal: number, error: Error) { transferFailure = { ordinal, error }; } };
}

it('测高及空批不创建出图目标，首个真实批才转移一次；后批改变backing仍保持原DOM比例与独立tile', async () => {
  const f = fixture();
  expect(await f.rasterizer.measure(f.element, 100)).toBe(60);
  expect(await f.rasterizer.rasterizeBatch([])).toEqual([]);
  expect(f.transfer).not.toHaveBeenCalled(); expect(f.canvases).toHaveLength(0); expect(f.htmlContext).not.toHaveBeenCalled();
  const result = await f.rasterizer.rasterizeBatch([
    { element: f.element, width: 100, height: 50, scale: 0.75, tileWidth: 40, offsetX: 10, offsetY: 5 },
    { element: f.element, width: 80, height: 30, scale: 1.25 },
  ]);
  const atlas = f.canvases[0], html = f.host.querySelector('canvas');
  expect(f.transfer).toHaveBeenCalledOnce(); expect(f.htmlContext).not.toHaveBeenCalled();
  expect([atlas.width, atlas.height]).toEqual([100, 76]);
  expect([html?.style.width, html?.style.height]).toEqual(['80px', '60.8px']);
  expect(f.host.querySelector<HTMLElement>('canvas > div > div > div')?.style.width).toBe('100px');
  expect(atlas.context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
  expect(atlas.context.drawElementImage).toHaveBeenCalledWith(f.snapshots[0], 0, 0);
  expect(f.canvases[1].context.drawImage).toHaveBeenCalledWith(atlas, 0, 0, 30, 38, 0, 0, 30, 38);
  expect(f.canvases[2].context.drawImage).toHaveBeenCalledWith(atlas, 0, 38, 100, 38, 0, 0, 100, 38);
  expect(result.map(tile => [tile.width, tile.height, tile.bitmap.width, tile.bitmap.height])).toEqual([[40, 50, 30, 38], [80, 30, 100, 38]]);
  expect(f.snapshots[0].close).toHaveBeenCalledOnce(); expect(f.bitmaps.every(bitmap => bitmap.close.mock.calls.length === 0)).toBe(true);
  const later = await f.rasterizer.rasterize({ element: f.element, width: 25, height: 20, scale: 2 });
  expect(f.transfer).toHaveBeenCalledOnce(); expect([atlas.width, atlas.height]).toEqual([50, 40]);
  expect([html?.style.width, html?.style.height]).toEqual(['25px', '20px']); expect(f.snapshots[1].close).toHaveBeenCalledOnce();
  f.rasterizer.dispose(); expect([atlas.width, atlas.height]).toEqual([0, 0]); expect(f.host.childElementCount).toBe(0);
  // 消费者仍拥有已交付位图；销毁staging不能把它们一起关闭。
  for (const tile of [...result, later]) tile.bitmap.close(); expect(f.bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1)).toBe(true);
});

it('后页原生transfer失败时保留原异常，关闭各页snapshot和先前独立位图，目标仍由rasterizer统一销毁', async () => {
  const f = fixture(), error = new Error('native_transfer_failed'); f.failTransfer(2, error);
  await expect(f.rasterizer.rasterizeBatch([1, 2].map(() => ({ element: f.element, width: 80, height: 80, scale: 1 })))).rejects.toBe(error);
  expect(f.snapshots).toHaveLength(2); expect(f.snapshots.every(snapshot => snapshot.close.mock.calls.length === 1)).toBe(true);
  expect(f.bitmaps).toHaveLength(1); expect(f.bitmaps[0].close).toHaveBeenCalledOnce();
  f.rasterizer.dispose(); expect([f.canvases[0].width, f.canvases[0].height]).toEqual([0, 0]);
});

it.each(['abort', 'dispose'])('等待paint期间%s立即收口，迟到paint不能创建snapshot或新位图', async action => {
  const f = fixture(); f.waitForPaint(); const controller = new AbortController(), reason = new Error('cancelled');
  const pending = f.rasterizer.rasterize({ element: f.element, width: 40, height: 20, scale: 1 }, controller.signal);
  const canvas = await f.requested.promise;
  if (action === 'abort') controller.abort(reason); else f.rasterizer.dispose();
  if (action === 'abort') await expect(pending).rejects.toBe(reason); else await expect(pending).rejects.toThrow('rasterizer_disposed');
  canvas.dispatchEvent(new Event('paint')); expect(f.snapshots).toHaveLength(0); expect(f.bitmaps).toHaveLength(0);
  f.rasterizer.dispose(); expect([f.canvases[0].width, f.canvases[0].height]).toEqual([0, 0]); expect(f.host.childElementCount).toBe(0);
});
