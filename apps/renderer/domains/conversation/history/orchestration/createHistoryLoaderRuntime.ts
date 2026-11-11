import type { useHistoryLoadingState } from '../store/historyLoaderStore';

import { useConversationProjectionActions } from '@/domains/conversation/projectionActions';
/**
 * @file apps/renderer/domains/conversation/history/store/historyLoaderStore.ts
 * @description 历史会话打开编排：只负责 loading 壳生命周期与窗口 tail 加载。
 */
import { useConversationState } from '../../store/conversationState';
import { useAssistantStore } from '../../store/assistantStore';
import { historyApiService, type ConversationMetadata } from '../services/historyApiService';
import { resolveHistoryLoadingShellRollbackAction } from '../functions/historyLoadingShellRollback';
import { createHistoryShellConversation } from '../functions/historyShellConversation';
import {
  publishHistoryLoadPerf,
  readConversationPerfNowMs,
  type HistoryLoadPerfDetails,
} from '../functions/historyLoadPerf';
import { buildConversationMetadataPatch } from '../functions/historyConversationMetadata';
import { loadHistoryWindowTail } from './historyWindowTailLoader';
import type {
  HistoryConversationSnapshot,
  HistoryConversationLoadInvalidationResult,
  HistoryConversationLoadResult,
  HistoryLoadingIntent,
  LoadConversationOptions,
  PreparedHistoryLoadingShell,
} from '../definitions/historyLoader';
import type { Conversation } from '../../types';
import { restoreInteractiveRun } from '../../features/interactive-run';

const HISTORY_WINDOW_TAIL_LIMIT = 80;

