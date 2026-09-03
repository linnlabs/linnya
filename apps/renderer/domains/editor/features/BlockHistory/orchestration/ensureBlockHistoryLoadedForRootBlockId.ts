import type { Ref } from 'vue';

export interface BlockHistoryLoadStore {
  versionsByBlock: Ref<Record<string, unknown>>;
  loadBlockHistory: (documentNodeId: string, blockId: string) => Promise<void>;
}

export type EnsureBlockHistoryLoadedFailureReason =
  | 'missing-document-node-id'
  | 'missing-block-id'
  | 'load-failed';

export type EnsureBlockHistoryLoadedResult =
  | { ok: true; action: 'already-known' | 'loaded' }
  | { ok: false; reason: EnsureBlockHistoryLoadedFailureReason; error?: unknown };

export interface EnsureBlockHistoryLoadedForRootBlockIdInput {
  documentNodeId: string | null | undefined;
  blockId: string | null | undefined;
  store?: BlockHistoryLoadStore;
}

function normalizeRequiredId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/**
 * 确保某个 rootBlock 的历史版本元数据已加载。
 *
 * 中文说明：
 * - 版本按钮的“是否显示”依赖版本摘要，但摘要本身不应该发起副作用；
 * - 所以加载动作放在 orchestration，Vue 组件只决定何时触发；
 * - 已知为空数组也算已加载，避免没有历史的块反复请求后端。
 */
export async function ensureBlockHistoryLoadedForRootBlockId(
  input: EnsureBlockHistoryLoadedForRootBlockIdInput
): Promise<EnsureBlockHistoryLoadedResult> {
  const documentNodeId = normalizeRequiredId(input.documentNodeId);
  if (!documentNodeId) return { ok: false, reason: 'missing-document-node-id' };

  const blockId = normalizeRequiredId(input.blockId);
  if (!blockId) return { ok: false, reason: 'missing-block-id' };

  const store = input.store ?? (await import('../store/useBlockHistoryStore')).useBlockHistoryStore();
  if (Object.prototype.hasOwnProperty.call(store.versionsByBlock.value, blockId)) {
    return { ok: true, action: 'already-known' };
  }

  try {
    await store.loadBlockHistory(documentNodeId, blockId);
    return { ok: true, action: 'loaded' };
  } catch (error) {
    return { ok: false, reason: 'load-failed', error };
  }
}
