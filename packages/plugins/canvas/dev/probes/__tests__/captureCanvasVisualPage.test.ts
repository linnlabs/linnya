import { expect, it } from 'vitest';
import { captureCanvasVisualPage } from '../captureCanvasVisualPage';

type CapturePort = Parameters<typeof captureCanvasVisualPage>[0];
const rectangles = [
  { x: 1, y: 1, width: 2, height: 6 },
  { x: 4, y: 1, width: 2, height: 6 },
  { x: 8, y: 1, width: 2, height: 6 },
] as const;

function fillPixel(pixels: Buffer, offset: number, x: number, y: number) {
  pixels.set([x + 1, y + 1, 7, 255], offset);
}

function clippedPage(dpr: number) {
  const viewport = { scrollX: 2, scrollY: 1, width: 4, height: 3, windowWidth: 6, windowHeight: 5, dpr };
  const requested: { x: number; y: number }[] = [];
  const port: CapturePort = {
    async readViewport() { return { ...viewport }; },
    async scrollTo(x, y) {
      requested.push({ x, y });
      viewport.scrollX = Math.min(6, Math.max(0, x)); viewport.scrollY = Math.min(4, Math.max(0, y));
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

it.each(['width', 'bytes'] as const)('真实截屏%s不符立即失败并恢复原滚动，不填空白或重试', async mismatch => {
  const page = clippedPage(2);
  let captures = 0;
  const port: CapturePort = { ...page.port, async capture() {
    captures++;
    const image = await page.port.capture();
    return mismatch === 'width' ? { ...image, width: image.width - 1 } : { ...image, pixels: image.pixels.subarray(4) };
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
