import type { CanvasLayoutRequest, CanvasLayoutResult } from '../../layout/definitions/canvasLayout';

export interface CanvasComputationRuntime {
  layout(request: CanvasLayoutRequest, signal?: AbortSignal): Promise<CanvasLayoutResult>;
  dispose(): Promise<void>;
}
