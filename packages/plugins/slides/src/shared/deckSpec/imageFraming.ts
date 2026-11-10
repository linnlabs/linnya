/**
 * 图片取景（crop / focus）的作者输入合同。deck.js 编译、人工编辑与复制粘贴共用这一份校验，
 * 几何语义见 `render-geometry/imageGeometry.ts`。
 */
import { IMAGE_CROP_MIN_VISIBLE } from '../render-geometry/imageGeometry';
import { isRecord } from '../valueRecord';
import type { ImageCropSpec, ImageFocusSpec } from './slideElementSpec';

const IMAGE_CROP_SIDES = ['top', 'right', 'bottom', 'left'] as const;

/**
 * 解析作者写的图片裁剪：四边各裁掉原图多少（0–1），省略的边按 0。
 * 全零等同于不裁，返回 undefined；任何越界都明确报错，不静默夹紧。
 */
export function readImageCropInput(
  value: unknown,
  path: string,
): { value: ImageCropSpec | undefined } | { error: string } {
  const shapeError = `${path} 写成 { top, right, bottom, left }，每项是从原图这一边裁掉的比例（0–1），省略的边不裁。`;
  if (!isRecord(value) || Object.keys(value).some((key) => !(IMAGE_CROP_SIDES as readonly string[]).includes(key))) {
    return { error: shapeError };
  }
  const crop: ImageCropSpec = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const side of IMAGE_CROP_SIDES) {
    const raw = value[side];
    if (raw == null) continue;
    if (!isFiniteNumber(raw) || raw < 0 || raw >= 1) {
      return { error: `${path}.${side} 必须是 0–1 之间的比例（从原图这一边裁掉多少），收到 ${String(raw)}。` };
    }
    crop[side] = raw;
  }
  const maxTotal = 1 - IMAGE_CROP_MIN_VISIBLE;
  if (crop.left + crop.right > maxTotal) {
    return { error: `${path}.left 与 ${path}.right 相加必须小于 ${maxTotal}，裁剪后至少保留原图 1% 的宽度。` };
  }
  if (crop.top + crop.bottom > maxTotal) {
    return { error: `${path}.top 与 ${path}.bottom 相加必须小于 ${maxTotal}，裁剪后至少保留原图 1% 的高度。` };
  }
  return { value: IMAGE_CROP_SIDES.some((side) => crop[side] > 0) ? crop : undefined };
}

/** 解析图片焦点：原图上的归一化点，左上为 (0, 0)。 */
export function readImageFocusInput(
  value: unknown,
  path: string,
): { value: ImageFocusSpec } | { error: string } {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => key !== 'x' && key !== 'y')
    || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)
    || value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1
  ) {
    return { error: `${path} 写成 { x, y }，是原图上的点（0–1，左上为 0,0）；cover 裁掉溢出时取景窗尽量以它为中心。` };
  }
  return { value: { x: value.x, y: value.y } };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