export function createHistoryLoaderRuntime(state: ReturnType<typeof useHistoryLoadingState>) {
  let requestToken = 0;
  let preparedLoadingShell: PreparedHistoryLoadingShell | null = null;
  const loadingShellRequestTokens = new Map<string, number>();
  const createRequestToken = () => ++requestToken;

  const clearLoadingShellOwnership = (conversationId: string, shellRequestToken: number): void => {
    if (loadingShellRequestTokens.get(conversationId) === shellRequestToken) {
      loadingShellRequestTokens.delete(conversationId);
    }
  };

  const upsertConversation = (conversation: Conversation): void => {
    const conversationState = useConversationState();
    const existingIndex = conversationState.conversations.findIndex(c => c.id === conversation.id);
    if (existingIndex >= 0) {
      conversationState.replaceConversationRecord(existingIndex, conversation);
      return;
    }
    conversationState.appendConversationRecord(conversation);
  };

  const rollbackPreparedLoadingShell = (preparedShell: PreparedHistoryLoadingShell): void => {
    const conversationState = useConversationState();
    useConversationProjectionActions().discardHistoryLoadingSseBuffer(
      preparedShell.conversationId,
      preparedShell.requestToken,
      'loading-shell-rollback'
    );
    const existingIndex = conversationState.conversations.findIndex(
      c => c.id === preparedShell.conversationId
    );
    const existingConversation =
      existingIndex >= 0 ? conversationState.conversations[existingIndex] : null;
    const action = resolveHistoryLoadingShellRollbackAction({
      shellRequestToken: preparedShell.requestToken,
      ownedShellRequestToken: loadingShellRequestTokens.get(preparedShell.conversationId) ?? null,
      hasExistingConversation: existingConversation !== null,
      hasFallbackConversation: preparedShell.fallbackConversation !== null,
    });

    if (action === 'skip-newer-same-conversation') return;

    if (action === 'ignore-missing-conversation') {
      clearLoadingShellOwnership(preparedShell.conversationId, preparedShell.requestToken);
      return;
    }

    if (action === 'ignore-unowned-conversation') {
      return;
    }

    if (action === 'restore-fallback' && preparedShell.fallbackConversation) {
      conversationState.replaceConversationRecord(
        existingIndex,
        preparedShell.fallbackConversation
      );
      clearLoadingShellOwnership(preparedShell.conversationId, preparedShell.requestToken);
      if (conversationState.historyLoadingConversationId === preparedShell.conversationId) {
        conversationState.setHistoryLoadingConversation(null);
      }
      return;
    }

    conversationState.removeConversationRecordAt(existingIndex);
    clearLoadingShellOwnership(preparedShell.conversationId, preparedShell.requestToken);
    if (conversationState.historyLoadingConversationId === preparedShell.conversationId) {
      conversationState.setHistoryLoadingConversation(null);
    }
  };

  const abortStaleLoad = (
    preparedShell: PreparedHistoryLoadingShell,
    phase: string,
    startedAt: number,
    details?: HistoryLoadPerfDetails
  ): void => {
    publishHistoryLoadPerf(preparedShell.conversationId, phase, startedAt, details);
    rollbackPreparedLoadingShell(preparedShell);
  };

  const isActiveConversationWindowReady = (conversationId: string): boolean => {
    const conversationState = useConversationState();
    return (
      conversationState.activeConversationId === conversationId &&
      state.loadedConversationId === conversationId
    );
  };

  const prepareHistoryLoadingShell = (
    conversationId: string,
    initialConversation: HistoryConversationSnapshot | null,
    shellRequestToken: number
  ): PreparedHistoryLoadingShell | null => {
    const assistantStore = useAssistantStore();
    const conversationState = useConversationState();

    if (isActiveConversationWindowReady(conversationId)) return null;

    const previousConversationId = conversationState.activeConversationId;
    state.patchLoadingState({ isLoading: true });
    state.patchLoadingState({ loadingConversationId: conversationId });
    loadingShellRequestTokens.set(conversationId, shellRequestToken);
    state.patchLoadingState({ error: null });

    /**
     * 历史入口需要先写 loading 壳再切 UI surface。
     * 原因：布局切换和窗口 tail 请求之间可能隔一帧，若 active conversation 为空，
     * 主对话面板会短暂命中“默认新对话”空态。
     */
    const fallbackConversation =
      conversationState.conversations.find(c => c.id === conversationId) ?? null;
    state.patchLoadingState({ loadedConversationId: null });
    /**
     * 侧栏切换只更换当前历史 window，不能释放 previous / target conversation 的
     * projection runtime。后台 run 仍会按 conversation_id 收到 SSE，而 chunk 聚合、thought
     * 和 tool 状态都依赖这份 runtime 连续存在。
     */
    useConversationProjectionActions().beginHistoryLoadingSseBuffer(conversationId, shellRequestToken);
    conversationState.setHistoryLoadingConversation(conversationId);

    const initialShellConversation = createHistoryShellConversation(
      conversationId,
      initialConversation,
      fallbackConversation
    );
    upsertConversation(initialShellConversation);
    assistantStore.setSelectedConversation(conversationId);
    conversationState.setActiveConversation(conversationId);

    return {
      conversationId,
      requestToken: shellRequestToken,
      previousConversationId,
      fallbackConversation,
    };
  };

  const beginConversationLoadingIntent = (
    conversationId: string,
    options: LoadConversationOptions = {}
  ): HistoryLoadingIntent | null => {
    if (isActiveConversationWindowReady(conversationId)) {
      return null;
    }

    if (preparedLoadingShell) {
      rollbackPreparedLoadingShell(preparedLoadingShell);
      preparedLoadingShell = null;
    }

    const currentToken = createRequestToken();
    const initialConversation = options.initialConversation ?? null;
    preparedLoadingShell = prepareHistoryLoadingShell(
      conversationId,
      initialConversation,
      currentToken
    );
    if (!preparedLoadingShell) return null;

    return {
      conversationId,
      requestToken: currentToken,
    };
  };

  const takePreparedHistoryLoadingShell = (
    conversationId: string,
    loadingIntent: HistoryLoadingIntent
  ): PreparedHistoryLoadingShell | null => {
    if (
      !preparedLoadingShell ||
      preparedLoadingShell.conversationId !== conversationId ||
      preparedLoadingShell.requestToken !== loadingIntent.requestToken ||
      preparedLoadingShell.requestToken !== requestToken ||
      loadingIntent.conversationId !== conversationId
    ) {
      return null;
    }

    const preparedShell = preparedLoadingShell;
    preparedLoadingShell = null;
    return preparedShell;
  };

  const loadConversation = async (
    conversationId: string,
    options: LoadConversationOptions = {}
  ): Promise<HistoryConversationLoadResult> => {
    const assistantStore = useAssistantStore();
    const conversationState = useConversationState();
    const initialConversation = options.initialConversation ?? null;
    const preparedShellFromNavigation = options.loadingIntent
      ? takePreparedHistoryLoadingShell(conversationId, options.loadingIntent)
      : null;
    if (!options.loadingIntent) {
      if (preparedLoadingShell) {
        rollbackPreparedLoadingShell(preparedLoadingShell);
      }
      preparedLoadingShell = null;
    }

    const loadStartedAt = readConversationPerfNowMs();
    if (isActiveConversationWindowReady(conversationId)) {
      publishHistoryLoadPerf(conversationId, 'skip-active-window-ready');
      return { status: 'committed', conversationId };
    }

    if (options.loadingIntent && !preparedShellFromNavigation) {
      publishHistoryLoadPerf(conversationId, 'abort-stale-loading-intent', loadStartedAt, {
        requestedToken: options.loadingIntent.requestToken,
        currentToken: requestToken,
      });
      return { status: 'stale', conversationId };
    }

    const currentToken = preparedShellFromNavigation?.requestToken ?? createRequestToken();
    publishHistoryLoadPerf(conversationId, 'start');

    const preparedShell =
      preparedShellFromNavigation ??
      prepareHistoryLoadingShell(conversationId, initialConversation, currentToken);
    if (!preparedShell) {
      publishHistoryLoadPerf(conversationId, 'skip-active-window-ready-after-start', loadStartedAt);
      return { status: 'committed', conversationId };
    }
    const { fallbackConversation } = preparedShell;

    try {
      const metadataStartedAt = readConversationPerfNowMs();
      const conversationMetadata: ConversationMetadata | null = await historyApiService
        .fetchMetadata(conversationId)
        .catch(() => null);
      publishHistoryLoadPerf(conversationId, 'metadata', metadataStartedAt, {
        found: conversationMetadata !== null,
      });
      if (currentToken !== requestToken) {
        abortStaleLoad(preparedShell, 'abort-after-metadata', loadStartedAt);
        return { status: 'stale', conversationId };
      }

      const resolvedConversationMetadata = conversationMetadata ?? initialConversation;
      const shellConversation = createHistoryShellConversation(
        conversationId,
        resolvedConversationMetadata,
        fallbackConversation
      );
      upsertConversation(shellConversation);
      conversationState.setActiveConversation(conversationId);

      const metadataPatch = buildConversationMetadataPatch(conversationMetadata);
      if (Object.keys(metadataPatch).length > 0) {
        useConversationProjectionActions().mergeConversationMetadata(conversationId, metadataPatch);
      }

      const tailStartedAt = readConversationPerfNowMs();
      const windowStatus = await loadHistoryWindowTail(conversationId, HISTORY_WINDOW_TAIL_LIMIT);
      publishHistoryLoadPerf(conversationId, 'tail-window', tailStartedAt, {
        status: windowStatus,
        limit: HISTORY_WINDOW_TAIL_LIMIT,
      });
      if (currentToken !== requestToken) {
        abortStaleLoad(preparedShell, 'abort-after-tail-window', loadStartedAt);
        return { status: 'stale', conversationId };
      }

      await restoreInteractiveRun(conversationId);
      if (currentToken !== requestToken) {
        abortStaleLoad(preparedShell, 'abort-after-run-restore', loadStartedAt);
        return { status: 'stale', conversationId };
      }

      assistantStore.setSelectedConversation(conversationId);
      conversationState.setActiveConversation(conversationId);

      if (windowStatus === 'ready') {
        const replayStatus = await useConversationProjectionActions().replayBufferedHistoryLoadingEvents(
          conversationId,
          currentToken,
          () => currentToken === requestToken
        );
        if (replayStatus === 'stale') {
          abortStaleLoad(preparedShell, 'abort-during-buffer-replay', loadStartedAt);
          return { status: 'stale', conversationId };
        }
        state.patchLoadingState({ loadedConversationId: conversationId });
      } else {
        useConversationProjectionActions().discardHistoryLoadingSseBuffer(
          conversationId,
          currentToken,
          'window-preparing'
        );
      }

      publishHistoryLoadPerf(
        conversationId,
        windowStatus === 'ready' ? 'complete' : 'preparing',
        loadStartedAt,
        {
          status: windowStatus,
        }
      );
      return { status: 'committed', conversationId };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'unknown_error';
      if (currentToken === requestToken) {
        useConversationProjectionActions().discardHistoryLoadingSseBuffer(
          conversationId,
          currentToken,
          'load-error'
        );
        state.patchLoadingState({ error: message });
        publishHistoryLoadPerf(conversationId, 'error', loadStartedAt, {
          errorMessage: message,
        });
        console.error('[HistoryLoader] Failed to load conversation history window:', caught);
        return { status: 'failed', conversationId, error: message };
      } else {
        console.warn('[HistoryLoader] Ignoring stale error:', message);
        return { status: 'stale', conversationId };
      }
    } finally {
      if (currentToken === requestToken) {
        state.patchLoadingState({ isLoading: false });
        state.patchLoadingState({ loadingConversationId: null });
        conversationState.setHistoryLoadingConversation(null);
      }
      clearLoadingShellOwnership(conversationId, currentToken);
      if (preparedLoadingShell?.requestToken === currentToken) {
        preparedLoadingShell = null;
      }
    }
  };

  const forgetConversation = (
    conversationId: string
  ): HistoryConversationLoadInvalidationResult => {
    const preparedShellRequestToken =
      preparedLoadingShell?.conversationId === conversationId
        ? preparedLoadingShell.requestToken
        : null;
    const ownsPreparedShell = preparedShellRequestToken !== null;
    const ownsActiveLoad = state.loadingConversationId === conversationId;
    const ownedRequestToken =
      preparedShellRequestToken !== null
        ? preparedShellRequestToken
        : ownsActiveLoad
          ? requestToken
          : null;

    /**
     * 只让被删除对话自己持有的加载世代失效。删除其它对话时不得递增 token，
     * 否则当前页面正在进行的 HistoryLoader 会被无关操作错误取消。
     */
    if (ownsPreparedShell || ownsActiveLoad) {
      createRequestToken();
    }

    if (ownsPreparedShell) {
      preparedLoadingShell = null;
    }

    loadingShellRequestTokens.delete(conversationId);
    if (state.loadedConversationId === conversationId) {
      state.patchLoadingState({ loadedConversationId: null });
    }
    if (ownsActiveLoad && ownedRequestToken !== null) {
      state.patchLoadingState({ isLoading: false });
      state.patchLoadingState({ loadingConversationId: null });
      state.patchLoadingState({ error: null });
    }
    return Object.freeze({
      bufferRequestToken: ownedRequestToken,
      ownsLoadingState: ownsPreparedShell || ownsActiveLoad,
    });
  };

  return {
    get isLoading() {
      return state.isLoading;
    },
    get loadingConversationId() {
      return state.loadingConversationId;
    },
    get error() {
      return state.error;
    },
    beginConversationLoadingIntent,
    loadConversation,
    forgetConversation,
  };
}
