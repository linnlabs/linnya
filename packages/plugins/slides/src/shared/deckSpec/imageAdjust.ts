/**
 * 图片调色：作者输入合同与像素公式。PPTX 写成 blip 里的 `a:lum`、`a:grayscl`、`a:duotone`，
 * 预览按同一组公式在图片加载后算一次像素。公式用 PowerPoint 导出 PDF 里烘焙好的像素逐级校准
 * （2026-11-11，灰、红、绿、蓝四条 0–255 渐变，误差 ≤ 2 级）：
 *
 * - 亮度对比逐通道作用在 sRGB 数值上：`s·(x − 127.5) + 127.5 + 255·b·(1 + s)/2`，
 *   对比 c > 0 时 `s = 1/(1 − c)`，c ≤ 0 时 `s = 1 + c`。
 * - 去色取 Rec.709 权重 `0.2126R + 0.7152G + 0.0722B`（同样直接用 sRGB 数值）。
 * - 双色调先按上式取亮度，再在两色之间线性插值：亮度 0 是第一色，255 是第二色。
 * - 先亮度对比、后去色或双色调，与 PPTX 里 blip 子元素的顺序一致。
 */
import { normalizeOpaqueColor } from '../visual/colorPrimitives';
import { isRecord } from '../valueRecord';

export interface ImageAdjust {
  /** 去色成灰度。不能与 duotone 同写。 */
  grayscale?: boolean;
  /** 双色调：[暗部色, 亮部色]，#RRGGBB。 */
  duotone?: readonly [string, string];
  /** 亮度，-1–1，0 不变。 */
  brightness?: number;
  /** 对比度，-1 到小于 1，0 不变；-1 变成一片中灰。 */
  contrast?: number;
}

const IMAGE_ADJUST_KEYS = ['grayscale', 'duotone', 'brightness', 'contrast'] as const;

/** 解析作者写的调色；全部是默认值时返回 undefined，越界或写错直接报错。 */
export function readImageAdjustInput(
  value: unknown,
  path: string,
): { value: ImageAdjust | undefined } | { error: string } {
  if (!isRecord(value) || Object.keys(value).some((key) => !(IMAGE_ADJUST_KEYS as readonly string[]).includes(key))) {
    return { error: `${path} 写成 { grayscale?, duotone?: [暗部色, 亮部色], brightness?, contrast? }。` };
  }
  const adjust: { -readonly [K in keyof ImageAdjust]: ImageAdjust[K] } = {};
  if (value.grayscale != null) {
    if (typeof value.grayscale !== 'boolean') return { error: `${path}.grayscale 必须是 true 或 false。` };
    if (value.grayscale) adjust.grayscale = true;
  }
  if (value.duotone != null) {
    const pair = value.duotone;
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some((color) => typeof color !== 'string')) {
      return { error: `${path}.duotone 写成两个颜色 [暗部色, 亮部色]。` };
    }
    const colors: string[] = [];
    for (const [index, color] of pair.entries()) {
      const normalized = normalizeOpaqueColor(color as string, `${path}.duotone[${index}]`);
      if ('error' in normalized) return { error: normalized.error };
      colors.push(normalized.value);
    }
    adjust.duotone = [colors[0], colors[1]];
  }
  if (adjust.grayscale && adjust.duotone) {
    return { error: `${path}.grayscale 与 duotone 只写一个：双色调已经按灰度映射。` };
  }
  for (const key of ['brightness', 'contrast'] as const) {
    const raw = value[key];
    if (raw == null) continue;
    const upperOpen = key === 'contrast';
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < -1 || raw > 1 || (upperOpen && raw >= 1)) {
      return { error: `${path}.${key} 必须在 -1 到 ${upperOpen ? '小于 1' : '1'} 之间，0 不变；收到 ${String(raw)}。` };
    }
    if (raw !== 0) adjust[key] = raw;
  }
  return { value: Object.keys(adjust).length > 0 ? adjust : undefined };
}

export function isImageAdjust(value: unknown): value is ImageAdjust {
  const parsed = readImageAdjustInput(value, 'adjust');
  return 'value' in parsed && parsed.value != null;
}

/** 按 PowerPoint 的公式原地改写 RGBA 像素，透明度不变。 */
export function applyImageAdjustToPixels(data: Uint8ClampedArray, adjust: ImageAdjust): void {
  const contrast = adjust.contrast ?? 0;
  const slope = contrast > 0 ? 1 / (1 - contrast) : 1 + contrast;
  const offset = 127.5 - 127.5 * slope + 255 * (adjust.brightness ?? 0) * (1 + slope) / 2;
  const correct = adjust.brightness != null || adjust.contrast != null;
  const duotone = adjust.duotone?.map(hexToRgb);
  for (let index = 0; index < data.length; index += 4) {
    let r = data[index];
    let g = data[index + 1];
    let b = data[index + 2];
    if (correct) {
      r = clampByte(slope * r + offset);
      g = clampByte(slope * g + offset);
      b = clampByte(slope * b + offset);
    }
    if (adjust.grayscale || duotone) {
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (duotone) {
        const t = luminance / 255;
        const [dark, light] = duotone;
        r = dark[0] + (light[0] - dark[0]) * t;
        g = dark[1] + (light[1] - dark[1]) * t;
        b = dark[2] + (light[2] - dark[2]) * t;
      } else {
        r = luminance;
        g = luminance;
        b = luminance;
      }
    }
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
  }
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function hexToRgb(color: string): [number, number, number] {
  const hex = color.replace(/^#/, '');
  return [0, 2, 4].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
}
