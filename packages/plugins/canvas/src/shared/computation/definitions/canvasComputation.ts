import type { CanvasLayoutRequest, CanvasLayoutResult } from '../../layout/definitions/canvasLayout';
import type { CanvasSnapshot } from '../../model/definitions/canvasElement';
import type { CanvasCheckReport } from '../../query/definitions/canvasCheck';

export interface CanvasComputationRuntime {
  layout(request: CanvasLayoutRequest, signal?: AbortSignal): Promise<CanvasLayoutResult>;
  check(snapshot: CanvasSnapshot, signal?: AbortSignal): Promise<CanvasCheckReport>;
  dispose(): Promise<void>;
}
