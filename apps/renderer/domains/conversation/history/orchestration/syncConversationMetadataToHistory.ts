import { useHistoryListStore } from '../store/historyListStore';
import { historyApiService, type ConversationListItem } from '../services/historyApiService';
import type { WorkspaceScope } from '../../../../shared/stores/workspaceScopeStore';

export interface SyncConversationMetadataToHistoryOptions {
  initialDelayMs?: number;
  maxAttempts?: number;
  retryIntervalMs?: number;
  scope?: WorkspaceScope;
  minimumLastEventAt?: number;
  lastEventAtOverride?: number;
  optimisticTouch?: boolean;
  onSynced?: () => void;
  onFailed?: () => void;
}

function normalizeDelay(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeTimestamp(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function clampMetadataLastEventAt(
  metadata: ConversationListItem,
  minimumLastEventAt: number | undefined,
  lastEventAtOverride: number | undefined,
): ConversationListItem {
  if (lastEventAtOverride !== undefined) {
    return {
      ...metadata,
      last_event_at: lastEventAtOverride,
    };
  }

  if (minimumLastEventAt === undefined || metadata.last_event_at >= minimumLastEventAt) {
    return metadata;
  }

  return {
    ...metadata,
    last_event_at: minimumLastEventAt,
  };
}

function applyScopeToMetadata(
  metadata: ConversationListItem,
  scope: WorkspaceScope | undefined,
): ConversationListItem {
  if (!scope) return metadata;

  return {
    ...metadata,
    project_id: scope.kind === 'project' ? scope.projectId : null,
  };
}

export function touchConversationHistoryTimestamp(
  conversationId: string,
  lastEventAt: number = Date.now(),
): void {
  const safeConversationId = String(conversationId || '').trim();
  const safeLastEventAt = normalizeTimestamp(lastEventAt);
  if (!safeConversationId || safeLastEventAt === undefined) return;

  const listStore = useHistoryListStore();
  listStore.touchConversationTimestamp(safeConversationId, safeLastEventAt);
}

/**
 * 同步单个会话 metadata 到所有历史入口。
 *
 * 中文说明：
 * - 后端 conversations metadata 可能略晚于 SSE 结束写入，因此这里保留短重试；
 * - 用户继续旧对话时先做本地 touch，让侧边栏和下拉立刻重排；
 * - 成功后写入统一的 scoped history store，所有历史入口都从同一份数据派生；
 * - 排序依据统一下沉到各列表自己的排序函数，避免 UI 分叉。
 */
export function syncConversationMetadataToHistory(
  conversationId: string,
  options?: SyncConversationMetadataToHistoryOptions,
): void {
  const safeConversationId = String(conversationId || '').trim();
  if (!safeConversationId) return;

  const initialDelayMs = normalizeDelay(options?.initialDelayMs, 0);
  const maxAttempts = normalizePositiveInteger(options?.maxAttempts, 6);
  const retryIntervalMs = normalizePositiveInteger(options?.retryIntervalMs, 500);
  const minimumLastEventAt = normalizeTimestamp(options?.minimumLastEventAt);
  const lastEventAtOverride = normalizeTimestamp(options?.lastEventAtOverride);

  if (options?.optimisticTouch === true) {
    const optimisticLastEventAt = lastEventAtOverride ?? minimumLastEventAt;
    if (optimisticLastEventAt !== undefined) {
      touchConversationHistoryTimestamp(safeConversationId, optimisticLastEventAt);
    }
  }

  void (async () => {
    try {
      if (initialDelayMs > 0) {
        await sleep(initialDelayMs);
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const metadata: ConversationListItem | null = await historyApiService
          .fetchMetadata(safeConversationId)
          .catch(() => null);

        if (metadata) {
          const scopedMetadata = applyScopeToMetadata(metadata, options?.scope);
          const nextMetadata = clampMetadataLastEventAt(
            scopedMetadata,
            minimumLastEventAt,
            lastEventAtOverride,
          );
          const listStore = useHistoryListStore();
          listStore.upsertConversation(nextMetadata);

          const metadataIsFreshEnough = lastEventAtOverride !== undefined
            || minimumLastEventAt === undefined
            || metadata.last_event_at >= minimumLastEventAt;
          if (metadataIsFreshEnough || attempt === maxAttempts) {
            options?.onSynced?.();
            return;
          }
        }

        await sleep(retryIntervalMs);
      }
      options?.onFailed?.();
    } catch {
      // 历史 metadata 同步不能影响主对话流程；失败时等待下一次流结束或列表刷新修正。
      options?.onFailed?.();
    }
  })();
}
