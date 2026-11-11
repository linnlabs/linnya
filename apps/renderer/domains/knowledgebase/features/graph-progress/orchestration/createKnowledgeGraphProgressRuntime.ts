import { knowledgeBaseService } from '../../../services/knowledgeBaseService';
import type { useKnowledgeGraphProgressStore } from '../../../stores/knowledgeGraphProgressStore';
import type { KbGraphProgress } from '../definitions/kbGraphProgress';
import { coerceKbGraphProgress } from '../functions/coerceKbGraphProgress';

export function createKnowledgeGraphProgressRuntime(store: ReturnType<typeof useKnowledgeGraphProgressStore>) {
  const lastFetchedAtMsByKbId = new Map<string, number>();
  let isSubscribed = false;
  let unsubscribe: (() => void) | null = null;

  function ensureSubscribed(): void {
    if (isSubscribed) return;
    unsubscribe = knowledgeBaseService.onKbGraphProgressUpdated(payload => {
      const progress = coerceKbGraphProgress(payload);
      if (progress) store.setProgress(progress);
    });
    isSubscribed = true;
  }

  async function fetchKbProgress(kbId: string): Promise<KbGraphProgress | null> {
    const id = typeof kbId === 'string' ? kbId.trim() : '';
    if (!id) return null;
    const progress = coerceKbGraphProgress(await knowledgeBaseService.getKbGraphProgress(id));
    if (!progress) return null;
    store.setProgress(progress);
    lastFetchedAtMsByKbId.set(progress.kbId, Date.now());
    return progress;
  }

  /** 列表和详情共用同一预取窗口；单次手动刷新仍可直接请求最新事实。 */
  async function prefetchForKbIds(kbIds: string[]): Promise<void> {
    if (!Array.isArray(kbIds) || kbIds.length === 0) return;
    const now = Date.now();
    const unique = [...new Set(kbIds.map(id => typeof id === 'string' ? id.trim() : '').filter(Boolean))];
    for (const id of unique) {
      if (now - (lastFetchedAtMsByKbId.get(id) ?? 0) < 30_000) continue;
      await fetchKbProgress(id);
    }
  }

  function cleanup(): void {
    unsubscribe?.();
    unsubscribe = null;
    isSubscribed = false;
  }
  return {
    get progressByKbId() { return store.progressByKbId; },
    get percentByKbId() { return store.percentByKbId; },
    getProgress: store.getProgress,
    ensureSubscribed, fetchKbProgress, prefetchForKbIds, cleanup,
  };
}
