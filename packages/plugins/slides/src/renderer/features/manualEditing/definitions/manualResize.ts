import type { ManualEditableTarget } from './manualEditingTypes';

export type ManualResizeHandle = 'right' | 'bottom' | 'corner';
export interface ManualResizeStart {
  readonly target: ManualEditableTarget;
  readonly handle: ManualResizeHandle;
  readonly clientX: number;
  readonly clientY: number;
  readonly renderScale: number;
}
