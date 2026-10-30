import { quantizeManualTranslation, roundToManualTranslationGrid, type SlidesManualEditCommandOperation } from '@plugin/slides/shared/authoringEditing';
import { INCHES_TO_PX } from '../../../shared/constants';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';

export type ManualTextWidthHandle = 'left' | 'right';
const MIN_TEXT_WIDTH = 0.3;

/** 作者文字框只开放宽度手柄：高度随内容决定，不提供上下与角点缩放。 */
export function canResizeTextWidth(target: ManualEditableTarget): boolean {
  return target.targetKind === 'text' && target.capabilities.includes('translate') && target.capabilities.includes('set_text_content');
}

export interface ManualTextWidthResult {
  /** 松手时提交的写入：右手柄只改宽度；左手柄同时平移，保持右边缘不动。 */
  readonly operation: SlidesManualEditCommandOperation;
  /** 拖动中的外框，单位 inches，供画布即时显示。 */
  readonly bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export function resolveManualTextWidth(
  target: ManualEditableTarget,
  handle: ManualTextWidthHandle,
  deltaClientX: number,
  renderScale: number,
): ManualTextWidthResult | null {
  const delta = deltaClientX / (INCHES_TO_PX * renderScale);
  const width = target.bounds.w;
  const nextWidth = roundToManualTranslationGrid(Math.max(MIN_TEXT_WIDTH, handle === 'right' ? width + delta : width - delta));
  if (Math.abs(nextWidth - width) < 1e-4) return null;
  const shift = handle === 'left' ? quantizeManualTranslation({ dx: width - nextWidth, dy: 0 }) : null;
  const resize = { op: 'set_text_width' as const, target: target.authoringRef, targetKind: 'text' as const, width: nextWidth };
  return {
    operation: shift
      ? { op: 'batch', operations: [{ op: 'translate_by', target: target.authoringRef, targetKind: 'text', delta: shift }, resize] }
      : resize,
    bounds: { x: target.bounds.x + (shift?.dx ?? 0), y: target.bounds.y, w: nextWidth, h: target.bounds.h },
  };
}
