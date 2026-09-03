import { defineStore } from 'pinia';
import { markRaw } from 'vue';
import type {
  MessageWindowLoadMode,
  MessageWindowSnapshot,
  MessageWindowState,
  StoredWindowMessageRow,
  WindowMessageRow,
} from '../definitions/messageWindow';
import { WINDOW_MAX_ROWS } from '../definitions/messageWindow';
import type { BaseMessage } from '../../types';
import { cloneConversationMessage } from '../../functions/cloneConversationMessage';
import {
  isConversationPerfEnabled,
  publishConversationPerf,
  readConversationPerfNowMs,
} from '../../shared/observability/conversationPerf';

function cloneRows(rows: readonly WindowMessageRow[]): StoredWindowMessageRow[] {
  return rows.map(row => markRaw({
    ...row,
    message: cloneConversationMessage(row.message),
  }));
}

function mergeRows(
  existing: readonly WindowMessageRow[],
  incoming: readonly WindowMessageRow[],
): StoredWindowMessageRow[] {
  const byId = new Map<string, StoredWindowMessageRow>();
  for (const row of existing) {
    byId.set(row.messageId, markRaw(row));
  }
  for (const row of incoming) {
    byId.set(row.messageId, markRaw(row));
  }
  return [...byId.values()].sort((left, right) => left.sortSeq - right.sortSeq);
}

function readFirstSortSeq(rows: readonly WindowMessageRow[]): number | undefined {
  return rows[0]?.sortSeq;
}

function readLastSortSeq(rows: readonly WindowMessageRow[]): number | undefined {
  return rows[rows.length - 1]?.sortSeq;
}

function cloneRetainedTargetRow(
  row: WindowMessageRow,
  options: { readonly content?: string; readonly replacement?: BaseMessage },
): StoredWindowMessageRow {
  const replacement = options.replacement;
  const content = replacement?.content ?? options.content;
  return markRaw({
    ...row,
    dto: {
      ...row.dto,
      ...(content === undefined ? {} : { content }),
      ...(replacement
        ? {
            timestamp: replacement.timestamp,
            attachments: replacement.attachments ? [...replacement.attachments] : undefined,
          }
        : {}),
    },
    message: replacement
      ? cloneConversationMessage(replacement)
      : cloneConversationMessageWithContent(row.message, content ?? row.message.content),
  });
}

function cloneConversationMessageWithContent(message: BaseMessage, content: string): BaseMessage {
  const cloned = cloneConversationMessage(message);
  cloned.content = content;
  return cloned;
}

function assertWindowConversationOwnership(
  currentConversationId: string | null,
  incomingConversationId: string,
  operation: string,
): void {
  if (currentConversationId === null || currentConversationId === incomingConversationId) return;
  throw new Error(
    `[MessageWindowStore] ${operation} rejected snapshot for ${incomingConversationId}; current conversation is ${currentConversationId}`,
  );
}

function publishWindowPrependMergePerf(details: {
  readonly beforeCount: number;
  readonly incomingCount: number;
  readonly afterCount: number;
  readonly trimmedCount: number;
  readonly startedAt: number;
  readonly conversationId: string;
}): void {
  if (!isConversationPerfEnabled()) return;

  publishConversationPerf({
    kind: 'window-prepend',
    phase: 'store-merge',
    conversationId: details.conversationId,
    durationMs: readConversationPerfNowMs() - details.startedAt,
    details: {
      beforeCount: details.beforeCount,
      incomingCount: details.incomingCount,
      afterCount: details.afterCount,
      trimmedCount: details.trimmedCount,
    },
  });
}

