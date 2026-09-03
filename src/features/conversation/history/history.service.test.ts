import { describe, expect, it } from 'vitest';
import type {
  IEventStore,
  ConversationListItem,
  ReadRuntimeEventsOptions,
  RunMetadata,
  RunSession,
} from '../../../app-hosts/linnya/adapters/persistence/event-store/event-store.interface';
import { HistoryRepository } from './history.repository';
import { HistoryService } from './history.service';
import type { RoutedRuntimeEvent, RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { encodeConversationListCursor } from '../../../app-hosts/linnya/adapters/persistence/event-store/conversation-list-cursor';
import { RUNTIME_EVENT_TYPES_NEVER_REPLAYED_TO_UI } from '@linnlabs/linnkit/runtime-kernel/events';
import { ConversationSelectedAgentIdSchema } from '@app/schemas';
import type { ConversationDeletionPort } from './definitions/conversationDeletionPort';
import type { ConversationCleanupStatusPort } from './definitions/conversationCleanupStatusPort';

class FakeEventStore implements IEventStore {
  public conversations: ConversationListItem[] = [];
  public lastListProjectId: string | undefined = 'not-called';
  public lastListOptions: { limit?: number; cursor?: string; search?: string; projectId?: string } | undefined;
  public lastReadEventsOptions: ReadRuntimeEventsOptions | undefined;
  public lastPinnedUpdate: { conversationId: string; pinned: boolean; pinnedAt: number | null } | undefined;
  public lastSelectedAgentUpdate: {
    conversationId: string;
    selectedAgentId: ConversationListItem['selected_agent_id'];
    projectId: string | null;
  } | undefined;

  async beginRunSession(_conversationId: string, _runId: string, _metadata: RunMetadata): Promise<RunSession> {
    throw new Error('not implemented');
  }

  async openRunSession(_conversationId: string, _runId: string): Promise<RunSession> {
    throw new Error('not implemented');
  }

  async appendEventToRun(_session: RunSession, _event: RuntimeEvent): Promise<void> {
    throw new Error('not implemented');
  }

  async replaceUserInputEvent(): Promise<{ deletedEventCount: number; deletedRunCount: number }> {
    throw new Error('not implemented');
  }

  async completeRun(_session: RunSession): Promise<void> {
    throw new Error('not implemented');
  }

  async failRun(_session: RunSession, _error: { code: string; message: string }): Promise<void> {
    throw new Error('not implemented');
  }

  async ensureConversation(_conversationId: string, _initialEvents: RuntimeEvent[], _projectId?: string): Promise<void> {
    throw new Error('not implemented');
  }

  async readEvents(
    _conversationId: string,
    options?: ReadRuntimeEventsOptions,
  ): Promise<{ events: RoutedRuntimeEvent[]; nextCursor?: number; hasMore: boolean }> {
    this.lastReadEventsOptions = options;
    return {
      events: [],
      hasMore: false,
    };
  }

  async listConversations(
    options?: { limit?: number; cursor?: string; search?: string; projectId?: string },
  ): Promise<{ conversations: ConversationListItem[]; nextCursor?: string; hasMore: boolean }> {
    this.lastListOptions = options;
    this.lastListProjectId = options?.projectId;
    return {
      conversations: this.conversations,
      hasMore: false,
    };
  }

  async deleteConversationsWithoutProject(): Promise<number> {
    throw new Error('not implemented');
  }

  async getConversationMetadata(_conversationId: string): Promise<ConversationListItem | null> {
    throw new Error('not implemented');
  }

  async updateTitle(_conversationId: string, _title: string): Promise<boolean> {
    throw new Error('not implemented');
  }

  async updatePinned(conversationId: string, pinned: boolean, pinnedAt: number | null): Promise<boolean> {
    this.lastPinnedUpdate = { conversationId, pinned, pinnedAt };
    return conversationId !== 'missing';
  }

  async updateSelectedAgent(
    conversationId: string,
    selectedAgentId: ConversationListItem['selected_agent_id'],
    projectId: string | null,
  ): Promise<boolean> {
    this.lastSelectedAgentUpdate = { conversationId, selectedAgentId, projectId };
    return true;
  }

  async deleteConversation(_conversationId: string): Promise<boolean> {
    throw new Error('not implemented');
  }

  async truncateFromEvent(_conversationId: string, _eventId: string): Promise<{ found: boolean; deletedEventCount: number; deletedRunCount: number }> {
    throw new Error('not implemented');
  }

  close(): void {
    // noop
  }
}

function createHistoryService(
  eventStore: IEventStore,
  deletion: ConversationDeletionPort = {
    async requestDeletion(): Promise<boolean> {
      throw new Error('deletion not expected in this test');
    },
  },
  cleanupStatus: ConversationCleanupStatusPort = {
    async readPendingConversationIds(): Promise<ReadonlySet<string>> {
      return new Set();
    },
    async retryPending() {
      throw new Error('cleanup retry not expected in this test');
    },
  },
): HistoryService {
  return new HistoryService(new HistoryRepository(eventStore), deletion, cleanupStatus);
}

describe('HistoryService.listConversations', () => {
  it('不传 projectId 时查询 Linnya 助手无项目历史', async () => {
    const eventStore = new FakeEventStore();
    const service = createHistoryService(eventStore);

    const result = await service.listConversations({ limit: 30 });

    expect(result.conversations).toEqual([]);
    expect(eventStore.lastListProjectId).toBeUndefined();
  });

  it('把持久 cleanup barrier 投影到对应列表项', async () => {
    const eventStore = new FakeEventStore();
    eventStore.conversations = [{
      conversation_id: 'conversation-cleanup-pending',
      title: '待清理对话',
      created_at: 1,
      last_event_at: 2,
      total_events: 3,
      user_message_count: 1,
      project_id: null,
      is_pinned: false,
      selected_agent_id: null,
    }];
    const service = createHistoryService(eventStore, undefined, {
      async readPendingConversationIds() {
        return new Set(['conversation-cleanup-pending']);
      },
      async retryPending() {
        return 'work_directory_cleared';
      },
    });

    await expect(service.listConversations({ limit: 30 })).resolves.toMatchObject({
      conversations: [{
        conversation_id: 'conversation-cleanup-pending',
        cleanup_pending: true,
      }],
    });
  });

  it('传入空白 projectId 时也按 Linnya 助手 scope 处理', async () => {
    const eventStore = new FakeEventStore();
    const service = createHistoryService(eventStore);

    await service.listConversations({ projectId: '   ' });

    expect(eventStore.lastListProjectId).toBeUndefined();
  });

  it('把非法分页参数归一化到业务允许范围', async () => {
    const eventStore = new FakeEventStore();
    const service = createHistoryService(eventStore);

    await service.listConversations({
      limit: -1,
      cursor: 'not-a-valid-cursor',
      search: '  hello  ',
      projectId: ' project-1 ',
    });

    expect(eventStore.lastListOptions).toEqual({
      limit: 1,
      cursor: undefined,
      search: 'hello',
      projectId: 'project-1',
    });

    const validCursor = encodeConversationListCursor({
      sortCursor: 42,
      conversationId: 'conversation-42',
    });

    await service.listConversations({ limit: 999, cursor: validCursor });

    expect(eventStore.lastListOptions).toMatchObject({
      limit: 100,
      cursor: validCursor,
    });
  });
});

describe('HistoryService.readConversationEvents', () => {
  it('把非法事件分页参数归一化到业务允许范围', async () => {
    const eventStore = new FakeEventStore();
    const service = createHistoryService(eventStore);

    await service.readConversationEvents('conversation-1', {
      limit: -5,
      cursor: Number.POSITIVE_INFINITY,
    });

    expect(eventStore.lastReadEventsOptions).toEqual({
      limit: 1,
      cursor: undefined,
      direction: 'backward',
      excludeTypes: RUNTIME_EVENT_TYPES_NEVER_REPLAYED_TO_UI,
    });

    await service.readConversationEvents('conversation-1', {
      limit: 999,
      cursor: 99.9,
      direction: 'forward',
    });

    expect(eventStore.lastReadEventsOptions).toEqual({
      limit: 200,
      cursor: 99,
      direction: 'forward',
      excludeTypes: RUNTIME_EVENT_TYPES_NEVER_REPLAYED_TO_UI,
    });
  });
});

describe('HistoryService.updateConversationPinned', () => {
  it('置顶时写入置顶时间，取消置顶时清空置顶时间', async () => {
    const eventStore = new FakeEventStore();
    const service = createHistoryService(eventStore);

    const pinned = await service.updateConversationPinned('conversation-1', true);

    expect(pinned.success).toBe(true);
    expect(pinned.isPinned).toBe(true);
    expect(pinned.pinnedAt).toEqual(expect.any(Number));
    expect(eventStore.lastPinnedUpdate).toEqual({
      conversationId: 'conversation-1',
      pinned: true,
      pinnedAt: pinned.pinnedAt,
    });

    const unpinned = await service.updateConversationPinned('conversation-1', false);

    expect(unpinned).toEqual({
      success: true,
      isPinned: false,
    });
    expect(eventStore.lastPinnedUpdate).toEqual({
      conversationId: 'conversation-1',
      pinned: false,
      pinnedAt: null,
    });
  });
});

describe('HistoryService.updateConversationSelectedAgent', () => {
  it('按 conversation identity 写入或清空产品 Agent 身份', async () => {
    const eventStore = new FakeEventStore();
    const service = createHistoryService(eventStore);
    const selectedAgentId = ConversationSelectedAgentIdSchema.parse('plugin_agent_fixture');

    await expect(
      service.updateConversationSelectedAgent('conversation-1', selectedAgentId, null),
    ).resolves.toBe(true);
    expect(eventStore.lastSelectedAgentUpdate).toEqual({
      conversationId: 'conversation-1',
      selectedAgentId,
      projectId: null,
    });

    await expect(
      service.updateConversationSelectedAgent('conversation-1', null, 'project-1'),
    ).resolves.toBe(true);
    expect(eventStore.lastSelectedAgentUpdate).toEqual({
      conversationId: 'conversation-1',
      selectedAgentId: null,
      projectId: 'project-1',
    });
  });
});

describe('HistoryService.deleteConversation', () => {
  it('只委托给完整生命周期删除端口，并保留 not found 语义', async () => {
    const eventStore = new FakeEventStore();
    const requested: string[] = [];
    const service = createHistoryService(eventStore, {
      async requestDeletion(conversationId): Promise<boolean> {
        requested.push(conversationId);
        return conversationId !== 'missing';
      },
    });

    await expect(service.deleteConversation('conversation-1')).resolves.toBe(true);
    await expect(service.deleteConversation('missing')).resolves.toBe(false);
    expect(requested).toEqual(['conversation-1', 'missing']);
  });

  it('空身份不会进入删除工作流，工作流失败也不会被伪装成 not found', async () => {
    const eventStore = new FakeEventStore();
    let requestCount = 0;
    const deletionFailure = new Error('cleanup failed');
    const service = createHistoryService(eventStore, {
      async requestDeletion(): Promise<boolean> {
        requestCount += 1;
        throw deletionFailure;
      },
    });

    await expect(service.deleteConversation('   ')).rejects.toThrow('conversationId is required');
    expect(requestCount).toBe(0);
    await expect(service.deleteConversation('conversation-1')).rejects.toBe(deletionFailure);
  });
});
