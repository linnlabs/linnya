import { BrowserPretextAdapter } from '../../features/text-measurement/adapters/BrowserPretextAdapter.js';
import type { NormalizedTextMeasureInput } from '../../features/text-measurement/index.js';
import {
  createMeasurementBatchResponse,
  type MeasurementWorkerBridge,
} from '../../features/text-measurement/infrastructure/browser-pretext/protocol.js';

declare global {
  interface Window {
    __measurementBridge: MeasurementWorkerBridge;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// H5：notifyReady 之前先跑一次自检 measure。如果 BrowserPretextAdapter / Canvas
// 在该 worker 进程里根本无法工作（例如字体加载失败、Pretext 初始化崩溃），
// 我们要在 ready 阶段就让它失败 → MeasurementWorkerManager.spawnWorker 会立即
// reject，主进程立刻 fallback 到 Heuristic，避免后续每个 measureBatch 都超时。
const SELF_CHECK_INPUT: NormalizedTextMeasureInput = {
  paragraphs: [{ text: 'A' }],
  style: {
    fontSizePt: 11,
    bold: false,
    italic: false,
    lineHeightMultiplier: 1,
  },
  box: {
    widthInches: 1,
    wrap: 'word',
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    usableWidthInches: 1,
  },
  sourceKind: 'generated',
};

const adapter = new BrowserPretextAdapter();

try {
  const selfCheck = adapter.measure(SELF_CHECK_INPUT);
  if (!Number.isFinite(selfCheck.contentHeightInches) || selfCheck.contentHeightInches <= 0) {
    throw new Error(`self-check returned invalid measurement: ${JSON.stringify(selfCheck)}`);
  }
} catch (error) {
  // 直接抛 → preload/worker 引导脚本会捕获到 uncaught exception，
  // ready 永远不会发出，主进程会按 readyTimeoutMs 失败重 spawn / fallback。
  throw new Error(`measurement worker self-check failed: ${toErrorMessage(error)}`);
}

window.__measurementBridge.setMeasureBatchHandler((request) => {
  return createMeasurementBatchResponse(
    request.requestId,
    request.inputs.map((input) => {
      try {
        return adapter.measure(input);
      } catch (error) {
        return { error: toErrorMessage(error) };
      }
    }),
    (request.clusterRequests ?? []).map((clusterRequest) => {
      try {
        return { advances: adapter.measureClusterAdvances(clusterRequest) };
      } catch (error) {
        return { error: toErrorMessage(error) };
      }
    }),
  );
});

window.__measurementBridge.notifyReady();
