import { expect, it } from 'vitest';
import { captureCanvasVisualPage, withNativeVisualViewport } from '../captureCanvasVisualPage';

type CapturePort = Parameters<typeof captureCanvasVisualPage>[0];
const rectangles = [
  { x: 1, y: 1, width: 2, height: 6 },
  { x: 4, y: 1, width: 2, height: 6 },
  { x: 8, y: 1, width: 2, height: 6 },
] as const;

function fillPixel(pixels: Buffer, offset: number, x: number, y: number) {
  pixels.set([x + 1, y + 1, 7, 255], offset);
}

function clippedPage(dpr: number, content = { width: 4, height: 3 }, window = { width: 6, height: 5 }) {
  const viewport = { scrollX: 2, scrollY: 1, ...content, windowWidth: window.width, windowHeight: window.height, dpr };
  const requested: { x: number; y: number }[] = [];
  const port: CapturePort = {
    async readViewport() { return { ...viewport }; },
    async scrollTo(x, y) {
      requested.push({ x, y });
      viewport.scrollX = Math.min(10 - viewport.width, Math.max(0, x)); viewport.scrollY = Math.min(7 - viewport.height, Math.max(0, y));
      return { ...viewport };
    },
    async capture() {
      const width = Math.round(viewport.windowWidth * dpr), height = Math.round(viewport.windowHeight * dpr);
      // 视口外沿用不同哨兵色，保证拼接没有把滚动条/不可见区当正文补齐。
      const pixels = Buffer.alloc(width * height * 4, 253);
      for (let y = 0; y < Math.round(viewport.height * dpr); y++) for (let x = 0; x < Math.round(viewport.width * dpr); x++) {
        fillPixel(pixels, (y * width + x) * 4, Math.round(viewport.scrollX * dpr) + x, Math.round(viewport.scrollY * dpr) + y);
      }
      return { width, height, pixels };
    },
  };
  return { port, viewport, requested };
}

it.each([1, 1.25, 2, 4])('真实滚动片段完整覆盖三幅正文，DPR%s末块双轴clamp不留空洞', async dpr => {
  const page = clippedPage(dpr);
  const result = await captureCanvasVisualPage(page.port, { rectangles, dpr });
  const expected = Buffer.alloc(result.width * result.height * 4);
  for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++) fillPixel(expected, (y * result.width + x) * 4, x, y);
  expect(result.pixels).toEqual(expected);
  expect(result.expectedSize).toEqual({ width: Math.round(10 * dpr), height: Math.round(7 * dpr) });
  expect(result.tiles).toHaveLength(9);
  expect(page.requested.slice(-2)).toEqual([{ x: 8, y: 6 }, { x: 2, y: 1 }]);
  expect(result.tiles[result.tiles.length - 1]?.viewport).toMatchObject({ scrollX: 6, scrollY: 4 });
  expect(page.viewport).toMatchObject({ scrollX: 2, scrollY: 1 });
});

it('保留原生滚动条的半CSS像素视口，双轴末块复制实际最后一行/列而不补空白', async () => {
  const page = clippedPage(2, { width: 4.5, height: 3.5 });
  const rounded = (viewport: Awaited<ReturnType<CapturePort['readViewport']>>) => ({ ...viewport, width: Math.floor(viewport.width), height: Math.floor(viewport.height) });
  // 真实Windows的clientWidth=504，而scrollMax=675.5，实际内容宽为504.5；整数API丢了一列。
  await expect(captureCanvasVisualPage({ ...page.port,
    async readViewport() { return rounded(await page.port.readViewport()); },
    async scrollTo(x, y) { return rounded(await page.port.scrollTo(x, y)); },
  }, { rectangles, dpr: 2 })).rejects.toThrow('visual_capture_tile_mismatch');
  const result = await captureCanvasVisualPage(page.port, { rectangles, dpr: 2 });
  const expected = Buffer.alloc(result.width * result.height * 4);
  for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++) fillPixel(expected, (y * result.width + x) * 4, x, y);
  expect(result.pixels).toEqual(expected);
  expect(result.tiles[result.tiles.length - 1]).toMatchObject({ viewport: { scrollX: 5.5, scrollY: 3.5 }, destination: { x: 18, y: 7, width: 2, height: 7 } });
  expect(page.viewport).toMatchObject({ scrollX: 2, scrollY: 1 });
});

it('native client DIP与实际zoom保留完整窗口的半CSS像素，逐块复制仍严格完整', async () => {
  const page = clippedPage(2, { width: 4.5, height: 3.5 }, { width: 6.5, height: 5.5 });
  const domIntegers = (viewport: Awaited<ReturnType<CapturePort['readViewport']>>) => ({ ...viewport,
    windowWidth: Math.floor(viewport.windowWidth), windowHeight: Math.floor(viewport.windowHeight) });
  const wrongPort: CapturePort = { ...page.port,
    async readViewport() { return domIntegers(await page.port.readViewport()); },
    async scrollTo(x, y) { return domIntegers(await page.port.scrollTo(x, y)); },
  };
  await expect(captureCanvasVisualPage(wrongPort, { rectangles, dpr: 2 })).rejects.toThrow('visual_capture_tile_mismatch');
  const native = { contentBounds: { x: 0, y: 0, width: 13, height: 11 }, zoomFactor: 2 };
  const result = await captureCanvasVisualPage({ ...wrongPort,
    async readViewport() { return withNativeVisualViewport(await wrongPort.readViewport(), native); },
    async scrollTo(x, y) { return withNativeVisualViewport(await wrongPort.scrollTo(x, y), native); },
  }, { rectangles, dpr: 2 });
  const expected = Buffer.alloc(result.width * result.height * 4);
  for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++) fillPixel(expected, (y * result.width + x) * 4, x, y);
  expect(result.pixels).toEqual(expected);
  expect(result.tiles[0]).toMatchObject({ capturedSize: { width: 13, height: 11 }, viewport: { windowWidth: 6.5, windowHeight: 5.5 } });
  expect(page.viewport).toMatchObject({ scrollX: 2, scrollY: 1 });
});

it.each(['narrower', 'wider', 'bytes'] as const)('真实截屏%s不符立即失败并恢复原滚动，不接受更大图或填空白', async mismatch => {
  const page = clippedPage(2);
  let captures = 0;
  const port: CapturePort = { ...page.port, async capture() {
    captures++;
    const image = await page.port.capture();
    if (mismatch === 'bytes') return { ...image, pixels: image.pixels.subarray(4) };
    const width = image.width + (mismatch === 'wider' ? 1 : -1);
    return { ...image, width, pixels: Buffer.alloc(width * image.height * 4) };
  } };
  await expect(captureCanvasVisualPage(port, { rectangles, dpr: 2 })).rejects.toThrow('visual_capture_tile_mismatch');
  expect(captures).toBe(1); expect(page.viewport).toMatchObject({ scrollX: 2, scrollY: 1 });
});

it('滚动后的截屏失败传播原错，finally仍恢复原滚动', async () => {
  const page = clippedPage(2), failure = new Error('capture_failed');
  let captures = 0;
  const port: CapturePort = { ...page.port, async capture() { if (++captures === 2) throw failure; return page.port.capture(); } };
  await expect(captureCanvasVisualPage(port, { rectangles, dpr: 2 })).rejects.toBe(failure);
  expect(page.requested).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 1 }]);
  expect(page.viewport).toMatchObject({ scrollX: 2, scrollY: 1 });
});
