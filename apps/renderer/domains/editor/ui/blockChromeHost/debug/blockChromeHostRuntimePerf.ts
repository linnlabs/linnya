import type { ActiveChromeBlock } from '../definitions/activeChromeBlocks';
import type { BlockChromeRenderPlan, BlockChromeSurface } from '../definitions/blockChromeRenderPlan';

export interface BlockChromeHostRuntimeSnapshot {
  activeCount: number;
  targetReadyCount: number;
  bySource: Record<string, number>;
  bySurface: Record<string, number>;
  blockIds: string[];
  missingTargetBlockIds: string[];
  plans: BlockChromeHostRuntimePlanSample[];
  timestamp: number;
}

export interface BlockChromeHostRuntimePlanSample {
  blockId: string;
  sources: readonly string[];
  surfaces: readonly BlockChromeSurface[];
  targetReady: boolean;
}

export interface BlockChromeHostRuntimePerfApi {
  getSnapshot: () => BlockChromeHostRuntimeSnapshot | null;
  getHistory: () => BlockChromeHostRuntimeSnapshot[];
  clear: () => void;
}

declare global {
  interface Window {
    __BLOCK_CHROME_HOST_PERF__?: BlockChromeHostRuntimePerfApi;
  }
}

const HISTORY_LIMIT = 120;
const BLOCK_ID_SAMPLE_LIMIT = 24;
const history: BlockChromeHostRuntimeSnapshot[] = [];

function clampHistory(): void {
  if (history.length > HISTORY_LIMIT) {
    history.splice(0, history.length - HISTORY_LIMIT);
  }
}

function installBlockChromeHostPerfApi(): void {
  if (typeof window === 'undefined') return;

  window.__BLOCK_CHROME_HOST_PERF__ = {
    getSnapshot: () => history[history.length - 1] ?? null,
    getHistory: () => [...history],
    clear: () => {
      history.length = 0;
    },
  };
}

export function recordBlockChromeHostShadowSnapshot(params: {
  activeBlocks: readonly ActiveChromeBlock[];
  targetReadyBlockIds: ReadonlySet<string>;
  renderPlans?: readonly BlockChromeRenderPlan[];
}): void {
  const bySource: Record<string, number> = {};
  params.activeBlocks.forEach((block) => {
    block.sources.forEach((source) => {
      bySource[source] = (bySource[source] ?? 0) + 1;
    });
  });

  const renderPlans = params.renderPlans ?? [];
  const bySurface: Record<string, number> = {};
  renderPlans.forEach((plan) => {
    plan.surfaces.forEach((surface) => {
      bySurface[surface] = (bySurface[surface] ?? 0) + 1;
    });
  });

  const blockIds = params.activeBlocks
    .slice(0, BLOCK_ID_SAMPLE_LIMIT)
    .map((block) => block.blockId);
  const missingTargetBlockIds = params.activeBlocks
    .filter((block) => !params.targetReadyBlockIds.has(block.blockId))
    .slice(0, BLOCK_ID_SAMPLE_LIMIT)
    .map((block) => block.blockId);

  history.push({
    activeCount: params.activeBlocks.length,
    targetReadyCount: params.targetReadyBlockIds.size,
    bySource,
    bySurface,
    blockIds,
    missingTargetBlockIds,
    plans: renderPlans.slice(0, BLOCK_ID_SAMPLE_LIMIT).map((plan) => ({
      blockId: plan.blockId,
      sources: [...plan.sources],
      surfaces: [...plan.surfaces],
      targetReady: plan.targetReady,
    })),
    timestamp: Date.now(),
  });
  clampHistory();
  installBlockChromeHostPerfApi();
}

installBlockChromeHostPerfApi();
