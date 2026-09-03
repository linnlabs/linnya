import path from 'path';
import type { BrowserWindowConstructorOptions } from 'electron';
import type {
  NormalizedClusterAdvanceRequest,
  NormalizedTextMeasureInput,
} from '../../features/text-measurement/index.js';
import {
  HiddenWorkerHost,
  type HiddenWorkerBrowserWindowLike,
  type HiddenWorkerIpcMainLike,
  type HiddenWorkerWebContentsLike,
} from '../hidden-worker/HiddenWorkerHost.js';
import {
  MEASUREMENT_BATCH_REQUEST_CHANNEL,
  MEASUREMENT_BATCH_RESPONSE_CHANNEL,
  MEASUREMENT_WORKER_READY_CHANNEL,
  createMeasurementBatchRequest,
  parseMeasurementBatchResponse,
  parseMeasurementWorkerReadyPayload,
  type MeasurementBatchResponse,
} from '../../features/text-measurement/infrastructure/browser-pretext/protocol.js';
import { Logger } from '../../shared/logger.js';

export type MeasurementWebContentsLike = HiddenWorkerWebContentsLike;
export type MeasurementBrowserWindowLike = HiddenWorkerBrowserWindowLike;
export type MeasurementIpcMainLike = HiddenWorkerIpcMainLike;

export interface MeasurementWorkerManagerOptions {
  createBrowserWindow?: (options: BrowserWindowConstructorOptions) => MeasurementBrowserWindowLike;
  ipcMain?: MeasurementIpcMainLike;
  workerHtmlPath?: string;
  preloadPath?: string;
  idleTimeoutMs?: number;
  readyTimeoutMs?: number;
  batchTimeoutMs?: number;
  /**
   * 连续 batch 超时次数达到该阈值后，强制 dispose 当前 worker 以重新 spawn。
   * 防御 worker 进程“无 crash 但完全 hang”的情况。默认 3。
   */
  maxConsecutiveTimeouts?: number;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
}

interface MeasurementWorkerInvokeInput {
  inputs: readonly NormalizedTextMeasureInput[];
  clusterRequests: readonly NormalizedClusterAdvanceRequest[];
}

function extractRequestIdFromInvalidPayload(payload: unknown): string | null {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }
  const candidate = Reflect.get(payload, 'requestId');
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

export class MeasurementWorkerManager {
  private static singleton: MeasurementWorkerManager | null = null;

  private readonly host: HiddenWorkerHost<MeasurementWorkerInvokeInput, MeasurementBatchResponse>;

  constructor(options: MeasurementWorkerManagerOptions = {}) {
    this.host = new HiddenWorkerHost({
      workerId: 'measurement',
      requestChannel: MEASUREMENT_BATCH_REQUEST_CHANNEL,
      responseChannel: MEASUREMENT_BATCH_RESPONSE_CHANNEL,
      readyChannel: MEASUREMENT_WORKER_READY_CHANNEL,
      workerHtmlPath: options.workerHtmlPath ?? path.join(__dirname, 'worker.html'),
      preloadPath: options.preloadPath ?? path.join(__dirname, 'measurement-preload.js'),
      partition: 'measurement-worker',
      createBrowserWindow: options.createBrowserWindow,
      ipcMain: options.ipcMain,
      idleTimeoutMs: options.idleTimeoutMs,
      readyTimeoutMs: options.readyTimeoutMs,
      requestTimeoutMs: options.batchTimeoutMs,
      maxConsecutiveTimeouts: options.maxConsecutiveTimeouts,
      logger: options.logger,
      createRequestPayload: (request) => {
        const payload = createMeasurementBatchRequest(request.inputs, request.clusterRequests);
        return {
          requestId: payload.requestId,
          payload,
        };
      },
      parseResponsePayload: (payload) => {
        const response = parseMeasurementBatchResponse(payload);
        return {
          requestId: response.requestId,
          response,
        };
      },
      parseReadyPayload: parseMeasurementWorkerReadyPayload,
      extractRequestIdFromInvalidPayload,
    });
  }

  static instance(): MeasurementWorkerManager {
    if (MeasurementWorkerManager.singleton == null) {
      MeasurementWorkerManager.singleton = new MeasurementWorkerManager();
    }
    return MeasurementWorkerManager.singleton;
  }

  static async disposeSingleton(): Promise<void> {
    const current = MeasurementWorkerManager.singleton;
    if (current == null) {
      return;
    }
    await current.dispose();
  }

  ensureReady(): Promise<MeasurementBrowserWindowLike> {
    return this.host.ensureReady();
  }

  measureBatch(inputs: readonly NormalizedTextMeasureInput[]): Promise<MeasurementBatchResponse> {
    return this.host.invoke({ inputs, clusterRequests: [] });
  }

  measureClusterAdvancesBatch(
    clusterRequests: readonly NormalizedClusterAdvanceRequest[],
  ): Promise<MeasurementBatchResponse> {
    return this.host.invoke({ inputs: [], clusterRequests });
  }

  touch(): void {
    this.host.touch();
  }

  async dispose(): Promise<void> {
    await this.host.dispose();
    if (MeasurementWorkerManager.singleton === this) {
      MeasurementWorkerManager.singleton = null;
    }
  }
}
