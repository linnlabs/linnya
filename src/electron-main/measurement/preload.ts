import { contextBridge, ipcRenderer } from 'electron';
import {
  MEASUREMENT_BATCH_REQUEST_CHANNEL,
  MEASUREMENT_BATCH_RESPONSE_CHANNEL,
  MEASUREMENT_WORKER_READY_CHANNEL,
  createMeasurementBatchResponse,
  createMeasurementWorkerReadyPayload,
  parseMeasurementBatchRequest,
  type MeasurementBatchRequest,
  type MeasurementBatchResponse,
  type MeasurementWorkerBridge,
} from '../../features/text-measurement/infrastructure/browser-pretext/protocol.js';

type BatchHandler = (request: MeasurementBatchRequest) => MeasurementBatchResponse | Promise<MeasurementBatchResponse>;

let handler: BatchHandler | null = null;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

ipcRenderer.on(MEASUREMENT_BATCH_REQUEST_CHANNEL, async (_event, payload: unknown) => {
  let request: MeasurementBatchRequest;
  try {
    request = parseMeasurementBatchRequest(payload);
  } catch (error) {
    console.error('[MeasurementWorkerPreload] Invalid request payload:', error);
    return;
  }

  if (handler == null) {
    ipcRenderer.send(
      MEASUREMENT_BATCH_RESPONSE_CHANNEL,
      createMeasurementBatchResponse(request.requestId, request.inputs.map(() => ({
        error: 'Measurement worker handler has not been registered.',
      }))),
    );
    return;
  }

  try {
    const response = await handler(request);
    ipcRenderer.send(MEASUREMENT_BATCH_RESPONSE_CHANNEL, response);
  } catch (error) {
    ipcRenderer.send(
      MEASUREMENT_BATCH_RESPONSE_CHANNEL,
      createMeasurementBatchResponse(request.requestId, request.inputs.map(() => ({
        error: toErrorMessage(error),
      }))),
    );
  }
});

const bridge: MeasurementWorkerBridge = {
  setMeasureBatchHandler(nextHandler) {
    handler = nextHandler;
  },
  notifyReady() {
    ipcRenderer.send(MEASUREMENT_WORKER_READY_CHANNEL, createMeasurementWorkerReadyPayload());
  },
};

contextBridge.exposeInMainWorld('__measurementBridge', bridge);