export const useMessageWindowStore = defineStore('messageWindow', {
  state: (): MessageWindowState => ({
    conversationId: null,
    status: 'idle',
    rows: [],
    hasMoreBefore: false,
    hasMoreAfter: false,
    prevCursor: undefined,
    nextCursor: undefined,
    revision: null,
    loadingMode: null,
    error: null,
  }),

  getters: {
    isReady: state => state.status === 'ready',
    isPreparing: state => state.status === 'preparing',
    isLoading: state => state.status === 'loading',
    isInitialWindowLoading: state => (
      state.status === 'loading' && state.loadingMode === 'tail'
    ),
    isBackgroundPaging: state => (
      state.status === 'loading' && (state.loadingMode === 'before' || state.loadingMode === 'after')
    ),
    isNavigationLoading: state => (
      state.status === 'loading' && state.loadingMode === 'around'
    ),
  },

  actions: {
    startLoading(conversationId: string, mode: MessageWindowLoadMode): void {
      if (this.conversationId !== null && this.conversationId !== conversationId) {
        this.rows = [];
        this.hasMoreBefore = false;
        this.hasMoreAfter = false;
        this.prevCursor = undefined;
        this.nextCursor = undefined;
        this.revision = null;
      }
      this.conversationId = conversationId;
      this.status = 'loading';
      this.loadingMode = mode;
      this.error = null;
    },

    setPreparing(conversationId: string): void {
      assertWindowConversationOwnership(this.conversationId, conversationId, 'setPreparing');
      this.conversationId = conversationId;
      this.status = 'preparing';
      this.loadingMode = null;
      this.error = null;
      this.rows = [];
      this.hasMoreBefore = false;
      this.hasMoreAfter = false;
      this.prevCursor = undefined;
      this.nextCursor = undefined;
      this.revision = null;
    },

    replaceWithSnapshot(snapshot: MessageWindowSnapshot): void {
      assertWindowConversationOwnership(this.conversationId, snapshot.conversationId, 'replaceWithSnapshot');
      const rows = cloneRows(snapshot.rows).slice(-WINDOW_MAX_ROWS);
      this.conversationId = snapshot.conversationId;
      this.status = 'ready';
      this.loadingMode = null;
      this.error = null;
      this.rows = rows;
      this.hasMoreBefore = snapshot.hasMoreBefore || snapshot.rows.length > WINDOW_MAX_ROWS;
      this.hasMoreAfter = snapshot.hasMoreAfter;
      this.prevCursor = this.hasMoreBefore ? readFirstSortSeq(rows) : snapshot.prevCursor;
      this.nextCursor = this.hasMoreAfter ? readLastSortSeq(rows) : snapshot.nextCursor;
      this.revision = snapshot.revision;
    },

    prependSnapshot(snapshot: MessageWindowSnapshot): void {
      assertWindowConversationOwnership(this.conversationId, snapshot.conversationId, 'prependSnapshot');
      const startedAt = readConversationPerfNowMs();
      const beforeCount = this.rows.length;
      const mergedRows = mergeRows(snapshot.rows, this.rows);
      const trimmedCount = Math.max(mergedRows.length - WINDOW_MAX_ROWS, 0);
      const rows = trimmedCount > 0 ? mergedRows.slice(0, WINDOW_MAX_ROWS) : mergedRows;

      this.conversationId = snapshot.conversationId;
      this.status = 'ready';
      this.loadingMode = null;
      this.error = null;
      this.rows = rows;
      this.hasMoreBefore = snapshot.hasMoreBefore;
      this.hasMoreAfter = this.hasMoreAfter || snapshot.hasMoreAfter || trimmedCount > 0;
      this.prevCursor = this.hasMoreBefore ? readFirstSortSeq(rows) : snapshot.prevCursor;
      this.nextCursor = this.hasMoreAfter ? readLastSortSeq(rows) : snapshot.nextCursor;
      this.revision = snapshot.revision;
      publishWindowPrependMergePerf({
        beforeCount,
        incomingCount: snapshot.rows.length,
        afterCount: rows.length,
        trimmedCount,
        startedAt,
        conversationId: snapshot.conversationId,
      });
    },

    appendSnapshot(snapshot: MessageWindowSnapshot): void {
      assertWindowConversationOwnership(this.conversationId, snapshot.conversationId, 'appendSnapshot');
      const mergedRows = mergeRows(this.rows, snapshot.rows);
      const trimmedCount = Math.max(mergedRows.length - WINDOW_MAX_ROWS, 0);
      const rows = trimmedCount > 0 ? mergedRows.slice(trimmedCount) : mergedRows;

      this.conversationId = snapshot.conversationId;
      this.status = 'ready';
      this.loadingMode = null;
      this.error = null;
      this.rows = rows;
      this.hasMoreBefore = this.hasMoreBefore || snapshot.hasMoreBefore || trimmedCount > 0;
      this.hasMoreAfter = snapshot.hasMoreAfter;
      this.prevCursor = this.hasMoreBefore ? readFirstSortSeq(rows) : snapshot.prevCursor;
      this.nextCursor = this.hasMoreAfter ? readLastSortSeq(rows) : snapshot.nextCursor;
      this.revision = snapshot.revision;
    },

    truncateAfterMessage(
      messageId: string,
      options: { readonly content?: string; readonly replacement?: BaseMessage } = {},
    ): void {
      const targetIndex = this.rows.findIndex(row => row.messageId === messageId);
      if (targetIndex < 0) return;

      const targetRow = this.rows[targetIndex];
      const rows = [
        ...this.rows.slice(0, targetIndex),
        cloneRetainedTargetRow(targetRow, options),
      ];
      this.rows = rows;
      /**
       * 前端可见消息语义必须保留被编辑的用户消息，只截断它之后的旧回答。
       * 后端事件可以 inclusive truncate 旧 user_input，但新的 user_input 不会经 SSE 回流补进窗口；
       * 因此窗口在本地同步目标内容，revision 权威同步仍交给后续分页的 mismatch 重拉。
       */
      this.hasMoreAfter = false;
      this.nextCursor = undefined;
      this.prevCursor = this.hasMoreBefore
        ? readFirstSortSeq(rows)
        : undefined;
    },

    setError(conversationId: string, error: string): void {
      assertWindowConversationOwnership(this.conversationId, conversationId, 'setError');
      this.conversationId = conversationId;
      this.status = 'error';
      this.loadingMode = null;
      this.error = error;
    },

    clear(): void {
      this.conversationId = null;
      this.status = 'idle';
      this.rows = [];
      this.hasMoreBefore = false;
      this.hasMoreAfter = false;
      this.prevCursor = undefined;
      this.nextCursor = undefined;
      this.revision = null;
      this.loadingMode = null;
      this.error = null;
    },
  },
});
