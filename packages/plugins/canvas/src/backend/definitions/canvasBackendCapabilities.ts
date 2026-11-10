import type { CanvasComputationRuntime } from '../../shared';
import type { createCanvasCardMeasurement } from '../capabilities/cardMeasurement/createCanvasCardMeasurement';
import type { createCanvasRenderRuntime } from '../features/canvasRender';
export interface CanvasBackendCapabilities {
  readonly computation: CanvasComputationRuntime;
  readonly measurement: ReturnType<typeof createCanvasCardMeasurement>;
  readonly rendering: ReturnType<typeof createCanvasRenderRuntime>;
}
