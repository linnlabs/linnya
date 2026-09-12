import { INCHES_TO_PX } from '../../../shared/constants';
import type { SourceSelectionPoint } from '../definitions/sourceSelectionTypes';

export function resolveSlidePointerPoint(input: {
  readonly clientX: number;
  readonly clientY: number;
  readonly wrapperRect: Pick<DOMRect, 'left' | 'top'>;
  readonly renderScale: number;
  readonly slideSize: { readonly width: number; readonly height: number };
}): SourceSelectionPoint | null {
  if (input.renderScale <= 0) return null;
  const x = (input.clientX - input.wrapperRect.left) / input.renderScale / INCHES_TO_PX;
  const y = (input.clientY - input.wrapperRect.top) / input.renderScale / INCHES_TO_PX;
  return {
    x: Math.max(0, Math.min(x, input.slideSize.width)),
    y: Math.max(0, Math.min(y, input.slideSize.height)),
  };
}
