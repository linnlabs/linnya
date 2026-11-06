// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearCanvasDisplayImageCache, resolveCanvasDisplayImages } from '../content';
const input = 'data:image/png;base64,YWJj';
beforeEach(() => { clearCanvasDisplayImageCache(); vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { clearCanvasDisplayImageCache(); vi.unstubAllGlobals(); });
function fixture(context = true) {
  const original = { width: 6000, height: 3000, close: vi.fn() }, resized = { width: 2048, height: 1024, close: vi.fn() };
  const create = vi.fn(async (_source: unknown, options?: ImageBitmapOptions) => options ? resized : original);
  vi.stubGlobal('createImageBitmap', create);
  vi.stubGlobal('OffscreenCanvas', class { constructor(readonly width: number, readonly height: number) {} getContext() { return context ? { drawImage: vi.fn() } : null; } async convertToBlob() { return new Blob(['display'], { type: 'image/png' }); } });
  vi.stubGlobal('FileReader', class { result: string | null = null; error: DOMException | null = null; onload: (() => void) | null = null; onerror: (() => void) | null = null; readAsDataURL() { this.result = 'data:image/png;base64,ZGlzcGxheQ=='; this.onload?.(); } });
  return { original, resized, create };
}
it('大图先在bitmap阶段等比缩小，同资产并发请求去重，源与派生bitmap均关闭', async () => {
  const f = fixture(), signal = new AbortController().signal;
  const decode = vi.spyOn(globalThis, 'atob');
  const [first, second] = await Promise.all([resolveCanvasDisplayImages({ asset: input }, signal), resolveCanvasDisplayImages({ asset: input }, signal)]);
  expect(first).toEqual(second); expect(first.asset).not.toBe(input);
  expect(f.create).toHaveBeenLastCalledWith(f.original, { resizeWidth: 2048, resizeHeight: 1024, resizeQuality: 'high' });
  expect(f.original.close).toHaveBeenCalledOnce(); expect(f.resized.close).toHaveBeenCalledOnce();
  await resolveCanvasDisplayImages({ asset: input }, signal); expect(f.create).toHaveBeenCalledTimes(2);
  expect(decode).toHaveBeenCalledOnce(); decode.mockRestore();
});
it('显示编码失败也释放所有bitmap，取消后不开始后续原图解码', async () => {
  const f = fixture(false); await expect(resolveCanvasDisplayImages({ asset: input }, new AbortController().signal)).rejects.toThrow('image_display_context_unavailable');
  expect(f.original.close).toHaveBeenCalledOnce(); expect(f.resized.close).toHaveBeenCalledOnce();
  const aborted = new AbortController(); aborted.abort(); await expect(resolveCanvasDisplayImages({ second: input }, aborted.signal)).rejects.toThrow(); expect(f.create).toHaveBeenCalledTimes(2);
});
