import type { CanvasCommand, CanvasElement } from '../../../../shared';
import type { CanvasWorkingPlan } from './canvasWorkingPlan';
import type { CanvasStoredElement } from './canvasCommit';
export interface CanvasUpdateFieldUnit {
  readonly fields: readonly string[];
  readonly dependencies: readonly string[];
  readonly dependencyReason: 'stale_measurement' | 'stale_layout_size' | 'stale_geometry';
}
export interface CanvasUpdateFieldContext {
  readonly plan: CanvasWorkingPlan;
  readonly row: CanvasStoredElement;
  readonly command: Extract<CanvasCommand, { op: 'update' }>;
  readonly candidate: CanvasElement;
}
