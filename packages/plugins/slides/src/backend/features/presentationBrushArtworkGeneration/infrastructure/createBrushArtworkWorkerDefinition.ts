import path from 'node:path';
import type { HiddenWorkerDefinition } from '@plugin/backend/hiddenWorkerRuntime';
import {
  SLIDES_BRUSH_WORKER_CANCEL_CHANNEL,
  SLIDES_BRUSH_WORKER_ID,
  SLIDES_BRUSH_WORKER_READY_CHANNEL,
  SLIDES_BRUSH_WORKER_REQUEST_CHANNEL,
  SLIDES_BRUSH_WORKER_RESPONSE_CHANNEL,
  createBrushArtworkWorkerCancelPayload,
  createBrushArtworkWorkerRequestPayload,
  extractBrushArtworkRequestId,
  parseBrushArtworkRenderRequest,
  parseBrushArtworkWorkerReadyPayload,
  parseBrushArtworkWorkerResponsePayload,
} from '@plugin/slides/shared/brushArtwork';
import type { BrushArtworkWorkerRuntimeLocation } from '../definitions/brushArtworkWorkerPaths';
import { resolveBrushArtworkWorkerPaths } from '../functions/resolveBrushArtworkWorkerPaths';

export function createBrushArtworkWorkerDefinition(
  runtime: BrushArtworkWorkerRuntimeLocation = resolveDefaultRuntimeLocation(),
): HiddenWorkerDefinition {
  const paths = resolveBrushArtworkWorkerPaths(runtime);
  return {
    id: SLIDES_BRUSH_WORKER_ID,
    requestChannel: SLIDES_BRUSH_WORKER_REQUEST_CHANNEL,
    responseChannel: SLIDES_BRUSH_WORKER_RESPONSE_CHANNEL,
    readyChannel: SLIDES_BRUSH_WORKER_READY_CHANNEL,
    cancelChannel: SLIDES_BRUSH_WORKER_CANCEL_CHANNEL,
    workerHtmlPath: paths.workerHtmlPath,
    preloadPath: paths.preloadPath,
    partition: 'hidden-worker:slides-brush',
    readyTimeoutMs: 20_000,
    requestTimeoutMs: 30_000,
    idleTimeoutMs: 5 * 60 * 1000,
    createRequestPayload(input) {
      const request = parseBrushArtworkRenderRequest(input);
      return {
        requestId: request.requestId,
        payload: createBrushArtworkWorkerRequestPayload(request),
      };
    },
    parseResponsePayload(payload) {
      const response = parseBrushArtworkWorkerResponsePayload(payload);
      return { requestId: response.requestId, response: response.result };
    },
    parseReadyPayload: parseBrushArtworkWorkerReadyPayload,
    createCancelPayload: createBrushArtworkWorkerCancelPayload,
    extractRequestIdFromInvalidPayload: extractBrushArtworkRequestId,
  };
}

function resolveDefaultRuntimeLocation(): BrushArtworkWorkerRuntimeLocation {
  const loadingMode = process.env.LINNYA_PLUGIN_BACKEND_LOADING;
  if (loadingMode === 'disk' || loadingMode === 'disk-only') {
    return {
      mode: 'artifact-runtime',
      packageRoot: path.resolve(__dirname, '../..'),
      rootSource: 'backend-bundle',
    };
  }
  return {
    mode: 'source-development',
    packageRoot: path.resolve(process.cwd(), 'packages/plugins/slides'),
    rootSource: 'workspace',
  };
}
