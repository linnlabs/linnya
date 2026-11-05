// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasVisualSamplingSchema, readCanvasVisualSampling, assertVisualImageSampling, assertSoftwareVisualSampling, visualPixelOffset, visualCssPixelOffset, visualCssPixelRegion } from '../visualSampling';

const software = () => CanvasVisualSamplingSchema.parse({ mode: 'interactive', windowDpr: 2, resolution: 1, css: { width: 900, height: 600 },
  canvas: { width: 900, height: 600 }, status: { limited: true, phase: 'ready', message: 'software rendering' } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('窗口2x但软件Kernel实际1x，读取真实采样并只接受900×600，不把2x PNG冒成同质量', () => {
  vi.stubGlobal('devicePixelRatio', 2);
  const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 600;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 600));
  const sampling = readCanvasVisualSampling({ canvas, readResolution: () => 1, readRenderStatus: () => ({ limited: true, phase: 'ready', message: 'software rendering' }) }, 'interactive');
  expect(sampling.windowDpr).toBe(2); expect(sampling.resolution).toBe(1);
  expect(() => assertSoftwareVisualSampling(sampling)).not.toThrow();
  expect(() => assertVisualImageSampling({ width: 900, height: 600, pixels: new Uint8Array(900 * 600 * 4) }, sampling)).not.toThrow();
  expect(() => assertVisualImageSampling({ width: 1800, height: 1200 }, sampling)).toThrow('visual_image_sampling_mismatch');
});

it('PNG和底图声明各自严格核对；错误canvas尺寸或缺失字节不能继续采像素', () => {
  const sampling = software();
  expect(() => assertVisualImageSampling({ width: 900, height: 600 }, { ...sampling, canvas: { width: 1800, height: 1200 } })).toThrow('visual_canvas_sampling_mismatch');
  expect(() => assertVisualImageSampling({ width: 900, height: 600, pixels: new Uint8Array(1) }, sampling)).toThrow('visual_image_bytes_mismatch');
});

it('真实分数CSS与resolution相乘保留完整物理像素，不以整数CSS近似裁少一列', () => {
  const sampling = { ...software(), resolution: 2, css: { width: 900.5, height: 600.5 }, canvas: { width: 1801, height: 1201 } };
  expect(() => assertVisualImageSampling({ width: 1801, height: 1201 }, sampling)).not.toThrow();
  expect(() => assertVisualImageSampling({ width: 1800, height: 1200 }, sampling)).toThrow('visual_image_sampling_mismatch');
});

it('像素索引允许首末像素，拒绝非整/负数/边界之外和不完整RGBA，不能读到undefined或NaN', () => {
  const frame = { width: 2, height: 2, pixels: new Uint8Array(16) };
  expect(visualPixelOffset(frame, { x: 0, y: 0 })).toBe(0); expect(visualPixelOffset(frame, { x: 1, y: 1 })).toBe(12);
  for (const point of [{ x: 0.5, y: 0 }, { x: -1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: NaN, y: 0 }]) {
    expect(() => visualPixelOffset(frame, point)).toThrow('visual_pixel_out_of_bounds');
  }
  expect(() => visualPixelOffset({ ...frame, pixels: new Uint8Array(15) }, { x: 0, y: 0 })).toThrow('visual_image_bytes_mismatch');
});

it('capture即使1x/limited也不能冒软件interactive，实际2x或未降级状态同样拒绝', () => {
  const sampling = software();
  expect(() => assertSoftwareVisualSampling({ ...sampling, mode: 'capture' })).toThrow('visual_software_interactive_sampling_mismatch');
  expect(() => assertSoftwareVisualSampling({ ...sampling, resolution: 2 })).toThrow('visual_software_interactive_sampling_mismatch');
  expect(() => assertSoftwareVisualSampling({ ...sampling, status: { ...sampling.status, limited: false } })).toThrow('visual_software_interactive_sampling_mismatch');
});

it('同一CSS半像素图形点在1x取包含单元，2x仍保原位置，不能舍入到邻近背景', () => {
  const one = { width: 3, height: 1, pixels: new Uint8Array([165, 123, 171, 255, 242, 243, 238, 255, 242, 243, 238, 255]) };
  const two = { width: 6, height: 2, pixels: new Uint8Array(6 * 2 * 4) }; two.pixels.set([165, 123, 171, 255], 4);
  const point = { x: 0.5, y: 0 };
  const first = visualCssPixelOffset(one, point, 1), second = visualCssPixelOffset(two, point, 2);
  expect(Array.from(one.pixels.slice(first, first + 4))).toEqual([165, 123, 171, 255]);
  expect(Array.from(two.pixels.slice(second, second + 4))).toEqual([165, 123, 171, 255]);
  expect(() => visualCssPixelOffset(one, { x: 3, y: 0 }, 1)).toThrow('visual_pixel_out_of_bounds');
});

it('标题分数盒覆盖两侧完整像素，1x和2x分别按真实采样拒绝任何越界', () => {
  const one = { width: 5, height: 3, pixels: new Uint8Array(5 * 3 * 4) };
  const two = { width: 10, height: 6, pixels: new Uint8Array(10 * 6 * 4) };
  const region = { x: 0.5, y: 0.25, width: 4.5, height: 2.75 };
  expect(visualCssPixelRegion(one, region, 1)).toEqual({ x: 0, y: 0, width: 5, height: 3 });
  expect(visualCssPixelRegion(two, region, 2)).toEqual({ x: 1, y: 0, width: 9, height: 6 });
  for (const resolution of [1, 2]) {
    const frame = resolution === 1 ? one : two;
    expect(() => visualCssPixelRegion(frame, { ...region, width: 4.51 }, resolution)).toThrow('visual_pixel_out_of_bounds');
    expect(() => visualCssPixelRegion(frame, { ...region, width: 0 }, resolution)).toThrow('visual_region_dimensions_invalid');
  }
});
