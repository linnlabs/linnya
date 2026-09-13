import { INCHES_TO_PX } from '../../../shared/constants';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';

export interface ManualSelectionBreadcrumbViewport {
  readonly slideLeft: number;
  readonly slideTop: number;
  readonly renderScale: number;
}

export type ManualSelectionBreadcrumbStyle = Readonly<Record<string, string>>;

export function resolveManualSelectionBreadcrumbStyle(
  target: ManualEditableTarget,
  viewport: ManualSelectionBreadcrumbViewport,
): ManualSelectionBreadcrumbStyle {
  return {
    left: `${viewport.slideLeft + target.bounds.x * INCHES_TO_PX * viewport.renderScale}px`,
    top: `${Math.max(
      4,
      viewport.slideTop + target.bounds.y * INCHES_TO_PX * viewport.renderScale - 30,
    )}px`,
  };
}
