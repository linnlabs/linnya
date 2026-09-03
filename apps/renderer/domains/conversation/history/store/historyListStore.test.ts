import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, watch } from 'vue';

const fetchListMock = vi.hoisted(() => vi.fn());

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
    configurable: true,
  });
});

vi.mock('../services/historyApiService', () => ({
  historyApiService: {
    fetchList: fetchListMock,
  },
}));

import { useWorkspaceScopeStore } from '../../../../shared/stores/workspaceScopeStore';
import type { ConversationListResponse } from '../services/historyApiService';
import { useHistoryListStore } from './historyListStore';

describe('historyListStore scope loading', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fetchListMock.mockResolvedValue({
      conversations: [],
      hasMore: false,
      nextCursor: undefined,
    });
  });

  it('Linnya 助手 scope 加载无项目历史', async () => {
    const scopeStore = useWorkspaceScopeStore();
    const listStore = useHistoryListStore();
    scopeStore.startDraft({ kind: 'linnya-assistant' });

    await listStore.loadList(true);

    expect(fetchListMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: undefined,
    }));
  });

  it('项目 scope 加载对应项目历史', async () => {
    const scopeStore = useWorkspaceScopeStore();
    const listStore = useHistoryListStore();
    scopeStore.startDraft({ kind: 'project', projectId: 'project-1' });

    await listStore.loadList(true);

    expect(fetchListMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
    }));
  });

  it('按 scope 维护同一份历史数据源', () => {
    const listStore = useHistoryListStore();

    listStore.upsertConversation({
      conversation_id: 'assistant-1',
      title: '助手对话',
      created_at: 1,
      last_event_at: 1,
      event_count: 1,
      user_message_count: 1,
      project_id: null,
      is_pinned: false,
      selected_agent_id: null,
    });
    listStore.upsertConversation({
      conversation_id: 'project-1-conversation',
      title: '项目对话',
      created_at: 2,
      last_event_at: 2,
      event_count: 1,
      user_message_count: 1,
      project_id: 'project-1',
      is_pinned: false,
      selected_agent_id: null,
    });

    expect(listStore.getConversationsByScope({ kind: 'linnya-assistant' })).toHaveLength(1);
    expect(listStore.getConversationsByScope({ kind: 'project', projectId: 'project-1' })).toHaveLength(1);
  });

  it('置顶、重命名和删除会同步到所有入口读取的 scoped 数据', () => {
    const listStore = useHistoryListStore();
    const scope = { kind: 'linnya-assistant' as const };

    listStore.upsertConversation({
      conversation_id: 'conversation-1',
      title: '原标题',
      created_at: 1,
      last_event_at: 1,
      event_count: 1,
      user_message_count: 1,
      project_id: null,
      is_pinned: false,
      selected_agent_id: null,
    });

    listStore.updatePinnedState('conversation-1', true, 10);
    listStore.updateConversation('conversation-1', { title: '新标题' });

    expect(listStore.getConversationsByScope(scope)[0]).toMatchObject({
      conversation_id: 'conversation-1',
      title: '新标题',
      is_pinned: true,
      pinned_at: 10,
    });

    listStore.removeConversation('conversation-1');
    expect(listStore.getConversationsByScope(scope)).toHaveLength(0);
  });

  it('新建 scope 快照后的 loading 和列表变更应触发响应式更新', async () => {
    const listStore = useHistoryListStore();
    const scope = { kind: 'project' as const, projectId: 'project-reactive' };
    const observedStates: string[] = [];
    let resolveFetch: (value: ConversationListResponse) => void = () => {
      throw new Error('fetchList mock was not called');
    };

    fetchListMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const stop = watch(
      () => ({
        isLoading: listStore.isLoadingByScope(scope),
        count: listStore.getConversationsByScope(scope).length,
      }),
      (state) => {
        observedStates.push(`${state.isLoading}:${state.count}`);
      },
      { immediate: true },
    );

    const loadingPromise = listStore.loadScopeList(scope, {
      refresh: true,
      limit: 100,
      loadAll: true,
    });
    await nextTick();

    expect(observedStates).toContain('true:0');
    resolveFetch({
      conversations: [{
        conversation_id: 'project-conversation-1',
        title: '项目对话',
        created_at: 1,
        last_event_at: 1,
        event_count: 1,
        user_message_count: 1,
        project_id: 'project-reactive',
        is_pinned: false,
        selected_agent_id: null,
      }],
      hasMore: false,
    });

    await loadingPromise;
    await nextTick();

    expect(observedStates).toContain('false:1');
    stop();
  });

  it('加载失败时只保存稳定错误状态，不保存后端自然语言错误', async () => {
    const listStore = useHistoryListStore();
    const scope = { kind: 'linnya-assistant' as const };

    fetchListMock.mockRejectedValueOnce(new Error('Backend natural-language failure'));

    await listStore.loadScopeList(scope, {
      refresh: true,
      limit: 100,
      loadAll: true,
    });

    expect(listStore.errorByScope(scope)).toBe('load_failed');
    expect(listStore.errorByScope(scope)).not.toBe('Backend natural-language failure');
  });
});
