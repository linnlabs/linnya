import type { Editor } from '@tiptap/core';
import { useRevisionStore } from '../../store/useRevisionStore';
import type { PendingProjectionResult, RevisionStore } from '../../store/types';
import { getFlag, shouldUseRootBlockShellForOwner } from '../../../../ui/services/editorFeatureFlags';
import type {
  RenderVirtualizationEngine,
  RenderVirtualizationRefreshReason,
} from '../../../RenderVirtualization';
import {
  publishShellPendingProjectionPerf,
  type ShellPendingProjectionPerfReason,
} from './shellPendingProjectionPerf';
import {
  scheduleEditorFrameTask,
  scheduleEditorIdleTask,
  type EditorScheduledTask,
} from '../../../../ui/scheduling/editorIdleScheduler';
import { createShellPendingProjectionQueue } from './createShellPendingProjectionQueue';
import {
  makeBlockIdsKey,
  orderHydratedBlockIdsByVisiblePriority,
  sampleBlockIds,
  uniqueBlockIds,
} from './blockIdOrdering';
import { selectShellPendingProjectionCandidates } from './selectShellPendingProjectionCandidates';
import { shouldPreferFrameShellPendingProjection } from './resolveShellPendingProjectionSchedule';

interface EditorEventBusLike {
  on?: (eventName: string, listener: () => void) => void;
  off?: (eventName: string, listener: () => void) => void;
}

type EditorWithOptionalEventBus = Editor & {
  eventBus?: EditorEventBusLike;
}

export interface ShellPendingProjectionBridgeOptions {
  getEditor: () => EditorWithOptionalEventBus | null;
  renderVirtualizationEngine: RenderVirtualizationEngine;
}

const SNAPSHOT_REPROJECT_THROTTLE_MS = 80;
const IDLE_PROJECTION_TIMEOUT_MS = 280;
const SHELL_PROJECTION_FLUSH_BLOCK_LIMIT = 8;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function logShellPendingProjectionStage(stage: string, buildMetrics: () => readonly string[]): void {
  if (!getFlag('renderVirtualizationDebugLogging')) return;
  const metrics = buildMetrics();
  console.info(`[ShellPendingProjection] ${stage} ${metrics.join(' ')}`);
}

/**
 * Shell NodeView 路径的 pending 投影协调器。
 *
 * 中文说明：
 * - Shell NodeView 没有 Vue BlockView 生命周期，所以不会自动触发 useBlockRevision；
 * - 这里只消费 RenderVirtualizationEngine 输出的 hydrated window，把 blockId 批量交给 RevisionStore；
 * - 只读取 RevisionStore 对外暴露的 canonical / active 查询接口，用它们筛出真正需要投影的候选块；
 * - 去重和节流也只基于候选块，避免 pending 快照晚于首帧 hydrate 时把真实投影机会误判为已处理。
 * - RevisionOverlayLayer 只负责显示，不再承担投影事务，避免滚动时多条链路重复采样/重复投影。
 */
