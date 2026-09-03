import type {
  ConversationListItem,
  AppendEventToRunOptions,
  IEventStore,
  ReadRuntimeEventsOptions,
  RunMetadata,
  RunSession,
} from 'src/app-hosts/linnya/adapters/persistence/event-store/event-store.interface';
import { runtimeKernel } from 'linnkit';
import { events as runtimeEvents } from 'linnkit/runtime-kernel';
import { parseRuntimeEventRoutingIdentity } from 'linnkit/contracts';
import type { RoutedRuntimeEvent, RuntimeEvent } from 'linnkit/contracts';
import {
  createDefaultGraphExecutor,
  type ScriptedInferenceHarness,
} from 'linnkit/testkit';
import type { ToolRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import type { FlowRuntimePort } from 'src/app-hosts/linnya/adapters/flow/flow.runtime';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { LinnyaRunCostCollector } from 'src/app-hosts/linnya/adapters/token-accounting';

interface InMemoryStoredFlowEvent {
  readonly event: RoutedRuntimeEvent;
  readonly eventStoreId?: string;
}

export class InMemoryFlowEventStore implements IEventStore {
  private readonly eventsByConversation = new Map<string, InMemoryStoredFlowEvent[]>();
  private readonly runSessions = new Map<string, RunSession>();

  async beginRunSession(conversationId: string, runId: string, _metadata: RunMetadata): Promise<RunSession> {
    await this.ensureConversation(conversationId, []);
    const session = { runId, conversationId, startedAt: Date.now() };
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

  async appendEventToRun(
    session: RunSession,
    event: RoutedRuntimeEvent,
    options?: AppendEventToRunOptions,
  ): Promise<void> {
    runtimeEvents.requirePersistableRoutedRuntimeEvent(event);
    const identity = parseRuntimeEventRoutingIdentity(event);
    if (event.conversation_id !== session.conversationId || identity.run_id !== session.runId) {
      throw new Error('[InMemoryFlowEventStore] event does not belong to the target run session');
    }
    const existing = this.eventsByConversation.get(session.conversationId) ?? [];
    this.eventsByConversation.set(session.conversationId, [
      ...existing,
      { event, ...(options?.eventStoreId ? { eventStoreId: options.eventStoreId } : {}) },
    ]);
  }

  async replaceUserInputEvent(
    session: RunSession,
    targetEventId: string,
    replacement: RoutedRuntimeEvent,
  ): Promise<{ deletedEventCount: number; deletedRunCount: number }> {
    runtimeEvents.requirePersistableRoutedRuntimeEvent(replacement);
    const identity = parseRuntimeEventRoutingIdentity(replacement);
    if (replacement.conversation_id !== session.conversationId || identity.run_id !== session.runId) {
      throw new Error('[InMemoryFlowEventStore] replacement does not belong to the target run session');
    }
    const existing = this.eventsByConversation.get(session.conversationId) ?? [];
    const targetIndex = existing.findIndex(
      ({ event }) => event.id === targetEventId && event.type === 'user_input',
    );
    if (targetIndex < 0 || replacement.type !== 'user_input' || replacement.id !== targetEventId) {
      throw new Error('[InMemoryFlowEventStore] invalid user-input replacement');
    }
    const removed = existing.slice(targetIndex);
    this.eventsByConversation.set(session.conversationId, [
      ...existing.slice(0, targetIndex),
      { event: replacement },
    ]);
    return {
      deletedEventCount: removed.length,
      deletedRunCount: new Set(
        removed.flatMap(({ event }) => event.run_id ? [event.run_id] : []),
      ).size,
    };
  }

  completeRun(_session: RunSession): Promise<void> {
    return Promise.resolve();
  }

  failRun(_session: RunSession, _error: { code: string; message: string }): Promise<void> {
    return Promise.resolve();
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
    const all = (this.eventsByConversation.get(conversationId) ?? [])
      .map(({ event }) => event)
      .filter((event) => !excluded.has(event.type))
      .filter((event) => {
        if (options?.routingScope !== 'foreground-conversation') return true;
        const identity = parseRuntimeEventRoutingIdentity(event);
        return identity.lane === 'foreground' && identity.visibility === 'conversation';
      });
    const limit = typeof options?.limit === 'number' && options.limit > 0 ? options.limit : 50;
    const cursor = typeof options?.cursor === 'number' && options.cursor >= 0 ? options.cursor : 0;
    const page = all.slice(cursor, cursor + limit);
    const nextCursor = cursor + page.length;
    return {
      events: page,
      nextCursor: nextCursor < all.length ? nextCursor : undefined,
      hasMore: nextCursor < all.length,
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
    conversationId: string,
    _selectedAgentId: ConversationListItem['selected_agent_id'],
    _projectId: string | null,
  ): Promise<boolean> {
    if (!this.eventsByConversation.has(conversationId)) {
      this.eventsByConversation.set(conversationId, []);
    }
    return true;
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    return this.eventsByConversation.delete(conversationId);
  }

  async truncateFromEvent(
    _conversationId: string,
    _eventId: string,
  ): Promise<{ found: boolean; deletedEventCount: number; deletedRunCount: number }> {
    return { found: false, deletedEventCount: 0, deletedRunCount: 0 };
  }

  close(): void {
    this.eventsByConversation.clear();
  }

  async appendRuntimeEvent(persistedEvent: runtimeKernel.graph.PersistedEvent): Promise<void> {
    const eventStoreId = runtimeKernel.graph.requireEventStoreId(persistedEvent.eventStoreId);
    const event = runtimeEvents.requirePersistableRoutedRuntimeEvent(persistedEvent.event);
    const session = await this.openRunSession(event.conversation_id, event.run_id);
    await this.appendEventToRun(session, event, { eventStoreId });
  }

  readRuntimeEventRange(
    conversationId: string,
    options: runtimeKernel.graph.EventRangeOptions = {},
  ): runtimeKernel.graph.PersistedEvent[] {
    const events = (this.eventsByConversation.get(conversationId) ?? [])
      .filter((record): record is InMemoryStoredFlowEvent & { readonly eventStoreId: string } => (
        record.eventStoreId !== undefined
      ))
      .filter(({ eventStoreId }) => (
        options.fromEventStoreId ? eventStoreId > options.fromEventStoreId : true
      ))
      .filter(({ eventStoreId }) => (
        options.toEventStoreId ? eventStoreId <= options.toEventStoreId : true
      ))
      .map(({ eventStoreId, event }) => ({ eventStoreId, event }));
    return options.limit === undefined ? events : events.slice(0, options.limit);
  }
}

/**
 * 集成测试使用与 Host history 相同的内存事实源装配 Linnkit EventStore。
 * 适配器只负责 Linnkit cursor 视图，不复制或补造 RuntimeEvent。
 */
export function createFlowIntegrationRuntimePersistence(
  host: InMemoryFlowEventStore,
): FlowRuntimePort {
  const eventStore: runtimeKernel.graph.EventStore = {
    append: persistedEvent => host.appendRuntimeEvent(persistedEvent),
    range: async (conversationId, options) => host.readRuntimeEventRange(conversationId, options),
    latestEventStoreId: async (conversationId) => {
      const events = host.readRuntimeEventRange(conversationId);
      return events.length > 0 ? events[events.length - 1]?.eventStoreId ?? null : null;
    },
  };
  const costCollector = new LinnyaRunCostCollector();
  const supervisor = new runtimeKernel.runSupervisor.DefaultRunSupervisor<AgentInvokeRequest>({
    registryStore: new runtimeKernel.runSupervisor.MemoryRunRegistryStore(),
  });
  return {
    supervisor,
    costCollector,
    eventStore,
    nextEventStoreId: runtimeKernel.graph.createMonotonicEventStoreIdFactory(),
  };
}

export async function buildFlowIntegrationEngine(params: {
  llmCaller: ReturnType<ScriptedInferenceHarness['getLlmCaller']>;
  toolRuntime: ToolRuntimeHarness['toolRuntime'];
}): Promise<runtimeKernel.graph.GraphExecutor> {
  const { createDefaultLlmNode } = await import('src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory');
  const { defaultObservationPreviewPort } = await import('src/app-hosts/linnya/adapters/tools/defaultPorts');

  return createDefaultGraphExecutor({
    llmNode: createDefaultLlmNode({
      llmCaller: params.llmCaller,
      toolRuntime: params.toolRuntime,
      // 该 Host 集成夹具同样必须提供 context budget 所需的正式容量事实；
      // 不能依赖生产默认目录里碰巧存在同名 scripted model。
      modelCatalog: {
        getModelById: id => id === 'scripted-test-model'
          ? {
              id,
              enabled: true,
              capabilities: ['chat'],
              adapter_input_support: { user_image: false, tool_result_image: false },
              inference_route: {
                context_window_tokens: 128_000,
                max_output_tokens: 4_096,
              },
            }
          : undefined,
        getModelsByCapability: () => [],
        getModelsByUIVisibility: () => [],
      },
    }),
    toolRuntime: params.toolRuntime,
    observationPreview: defaultObservationPreviewPort,
    maxSteps: 8,
    checkpointer: new runtimeKernel.graph.MemoryCheckpointer(),
  });
}
