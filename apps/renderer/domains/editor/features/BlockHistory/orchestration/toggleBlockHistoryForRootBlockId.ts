import {
  ensureBlockHistoryLoadedForRootBlockId,
  type BlockHistoryLoadStore,
  type EnsureBlockHistoryLoadedFailureReason,
} from './ensureBlockHistoryLoadedForRootBlockId';

export interface BlockHistoryVersionForToggle {
  id: string;
}

export interface BlockHistoryToggleStore extends BlockHistoryLoadStore {
  getVersions: (blockId: string) => readonly BlockHistoryVersionForToggle[];
  isInHistoryMode: (blockId: string) => boolean;
  exitHistoryMode: (blockId: string) => void;
  setViewMode: (blockId: string, mode: 'side-by-side') => void;
  selectVersion: (blockId: string, versionId: string) => void;
}

export type ToggleBlockHistoryFailureReason =
  | EnsureBlockHistoryLoadedFailureReason
  | 'no-history-versions'
  | 'open-failed';

export type ToggleBlockHistoryForRootBlockIdResult =
  | { ok: true; action: 'opened'; selectedVersionId: string }
  | { ok: true; action: 'closed' }
  | { ok: true; action: 'skipped'; reason: 'no-history-versions' }
  | { ok: false; reason: Exclude<ToggleBlockHistoryFailureReason, 'no-history-versions'>; error?: unknown };

export interface ToggleBlockHistoryForRootBlockIdInput {
  documentNodeId: string | null | undefined;
  blockId: string | null | undefined;
  store?: BlockHistoryToggleStore;
}

function normalizeRequiredId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/**
 * 执行版本按钮点击语义：如果已在历史模式则关闭，否则加载版本并进入 side-by-side。
 *
 * 中文说明：
 * - 这是 BlockHistory feature 的用户动作编排；
 * - UI 层只传 `documentNodeId + blockId`，不再需要 editor / node / getPos；
 * - Host left-handle 和旧 BlockChrome 版本按钮必须复用这里，避免两套历史入口语义分叉。
 */
export async function toggleBlockHistoryForRootBlockId(
  input: ToggleBlockHistoryForRootBlockIdInput
): Promise<ToggleBlockHistoryForRootBlockIdResult> {
  const documentNodeId = normalizeRequiredId(input.documentNodeId);
  if (!documentNodeId) return { ok: false, reason: 'missing-document-node-id' };

  const blockId = normalizeRequiredId(input.blockId);
  if (!blockId) return { ok: false, reason: 'missing-block-id' };

  const store = input.store ?? (await import('../store/useBlockHistoryStore')).useBlockHistoryStore();
  if (store.isInHistoryMode(blockId)) {
    store.exitHistoryMode(blockId);
    return { ok: true, action: 'closed' };
  }

  const loadResult = await ensureBlockHistoryLoadedForRootBlockId({
    documentNodeId,
    blockId,
    store,
  });
  if (!loadResult.ok) {
    return {
      ok: false,
      reason: loadResult.reason,
      error: loadResult.error,
    };
  }

  const versions = store.getVersions(blockId);
  const latestVersion = versions[0];
  if (!latestVersion) {
    return { ok: true, action: 'skipped', reason: 'no-history-versions' };
  }

  try {
    store.setViewMode(blockId, 'side-by-side');
    store.selectVersion(blockId, latestVersion.id);
    return {
      ok: true,
      action: 'opened',
      selectedVersionId: latestVersion.id,
    };
  } catch (error) {
    return { ok: false, reason: 'open-failed', error };
  }
}