export function setupShellPendingProjectionBridge(
  options: ShellPendingProjectionBridgeOptions
): () => void {
  let projectionSchedule: EditorScheduledTask | null = null;
  let latestHydratedBlockIds: string[] = [];
  let latestVisibleBlockIds: string[] = [];
  let latestFrameProjectionPreferred = false;
  const projectionQueue = createShellPendingProjectionQueue();
  let lastProjectedKey = '';
  let lastProjectedAt: number | null = null;

  function publishBridgePerf(params: {
    reason: ShellPendingProjectionPerfReason;
    hydratedCount: number;
    candidateCount: number;
    projectedCount?: number;
    failedCount?: number;
    skippedActiveCount?: number;
    skippedNonPendingCount?: number;
    candidateBlockIds?: readonly string[];
    skippedActiveBlockIds?: readonly string[];
    skippedNonPendingBlockIds?: readonly string[];
    label?: string;
    snapshotVersion?: number;
    virtualizationEnabled?: boolean;
    visibleCount?: number;
    startedAt: number;
  }): void {
    publishShellPendingProjectionPerf({
      reason: params.reason,
      label: params.label,
      snapshotVersion: params.snapshotVersion,
      virtualizationEnabled: params.virtualizationEnabled,
      visibleCount: params.visibleCount,
      hydratedCount: params.hydratedCount,
      candidateCount: params.candidateCount,
      projectedCount: params.projectedCount ?? 0,
      failedCount: params.failedCount ?? 0,
      skippedActiveCount: params.skippedActiveCount ?? 0,
      skippedNonPendingCount: params.skippedNonPendingCount ?? 0,
      candidateBlockIds: sampleBlockIds(params.candidateBlockIds ?? []),
      skippedActiveBlockIds: sampleBlockIds(params.skippedActiveBlockIds ?? []),
      skippedNonPendingBlockIds: sampleBlockIds(params.skippedNonPendingBlockIds ?? []),
      durationMs: Math.round((nowMs() - params.startedAt) * 10) / 10,
      timestamp: Date.now(),
    });
  }

  function projectPendingForBlockIds(
    store: RevisionStore,
    blockIds: readonly string[]
  ): Promise<PendingProjectionResult> {
    const editor = options.getEditor();
    if (!editor || editor.isDestroyed || blockIds.length === 0) {
      return Promise.resolve({
        requestedCount: blockIds.length,
        batchCount: 0,
        projectedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        totalMs: 0,
        flushMs: 0,
      });
    }

    return store.projectPendingRevisionsForBlocks([...blockIds]);
  }

  function clearProjectionSchedule(): void {
    if (projectionSchedule === null) return;

    const currentSchedule = projectionSchedule;
    projectionSchedule = null;

    currentSchedule.cancel();
  }

  function scheduleProjectionFlush(preferFrame = latestFrameProjectionPreferred): void {
    logShellPendingProjectionStage('schedule', () => [
      `pending=${projectionSchedule !== null}`,
      `latest=${latestHydratedBlockIds.length}`,
      `inFlight=${projectionQueue.isRunning()}`,
      `preferFrame=${preferFrame}`,
    ]);
    if (projectionSchedule !== null) {
      if (preferFrame && projectionSchedule.kind === 'idle') {
        clearProjectionSchedule();
      } else {
        return;
      }
    }

    if (preferFrame) {
      projectionSchedule = scheduleEditorFrameTask(() => {
        logShellPendingProjectionStage('raf:start', () => [
          `latest=${latestHydratedBlockIds.length}`,
        ]);
        projectionSchedule = null;
        flushSnapshotProjection();
        logShellPendingProjectionStage('raf:end', () => [
          `latest=${latestHydratedBlockIds.length}`,
        ]);
      });
      return;
    }

    projectionSchedule = scheduleEditorIdleTask(() => {
      logShellPendingProjectionStage('idle:start', () => [
        `latest=${latestHydratedBlockIds.length}`,
      ]);
      projectionSchedule = null;
      flushSnapshotProjection();
      logShellPendingProjectionStage('idle:end', () => [
        `latest=${latestHydratedBlockIds.length}`,
      ]);
    }, { timeoutMs: IDLE_PROJECTION_TIMEOUT_MS });
  }

  function flushSnapshotProjection(): void {
    const startedAt = nowMs();
    logShellPendingProjectionStage('flush:start', () => [
      `latest=${latestHydratedBlockIds.length}`,
      `inFlight=${projectionQueue.isRunning()}`,
    ]);
    const editor = options.getEditor();
    if (!shouldUseRootBlockShellForOwner(editor)) {
      publishBridgePerf({
        reason: 'shell-disabled',
        hydratedCount: 0,
        candidateCount: 0,
        startedAt,
      });
      logShellPendingProjectionStage('flush:end', () => [
        'reason=shell-disabled',
        `durationMs=${Math.round((nowMs() - startedAt) * 10) / 10}`,
      ]);
      return;
    }

    const blockIds = orderHydratedBlockIdsByVisiblePriority({
      visibleBlockIds: latestVisibleBlockIds,
      hydratedBlockIds: latestHydratedBlockIds,
    });
    if (blockIds.length === 0) {
      publishBridgePerf({
        reason: 'empty-window',
        hydratedCount: 0,
        candidateCount: 0,
        startedAt,
      });
      logShellPendingProjectionStage('flush:end', () => [
        'reason=empty-window',
        `durationMs=${Math.round((nowMs() - startedAt) * 10) / 10}`,
      ]);
      return;
    }

    if (!editor || editor.isDestroyed) {
      publishBridgePerf({
        reason: 'editor-unavailable',
        hydratedCount: blockIds.length,
        candidateCount: 0,
        startedAt,
      });
      logShellPendingProjectionStage('flush:end', () => [
        'reason=editor-unavailable',
        `hydrated=${blockIds.length}`,
        `durationMs=${Math.round((nowMs() - startedAt) * 10) / 10}`,
      ]);
      return;
    }

    const revisionStore = useRevisionStore(editor);
    const {
      candidateBlockIds,
      skippedActiveBlockIds,
      skippedNonPendingBlockIds,
      skippedActiveCount,
      skippedNonPendingCount,
    } = selectShellPendingProjectionCandidates(revisionStore, blockIds);

    if (candidateBlockIds.length === 0) {
      publishBridgePerf({
        reason: 'no-candidates',
        hydratedCount: blockIds.length,
        candidateCount: 0,
        skippedActiveCount,
        skippedNonPendingCount,
        skippedActiveBlockIds,
        skippedNonPendingBlockIds,
        startedAt,
      });
      logShellPendingProjectionStage('flush:end', () => [
        'reason=no-candidates',
        `hydrated=${blockIds.length}`,
        `skippedNonPending=${skippedNonPendingCount}`,
        `durationMs=${Math.round((nowMs() - startedAt) * 10) / 10}`,
      ]);
      return;
    }

    const projectionBlockIds = candidateBlockIds.slice(0, SHELL_PROJECTION_FLUSH_BLOCK_LIMIT);
    const hasDeferredCandidates = candidateBlockIds.length > projectionBlockIds.length;
    const key = makeBlockIdsKey(projectionBlockIds);
    const now = nowMs();
    
    // 如果和上次投影的 blockIds 完全一样，且距离上次投影时间很短，直接忽略（防抖）
    if (lastProjectedAt != null && key === lastProjectedKey && now - lastProjectedAt < SNAPSHOT_REPROJECT_THROTTLE_MS) {
      publishBridgePerf({
        reason: 'throttled',
        hydratedCount: blockIds.length,
        candidateCount: candidateBlockIds.length,
        skippedActiveCount,
        skippedNonPendingCount,
        candidateBlockIds: projectionBlockIds,
        skippedActiveBlockIds,
        skippedNonPendingBlockIds,
        startedAt,
      });
      return;
    }

    if (projectionQueue.isRunning()) {
      projectionQueue.requestRerun();
      publishBridgePerf({
        reason: 'in-flight',
        hydratedCount: blockIds.length,
        candidateCount: candidateBlockIds.length,
        skippedActiveCount,
        skippedNonPendingCount,
        candidateBlockIds: projectionBlockIds,
        skippedActiveBlockIds,
        skippedNonPendingBlockIds,
        startedAt,
      });
      return;
    }

    projectionQueue.run(async () => {
      try {
        const projectionResult = await projectPendingForBlockIds(revisionStore, projectionBlockIds);
        const failed = projectionResult.failedCount > 0;
        if (!failed) {
          lastProjectedKey = key;
          lastProjectedAt = nowMs();
          if (hasDeferredCandidates) {
            projectionQueue.requestRerun();
          }
        }
        publishBridgePerf({
          reason: failed ? 'failed' : 'projected',
          hydratedCount: blockIds.length,
          candidateCount: candidateBlockIds.length,
          projectedCount: projectionResult.projectedCount,
          failedCount: projectionResult.failedCount,
          skippedActiveCount,
          skippedNonPendingCount,
          candidateBlockIds: projectionBlockIds,
          skippedActiveBlockIds,
          skippedNonPendingBlockIds,
          startedAt,
        });
      } catch (error: unknown) {
        publishBridgePerf({
          reason: 'failed',
          hydratedCount: blockIds.length,
          candidateCount: candidateBlockIds.length,
          projectedCount: 0,
          failedCount: projectionBlockIds.length,
          skippedActiveCount,
          skippedNonPendingCount,
          candidateBlockIds: projectionBlockIds,
          skippedActiveBlockIds,
          skippedNonPendingBlockIds,
          startedAt,
        });
        console.error('[ShellPendingProjection] pending 投影失败:', { blockIds: projectionBlockIds, error });
      }
    }, () => {
      scheduleSnapshotProjection({
        hydratedBlockIds: latestHydratedBlockIds,
        visibleBlockIds: latestVisibleBlockIds,
        preferFrame: latestFrameProjectionPreferred,
      });
    });
  }

  function scheduleSnapshotProjection(params: {
    hydratedBlockIds: readonly string[];
    visibleBlockIds?: readonly string[];
    label?: string;
    reason?: RenderVirtualizationRefreshReason;
    preferFrame?: boolean;
  }): void {
    const startedAt = nowMs();
    latestHydratedBlockIds = uniqueBlockIds(params.hydratedBlockIds);
    latestVisibleBlockIds = uniqueBlockIds(params.visibleBlockIds ?? []);
    latestFrameProjectionPreferred = params.preferFrame ?? shouldPreferFrameShellPendingProjection(params.reason);
    const editor = options.getEditor();
    if (!shouldUseRootBlockShellForOwner(editor)) {
      publishBridgePerf({
        reason: 'shell-disabled',
        label: params.label,
        hydratedCount: latestHydratedBlockIds.length,
        candidateCount: 0,
        startedAt,
      });
      return;
    }
    if (latestHydratedBlockIds.length === 0) {
      publishBridgePerf({
        reason: 'empty-window',
        label: params.label,
        hydratedCount: 0,
        candidateCount: 0,
        startedAt,
      });
      return;
    }

    scheduleProjectionFlush(latestFrameProjectionPreferred);
  }

  function refreshAndScheduleCurrentHydratedWindowProjection(label: string): void {
    // 中文说明：direct-state 文档加载不会经过普通 dispatchTransaction，
    // engine 无法靠 PM 事务自动感知新 doc。这里必须先同步 refreshNow，
    // 再读取返回的 hydrated window；直接 getSnapshot 可能拿到旧文档空窗口。
    const snapshot = options.renderVirtualizationEngine.refreshNow({
      type: 'scheduled',
      label,
    });
    publishBridgePerf({
      reason: 'engine-refresh',
      label,
      snapshotVersion: snapshot.version,
      virtualizationEnabled: snapshot.virtualizationEnabled,
      visibleCount: snapshot.visibleBlockIds.length,
      hydratedCount: snapshot.hydratedBlockIds.length,
      candidateCount: 0,
      startedAt: nowMs(),
    });
    scheduleSnapshotProjection({
      hydratedBlockIds: snapshot.hydratedBlockIds,
      visibleBlockIds: snapshot.visibleBlockIds,
      label,
      reason: { type: 'scheduled', label },
    });
  }

  const unsubscribeRenderWindow = options.renderVirtualizationEngine.subscribe((snapshot) => {
    const editor = options.getEditor();
    if (!shouldUseRootBlockShellForOwner(editor)) return;
    publishBridgePerf({
      reason: 'snapshot-notify',
      label: snapshot.reason,
      snapshotVersion: snapshot.version,
      virtualizationEnabled: snapshot.virtualizationEnabled,
      visibleCount: snapshot.visibleBlockIds.length,
      hydratedCount: snapshot.hydratedBlockIds.length,
      candidateCount: 0,
      startedAt: nowMs(),
    });
    scheduleSnapshotProjection({
      hydratedBlockIds: snapshot.hydratedBlockIds,
      visibleBlockIds: snapshot.visibleBlockIds,
      label: snapshot.reason,
      reason: snapshot.refreshReason,
    });
  });

  const initialEditor = options.getEditor();
  publishBridgePerf({
    reason: 'bridge-start',
    label: initialEditor?.eventBus ? 'event-bus-ready' : 'event-bus-missing',
    hydratedCount: options.renderVirtualizationEngine.getSnapshot().hydratedBlockIds.length,
    candidateCount: 0,
    startedAt: nowMs(),
  });

  // 中文说明：bridge 可能晚于文档 setContent / pending 注入完成后才安装。
  // 订阅只会收到未来 snapshot，因此启动时必须主动重放一次当前 hydrated window，
  // 否则需要用户滚轮/点击制造下一次 engine snapshot 才会投影 pending。
  refreshAndScheduleCurrentHydratedWindowProjection('shell-pending:bridge-start');

  const editor = options.getEditor();
  const onFileContentLoaded = (): void => {
    publishBridgePerf({
      reason: 'event-file-content-loaded',
      hydratedCount: options.renderVirtualizationEngine.getSnapshot().hydratedBlockIds.length,
      candidateCount: 0,
      startedAt: nowMs(),
    });
    // 中文说明：
    // file-content-loaded 本身处在文档注入的同步事件栈里。这里不能同步 refreshNow，
    // 因为 refreshNow 可能再次提交 PM plugin state 并触发 Vue/PM 的后续 flush；
    // 在 1500+ rootBlock 的 direct-state 路径里，这会把微任务队列卡在 setContent 返回后。
    // 交给虚拟化引擎下一帧 refresh，再通过 subscribe(snapshot) 投影当前窗口即可。
    options.renderVirtualizationEngine.scheduleRefresh({
      type: 'content-loaded',
      source: 'file',
    });
  };
  const onPendingRevisionsLoaded = (): void => {
    lastProjectedKey = '';
    lastProjectedAt = null;
    publishBridgePerf({
      reason: 'event-pending-revisions-loaded',
      hydratedCount: options.renderVirtualizationEngine.getSnapshot().hydratedBlockIds.length,
      candidateCount: 0,
      startedAt: nowMs(),
    });
    options.renderVirtualizationEngine.scheduleRefresh({
      type: 'content-loaded',
      source: 'pending-revisions',
    });
  };

  editor?.eventBus?.on?.('file-content-loaded', onFileContentLoaded);
  editor?.eventBus?.on?.('pending-revisions-loaded', onPendingRevisionsLoaded);

  return () => {
    editor?.eventBus?.off?.('file-content-loaded', onFileContentLoaded);
    editor?.eventBus?.off?.('pending-revisions-loaded', onPendingRevisionsLoaded);
    unsubscribeRenderWindow();

    clearProjectionSchedule();
    latestHydratedBlockIds = [];
    latestVisibleBlockIds = [];
    latestFrameProjectionPreferred = false;
    projectionQueue.reset();
    lastProjectedKey = '';
    lastProjectedAt = null;

  };
}
