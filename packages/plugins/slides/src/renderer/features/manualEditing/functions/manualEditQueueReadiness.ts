import type { ManualEditQueueSnapshot } from '../definitions/manualEditQueuePorts';

export function isManualEditSnapshotReady(snapshot: ManualEditQueueSnapshot): boolean {
  return canAdmitManualEdit(snapshot)
    && snapshot.buildState?.state === 'ready'
    && snapshot.renderVersion === snapshot.buildState.versionNumber;
}

/** 允许排队等待新 RenderModel；草稿态或已关闭的文档没有可写作者基线。 */
export function canAdmitManualEdit(snapshot: ManualEditQueueSnapshot): boolean {
  return snapshot.documentId !== null
    && snapshot.buildState?.state === 'ready'
    && snapshot.buildState.presentationId === snapshot.documentId;
}
