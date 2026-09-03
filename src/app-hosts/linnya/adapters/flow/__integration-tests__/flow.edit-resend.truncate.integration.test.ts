import { describe, expect, it, vi } from 'vitest';
import type { ConversationNextRequest } from '@app/schemas';
import { FlowOrchestrator } from 'src/app-hosts/linnya/adapters/flow/flow.orchestrator';
import { FlowIncomingEventPreparer } from 'src/app-hosts/linnya/adapters/flow/incoming-events/orchestration/prepareFlowIncomingEventBatch';
import {
  createFlowHistoryAccessPort,
  HistoryHandlerService,
} from 'src/app-hosts/linnya/adapters/flow/flow.history-handler.service';
import {
  createConversationPersistencePort,
  EventPersistenceCoordinator,
} from 'src/app-hosts/linnya/adapters/flow/flow.persistence';
import { createDirectFlowConversationAdmissionPort } from 'src/app-hosts/linnya/adapters/flow/__test-helpers__/createDirectFlowConversationAdmissionPort';
import { HistoryRepository } from 'src/features/conversation/history/history.repository';
import type {
  ConversationListItem,
  IEventStore,
  ReadRuntimeEventsOptions,
  RunMetadata,
  RunSession,
} from 'src/app-hosts/linnya/adapters/persistence/event-store/event-store.interface';
import {
  createUserInputEvent,
  routeRuntimeEvent,
  type RoutedRuntimeEvent,
  type RuntimeEvent,
  type RuntimeResourceRef,
} from '@linnlabs/linnkit/contracts';
import { graph, runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import type { FlowRuntimePort } from 'src/app-hosts/linnya/adapters/flow/flow.runtime';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { LinnyaRunCostCollector } from 'src/app-hosts/linnya/adapters/token-accounting';

type PersistOnlyRequestParams = {
  conversationId: string;
  messageId: string;
  content: string;
} & (
  | {
      truncateFromMessageId: string;
      truncateReason: 'edit' | 'regenerate';
    }
  | {
      truncateFromMessageId?: never;
      truncateReason?: never;
    }
);

let persistOnlyRequestSequence = 0;

function createPersistOnlyRuntimePersistence(): FlowRuntimePort {
  return {
    supervisor: new runSupervisor.DefaultRunSupervisor<AgentInvokeRequest>({
      registryStore: new runSupervisor.MemoryRunRegistryStore(),
    }),
    costCollector: new LinnyaRunCostCollector(),
    eventStore: new graph.MemoryEventStore(),
    nextEventStoreId: graph.createMonotonicEventStoreIdFactory(),
  };
}

function createPersistOnlyRequest(params: PersistOnlyRequestParams): ConversationNextRequest {
  persistOnlyRequestSequence += 1;
  return {
    conversation_id: params.conversationId,
    new_events: [
      {
        type: 'user_input',
        id: params.messageId,
        content: params.content,
        timestamp: Date.now(),
        source: 'user',
        turn_id: `turn_${params.messageId}_${persistOnlyRequestSequence}`,
        ...(params.truncateFromMessageId
          ? { attachment_selection: { mode: 'preserve' as const } }
          : {}),
      },
    ],
    options: {
      persist_only: true,
      ...(params.truncateFromMessageId
        ? {
            truncateFromMessageId: params.truncateFromMessageId,
            truncateReason: params.truncateReason,
          }
        : {}),
    },
  };
}

class UniqueIdEventStore implements IEventStore {
  private readonly eventsByConversation = new Map<string, RoutedRuntimeEvent[]>();
  private readonly eventIds = new Set<string>();
  private readonly runSessions = new Map<string, RunSession>();
  replaceCallCount = 0;
  truncateCallCount = 0;

  seedEvent(event: RuntimeEvent): void {
    const existing = this.eventsByConversation.get(event.conversation_id) ?? [];
    const routed = routeRuntimeEvent(event, {
      run_id: event.turn_id,
      lane: 'foreground',
      visibility: 'conversation',
    });
    this.eventsByConversation.set(event.conversation_id, [...existing, routed]);
    this.eventIds.add(event.id);
  }

  async beginRunSession(conversationId: string, runId: string, _metadata: RunMetadata): Promise<RunSession> {
    await this.ensureConversation(conversationId, []);
    const session = {
      runId,
      conversationId,
      startedAt: Date.now(),
    };
    this.runSessions.set(runId, session);
    return session;
  }

  async openRunSession(conversationId: string, runId: string): Promise<RunSession> {
    let session = this.runSessions.get(runId);
    if (!session) {
      session = { runId, conversationId, startedAt: Date.now() };
      this.runSessions.set(runId, session);
    }
    if (session.conversationId !== conversationId) {
      throw new Error(`run ${runId} belongs to ${session.conversationId}`);
    }
    return session;
  }

  async appendEventToRun(session: RunSession, event: RoutedRuntimeEvent): Promise<void> {
    if (this.eventIds.has(event.id)) {
      throw new Error('UNIQUE constraint failed: events.id');
    }

    const existing = this.eventsByConversation.get(session.conversationId) ?? [];
    this.eventsByConversation.set(session.conversationId, [...existing, event]);
    this.eventIds.add(event.id);
  }

  async replaceUserInputEvent(
    session: RunSession,
    targetEventId: string,
    replacement: RoutedRuntimeEvent,
  ): Promise<{ deletedEventCount: number; deletedRunCount: number }> {
    this.replaceCallCount += 1;
    const existing = this.eventsByConversation.get(session.conversationId) ?? [];
    const targetIndex = existing.findIndex(event => event.id === targetEventId && event.type === 'user_input');
    if (targetIndex < 0 || replacement.type !== 'user_input' || replacement.id !== targetEventId) {
      throw new Error('invalid user-input replacement');
    }
    const removed = existing.slice(targetIndex);
    for (const event of removed) {
      this.eventIds.delete(event.id);
    }
    this.eventsByConversation.set(session.conversationId, [
      ...existing.slice(0, targetIndex),
      replacement,
    ]);
    this.eventIds.add(replacement.id);
    return { deletedEventCount: removed.length, deletedRunCount: 0 };
  }

  async completeRun(_session: RunSession): Promise<void> {
    // noop for this integration-test fake
  }

  async failRun(_session: RunSession, _error: { code: string; message: string }): Promise<void> {
    // noop for this integration-test fake
  }

  async ensureConversation(
    conversationId: string,
    _initialEvents: RuntimeEvent[],
    _projectId?: string,
    _mode?: string,
  ): Promise<void> {
    if (!this.eventsByConversation.has(conversationId)) {
      this.eventsByConversation.set(conversationId, []);
    }
  }

  async readEvents(
    conversationId: string,
    options?: ReadRuntimeEventsOptions,
  ): Promise<{ events: RoutedRuntimeEvent[]; nextCursor?: number; hasMore: boolean }> {
    const excluded = new Set(options?.excludeTypes ?? []);
    const allEvents = (this.eventsByConversation.get(conversationId) ?? [])
      .filter(event => !excluded.has(event.type));
    const cursor = typeof options?.cursor === 'number' ? options.cursor : 0;
    const limit = typeof options?.limit === 'number' ? options.limit : allEvents.length;
    const page = allEvents.slice(cursor, cursor + limit);
    const nextCursor = cursor + page.length;
    return {
      events: page,
      nextCursor: nextCursor < allEvents.length ? nextCursor : undefined,
      hasMore: nextCursor < allEvents.length,
    };
  }

  async listConversations(
    _options?: { limit?: number; cursor?: string; search?: string; projectId?: string },
  ): Promise<{ conversations: ConversationListItem[]; nextCursor?: string; hasMore: boolean }> {
    return { conversations: [], hasMore: false };
  }

  async deleteConversationsWithoutProject(): Promise<number> {
    return 0;
  }

  async getConversationMetadata(_conversationId: string): Promise<ConversationListItem | null> {
    return null;
  }

  async updateTitle(_conversationId: string, _title: string): Promise<boolean> {
    return true;
  }

  async updatePinned(_conversationId: string, _pinned: boolean, _pinnedAt: number | null): Promise<boolean> {
    return true;
  }

  async updateSelectedAgent(
    _conversationId: string,
    _selectedAgentId: ConversationListItem['selected_agent_id'],
    _projectId: string | null,
  ): Promise<boolean> {
    return true;
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    const deletedEvents = this.eventsByConversation.get(conversationId) ?? [];
    for (const event of deletedEvents) {
      this.eventIds.delete(event.id);
    }
    return this.eventsByConversation.delete(conversationId);
  }

  async truncateFromEvent(conversationId: string, eventId: string): Promise<{ found: boolean; deletedEventCount: number; deletedRunCount: number }> {
    this.truncateCallCount += 1;
    const events = this.eventsByConversation.get(conversationId) ?? [];
    const targetIndex = events.findIndex((event) => event.id === eventId);
    if (targetIndex < 0) {
      return { found: false, deletedEventCount: 0, deletedRunCount: 0 };
    }

    const removed = events.slice(targetIndex);
    this.eventsByConversation.set(conversationId, events.slice(0, targetIndex));
    for (const event of removed) {
      this.eventIds.delete(event.id);
    }

    return {
      found: true,
      deletedEventCount: removed.length,
      deletedRunCount: 0,
    };
  }

  close(): void {
    this.eventsByConversation.clear();
    this.eventIds.clear();
  }
}

describe('Flow edit resend truncate regression', () => {
  const attachment: RuntimeResourceRef = {
    id: 'attachment-edit-regenerate',
    kind: 'image',
    resourceId: 'asset-edit-regenerate',
    mediaType: 'image/png',
    byteLength: 128,
    width: 16,
    height: 8,
    sha256: 'e'.repeat(64),
    fileName: 'original.png',
  };
  it.each([
    {
      action: 'edit' as const,
      replacementContent: '这是修改后的消息。',
    },
    {
      action: 'regenerate' as const,
      replacementContent: '这是原始消息。',
    },
  ])('在一个 replace 操作中以同一 event id 持久化 $action 聚合', async ({
    action,
    replacementContent,
  }) => {
    const eventStore = new UniqueIdEventStore();
    const historyRepository = new HistoryRepository(eventStore);
    const historyHandler = new HistoryHandlerService(
      createFlowHistoryAccessPort(historyRepository),
    );
    const persistenceCoordinator = new EventPersistenceCoordinator({
      persistencePort: createConversationPersistencePort(historyRepository),
      conversationAdmission: createDirectFlowConversationAdmissionPort(historyRepository),
    });
    const unusedAgentRunner = {
      run(): never {
        throw new Error('persist_only regression test should not dispatch AgentRunner');
      },
      discardCheckpoint: vi.fn(async () => undefined),
    };
    const orchestrator = new FlowOrchestrator(
      historyHandler,
      unusedAgentRunner,
      persistenceCoordinator,
      new FlowIncomingEventPreparer({ kind: 'disabled' }),
      createPersistOnlyRuntimePersistence(),
    );

    const conversationId = `conv_${action}_truncate_regression`;
    const messageId = `msg_${action}_anchor_1`;

    await orchestrator.next(
      createPersistOnlyRequest({
        conversationId,
        messageId,
        content: '这是原始消息。',
      }),
      () => {},
    );

    const firstHistory = await historyRepository.readFrom(conversationId, 0);
    const firstUserInputs = firstHistory.events.filter(
      (event): event is Extract<RuntimeEvent, { type: 'user_input' }> => event.type === 'user_input',
    );
    expect(firstUserInputs).toHaveLength(1);
    expect(firstUserInputs[0]?.id).toBe(messageId);
    expect(firstUserInputs[0]?.content).toContain('这是原始消息。');

    await expect(
      orchestrator.next(
        createPersistOnlyRequest({
          conversationId,
          messageId,
          content: replacementContent,
          truncateFromMessageId: messageId,
          truncateReason: action,
        }),
        () => {},
      ),
    ).resolves.toMatchObject({
      conversation_id: conversationId,
      events: [],
      stepCount: 0,
    });

    const history = await historyRepository.readFrom(conversationId, 0);
    const userInputs = history.events.filter(
      (event): event is Extract<RuntimeEvent, { type: 'user_input' }> => event.type === 'user_input',
    );

    expect(userInputs).toHaveLength(1);
    expect(userInputs[0]?.id).toBe(messageId);
    expect(userInputs[0]?.content).toContain(replacementContent);
    expect(eventStore.replaceCallCount).toBe(1);
    expect(eventStore.truncateCallCount).toBe(0);
  });

  it.each(['edit', 'regenerate'] as const)(
    '%s 在 truncate 前从事实事件恢复 durable 附件，不经过 draft 通道',
    async (truncateReason) => {
      const eventStore = new UniqueIdEventStore();
      const conversationId = `conv_${truncateReason}_attachments`;
      const messageId = `message_${truncateReason}_attachments`;
      eventStore.seedEvent(createUserInputEvent(
        messageId,
        conversationId,
        'turn-original',
        '原始内容',
        { attachments: [attachment], timestamp: 1000 },
      ));
      const historyRepository = new HistoryRepository(eventStore);
      const historyHandler = new HistoryHandlerService(
        createFlowHistoryAccessPort(historyRepository),
      );
      const persistenceCoordinator = new EventPersistenceCoordinator({
        persistencePort: createConversationPersistencePort(historyRepository),
        conversationAdmission: createDirectFlowConversationAdmissionPort(historyRepository),
      });
      const unusedAgentRunner = {
        run(): never {
          throw new Error('persist_only attachment regression test should not dispatch AgentRunner');
        },
        discardCheckpoint: vi.fn(async () => undefined),
      };
      const orchestrator = new FlowOrchestrator(
        historyHandler,
        unusedAgentRunner,
        persistenceCoordinator,
        new FlowIncomingEventPreparer({ kind: 'disabled' }),
        createPersistOnlyRuntimePersistence(),
      );

      await orchestrator.next(
        createPersistOnlyRequest({
          conversationId,
          messageId,
          content: truncateReason === 'edit' ? '修改后的内容' : '原始内容',
          truncateFromMessageId: messageId,
          truncateReason,
        }),
        () => {},
      );

      const history = await historyRepository.readFrom(conversationId);
      const restored = history.events.find(event => event.id === messageId);
      expect(restored?.type === 'user_input' ? restored.attachments : undefined)
        .toEqual([attachment]);
      expect(eventStore.replaceCallCount).toBe(1);
      expect(eventStore.truncateCallCount).toBe(0);
    },
  );
});
