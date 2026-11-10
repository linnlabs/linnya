import { invokeHiddenWorker } from '@plugin/backend/hiddenWorkerRuntime';
import { createCanvasComputationRuntime } from '../capabilities/canvasComputation';
import { createCanvasCardMeasurement } from '../capabilities/cardMeasurement/createCanvasCardMeasurement';
import { createCanvasRenderRuntime } from '../features/canvasRender';
import type { CanvasBackendCapabilities } from '../definitions/canvasBackendCapabilities';
export function createCanvasBackendCapabilities(workerPath: string): CanvasBackendCapabilities {
  const renderPort = { invoke: invokeHiddenWorker };
  return {
    computation: createCanvasComputationRuntime({ workerPath }),
    measurement: createCanvasCardMeasurement(renderPort),
    rendering: createCanvasRenderRuntime(renderPort),
  };
}
