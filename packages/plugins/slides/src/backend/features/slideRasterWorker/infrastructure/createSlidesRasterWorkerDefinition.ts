import type { HiddenWorkerDefinition } from '@plugin/backend/hiddenWorkerRuntime';
import path from 'node:path';
import {
  SLIDES_RASTER_WORKER_ID,
  SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
  SLIDES_RASTER_WORKER_READY_CHANNEL,
  SLIDES_RASTER_WORKER_REQUEST_CHANNEL,
  SLIDES_RASTER_WORKER_RESPONSE_CHANNEL,
  SLIDES_RASTER_WORKER_CANCEL_CHANNEL,
  createSlideRasterWorkerCancelPayload,
  createSlideRasterWorkerRequestPayload,
  extractSlideRasterRequestId,
  parseSlideRasterRequest,
  parseSlideRasterWorkerReadyPayload,
  parseSlideRasterWorkerResponsePayload,
} from '@plugin/slides/shared/slideRasterization';
import type { SlidesRasterWorkerRuntimeLocation } from '../definitions/slidesRasterWorkerPaths';
import { resolveSlidesRasterWorkerPaths } from '../functions/resolveSlidesRasterWorkerPaths';

export interface CreateSlidesRasterWorkerDefinitionOptions {
  runtime?: SlidesRasterWorkerRuntimeLocation;
  recordDiagnostic?: (message: string) => void;
}

export function createSlidesRasterWorkerDefinition(
  options: CreateSlidesRasterWorkerDefinitionOptions = {},
): HiddenWorkerDefinition {
  const runtime = options.runtime ?? resolveDefaultRuntimeLocation();
  const paths = resolveSlidesRasterWorkerPaths({ runtime });
  const recordDiagnostic = options.recordDiagnostic ?? ((message: string) => console.info(message));
  recordDiagnostic(
    '[slides-raster-worker] registration'
    + ` mode=${runtime.mode}`
    + ` rootSource=${runtime.rootSource}`
    + ` protocol=${SLIDES_RASTER_WORKER_PROTOCOL_VERSION}`
    + ' html=dist/raster-worker/worker.html'
    + ' preload=dist/backend/raster-worker-preload.cjs',
  );

  return {
    id: SLIDES_RASTER_WORKER_ID,
    requestChannel: SLIDES_RASTER_WORKER_REQUEST_CHANNEL,
    responseChannel: SLIDES_RASTER_WORKER_RESPONSE_CHANNEL,
    readyChannel: SLIDES_RASTER_WORKER_READY_CHANNEL,
    cancelChannel: SLIDES_RASTER_WORKER_CANCEL_CHANNEL,
    workerHtmlPath: paths.workerHtmlPath,
    preloadPath: paths.preloadPath,
    partition: 'hidden-worker:slides-raster',
    readyTimeoutMs: 10_000,
    requestTimeoutMs: 20_000,
    idleTimeoutMs: 5 * 60 * 1000,
    createRequestPayload: (input) => {
      try {
        const request = parseSlideRasterRequest(input);
        return {
          requestId: request.requestId,
          payload: createSlideRasterWorkerRequestPayload(request),
        };
      } catch (error) {
        recordDiagnostic(
          '[slides-raster-worker] stage=backend-admission outcome=rejected'
          + ` reason=${readErrorMessage(error)}`,
        );
        throw error;
      }
    },
    parseResponsePayload: (payload) => {
      try {
        const response = parseSlideRasterWorkerResponsePayload(payload);
        return {
          requestId: response.requestId,
          response: response.result,
        };
      } catch (error) {
        recordDiagnostic('[slides-raster-worker] stage=response-admission outcome=rejected');
        throw error;
      }
    },
    parseReadyPayload: (payload) => {
      try {
        parseSlideRasterWorkerReadyPayload(payload);
      } catch (error) {
        recordDiagnostic('[slides-raster-worker] stage=ready-admission outcome=rejected');
        throw error;
      }
    },
    createCancelPayload: createSlideRasterWorkerCancelPayload,
    extractRequestIdFromInvalidPayload: extractSlideRasterRequestId,
  };
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown';
}

function resolveDefaultRuntimeLocation(): SlidesRasterWorkerRuntimeLocation {
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
