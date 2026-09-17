import type { ManualEditableTarget } from './manualEditingTypes';

export const MANUAL_RESIZE_HANDLES = ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left'] as const;
export type ManualResizeHandle = typeof MANUAL_RESIZE_HANDLES[number];

/** 各手柄所在的局部边；0 表示中点，对边／对角是本次缩放的固定锚点。 */
export const MANUAL_RESIZE_DIRECTIONS: Readonly<Record<ManualResizeHandle, readonly [-1 | 0 | 1, -1 | 0 | 1]>> = {
  'top-left': [-1, -1], top: [0, -1], 'top-right': [1, -1], right: [1, 0],
  'bottom-right': [1, 1], bottom: [0, 1], 'bottom-left': [-1, 1], left: [-1, 0],
};
export interface ManualResizeStart {
  readonly target: ManualEditableTarget;
  readonly handle: ManualResizeHandle;
  readonly clientX: number;
  readonly clientY: number;
  readonly renderScale: number;
}
