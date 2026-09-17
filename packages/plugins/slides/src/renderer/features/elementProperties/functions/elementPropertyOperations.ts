import type { ManualEditableTarget } from '../../manualEditing';
import { SLIDES_MANUAL_FONT_SIZE_PT } from '@plugin/slides/shared/authoringEditing';
import type { ElementPropertyOperation } from '../definitions/elementPropertyTypes';

export function resolveVisualSizeAfterDimensionChange(
  targetKind: ManualEditableTarget['targetKind'],
  committedSize: { readonly width: number; readonly height: number },
  changedDimension: 'width' | 'height',
  value: number,
): { readonly width: number; readonly height: number } | null {
  if (
    !isPositiveFiniteNumber(value)
    || !isPositiveFiniteNumber(committedSize.width)
    || !isPositiveFiniteNumber(committedSize.height)
  ) {
    return null;
  }
  if (targetKind !== 'image') {
    return changedDimension === 'width'
      ? { width: value, height: committedSize.height }
      : { width: committedSize.width, height: value };
  }
  const aspectRatio = committedSize.width / committedSize.height;
  return changedDimension === 'width'
    ? { width: value, height: value / aspectRatio }
    : { width: value * aspectRatio, height: value };
}

export function createTextStyleOperation(
  target: ManualEditableTarget,
  value: { readonly fontSizePt?: number; readonly color?: string },
): ElementPropertyOperation | null {
  if (target.targetKind !== 'text' || !target.capabilities.includes('set_text_style')) return null;
  if (value.fontSizePt === undefined && value.color === undefined) return null;
  if (
    value.fontSizePt !== undefined
    && (!Number.isFinite(value.fontSizePt) || value.fontSizePt < SLIDES_MANUAL_FONT_SIZE_PT.min || value.fontSizePt > SLIDES_MANUAL_FONT_SIZE_PT.max)
  ) {
    return null;
  }
  if (value.color !== undefined && !isCanonicalHexColor(value.color)) return null;
  return { op: 'set_text_style', target: target.authoringRef, ...value };
}

export function createFillColorOperation(
  target: ManualEditableTarget,
  color: string,
): ElementPropertyOperation | null {
  if (
    (target.targetKind !== 'frame' && target.targetKind !== 'shape')
    || !target.capabilities.includes('set_fill_color')
  ) {
    return null;
  }
  if (!isCanonicalHexColor(color)) return null;
  return { op: 'set_fill_color', target: target.authoringRef, targetKind: target.targetKind, color };
}

export function createVisualSizeOperation(
  target: ManualEditableTarget,
  visualSize: { readonly width: number; readonly height: number },
): ElementPropertyOperation | null {
  if (
    (target.targetKind !== 'shape' && target.targetKind !== 'image')
    || !target.capabilities.includes('set_visual_size')
  ) {
    return null;
  }
  if (!isPositiveFiniteNumber(visualSize.width) || !isPositiveFiniteNumber(visualSize.height)) {
    return null;
  }
  return { op: 'set_visual_size', target: target.authoringRef, targetKind: target.targetKind, visualSize };
}

function isPositiveFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isCanonicalHexColor(value: string): boolean {
  return /^#[0-9A-F]{6}$/i.test(value);
}
