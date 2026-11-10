// @vitest-environment jsdom
import { setImmediate as nextTask } from 'node:timers/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createHtmlCardRasterizer } from '../functions/createHtmlCardRasterizer';
import { prepareRasterDom } from '../functions/htmlCanvasPaint';

const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
afterEach(() => {
  vi.restoreAllMocks();
  if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
  else Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
});

function fixture(fontReady: (host: HTMLElement) => Promise<void>) {
  const document = window.document.implementation.createHTMLDocument();
  const host = document.createElement('div'); document.body.append(host);
  Object.defineProperty(document, 'fonts', { value: { get ready() { return fontReady(host); } } });
  return { document, host, rasterizer: createHtmlCardRasterizer({ host }) };
}
function content(document: Document, image?: string) {
  const element = document.createElement('div'); element.textContent = '中文正文';
  if (image) {
    const img = document.createElement('img'); img.dataset.resource = image;
    img.src = image === 'external' ? 'https://example.invalid/image.png' : 'data:image/png;base64,AA==';
    element.append(img);
  }
  return element;
}

it('整批DOM安装后只等本次字体门，坏图或非法地址不牵连其他卡，后批重新等待字体', async () => {
  const firstFonts = Promise.withResolvers<void>(), secondFonts = Promise.withResolvers<void>();
  let currentFonts = firstFonts.promise;
  const installed: number[] = [];
  const fontReady = vi.fn((host: HTMLElement) => { installed.push(host.querySelector('canvas > div')?.childElementCount ?? 0); return currentFonts; });
  const f = fixture(fontReady), good = Promise.withResolvers<void>(), bad = Promise.withResolvers<void>(), decoding = Promise.withResolvers<void>();
  let started = 0;
  const decode = vi.fn(function (this: HTMLImageElement) {
    if (++started === 2) decoding.resolve();
    return this.dataset.resource === 'good' ? good.promise : bad.promise;
  });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: decode });
  const measured: number[] = [];
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = Number.parseFloat(this.style.width); measured.push(width); return new DOMRect(0, 0, width, width + 20);
  });
  const pending = f.rasterizer.measureBatch(['good', 'bad', 'external', undefined].map((image, index) => ({ element: content(f.document, image), width: 120 + index * 20 })));
  expect(installed).toEqual([4]); expect(decode).not.toHaveBeenCalled(); expect(measured).toEqual([]);
  firstFonts.resolve(); await decoding.promise;
  const error = new Error('image_decode_failed'); good.resolve(); bad.reject(error);
  expect(await pending).toEqual([
    { status: 'fulfilled', value: 140 }, { status: 'rejected', reason: error },
    { status: 'rejected', reason: expect.objectContaining({ message: 'raster_image_requires_managed_bytes' }) },
    { status: 'fulfilled', value: 200 },
  ]);
  expect(decode).toHaveBeenCalledTimes(2); expect(measured.sort((a, b) => a - b)).toEqual([120, 180]);

  currentFonts = secondFonts.promise;
  const later = f.rasterizer.measureBatch([{ element: content(f.document), width: 210 }]);
  expect(installed).toEqual([4, 1]); await nextTask(); expect(measured).toHaveLength(2);
  secondFonts.resolve(); expect(await later).toEqual([{ status: 'fulfilled', value: 230 }]);
  expect(await f.rasterizer.measureBatch([])).toEqual([]); expect(fontReady).toHaveBeenCalledTimes(2);
  const cancelled = new AbortController(), reason = new Error('empty_batch_cancelled'); cancelled.abort(reason);
  await expect(f.rasterizer.measureBatch([], cancelled.signal)).rejects.toBe(reason);
  expect(fontReady).toHaveBeenCalledTimes(2); f.rasterizer.dispose();
});

it.each(['cancel', 'dispose'])('%s发生在图片解码期间，等不可取消的decode结算后整批拒绝，不再测高', async action => {
  const f = fixture(() => Promise.resolve()), image = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: () => { started.resolve(); return image.promise; } });
  const height = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
  const controller = new AbortController(), reason = new Error('measurement_cancelled');
  const pending = f.rasterizer.measureBatch([{ element: content(f.document, 'good'), width: 120 }], controller.signal);
  let settled = false; void pending.then(() => { settled = true; }, () => { settled = true; });
  await started.promise;
  if (action === 'cancel') controller.abort(reason); else f.rasterizer.dispose();
  // 到下一task才检查，确保已经清空微任务，不用猜测几个Promise tick。
  await nextTask(); expect(settled).toBe(false); expect(height).not.toHaveBeenCalled();
  image.resolve();
  if (action === 'cancel') await expect(pending).rejects.toBe(reason);
  else await expect(pending).rejects.toThrow('rasterizer_disposed');
  expect(height).not.toHaveBeenCalled(); f.rasterizer.dispose(); expect(f.host.childElementCount).toBe(0);
});

it('光栅页准备仍先等字体再等所有图片，最后一张图片完成前不能进入paint', async () => {
  const fonts = Promise.withResolvers<void>(), one = Promise.withResolvers<void>(), two = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  const fontReady = vi.fn(() => fonts.promise), f = fixture(fontReady);
  const page = f.document.createElement('div'); page.append(content(f.document, 'good'), content(f.document, 'bad')); f.host.append(page);
  let count = 0, prepared = false;
  const decode = vi.fn(function (this: HTMLImageElement) { if (++count === 2) started.resolve(); return this.dataset.resource === 'good' ? one.promise : two.promise; });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: decode });
  const preparation = prepareRasterDom(page).then(() => { prepared = true; });
  expect(fontReady).toHaveBeenCalledOnce(); expect(decode).not.toHaveBeenCalled();
  fonts.resolve(); await started.promise; one.resolve(); await nextTask(); expect(prepared).toBe(false);
  two.resolve(); await preparation; expect(prepared).toBe(true); expect(decode).toHaveBeenCalledTimes(2); f.rasterizer.dispose();
});
