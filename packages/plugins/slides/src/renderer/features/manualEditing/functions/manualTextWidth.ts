import { quantizeManualTranslation, roundToManualTranslationGrid } from '@plugin/slides/shared/authoringEditing';
import { INCHES_TO_PX } from '../../../shared/constants';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';
import type { ManualTextWidthHandle, ManualTextWidthIntent, ManualTextWidthResult } from '../definitions/manualTextWidth';

const MIN_TEXT_WIDTH = 0.3;

/** 作者文字框只开放宽度手柄：高度随内容决定，不提供上下与角点缩放。 */
export function canResizeTextWidth(target: ManualEditableTarget): boolean {
  return target.targetKind === 'text' && target.capabilities.includes('translate') && target.capabilities.includes('set_text_content');
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

/** 左手柄的位移只在宽度重排成功时一起可见，不能把旧行移到一个尚未生效的新外框。 */
export function createManualTextWidthIntent(target: ManualEditableTarget, result: ManualTextWidthResult): ManualTextWidthIntent {
  const width = result.operation.op === 'batch'
    ? result.operation.operations[1] : result.operation;
  const translation = result.operation.op === 'batch'
    ? result.operation.operations[0] : undefined;
  return { operation: result.operation, visualPreviews: [{ elementId: target.elementId,
    affectedElementIds: [target.elementId], operation: width,
    ...(translation ? { translationDelta: translation.delta } : {}),
  }] };
}
