import type {
  ConversationListItem,
  IEventStore,
  ReadRuntimeEventsOptions,
  RunMetadata,
  RunSession,
} from 'src/app-hosts/linnya/adapters/persistence/event-store/event-store.interface';
import { events as runtimeEvents } from '@linnlabs/linnkit/runtime-kernel';
import { parseRuntimeEventRoutingIdentity } from '@linnlabs/linnkit/contracts';
import type { RoutedRuntimeEvent, RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { getRenderableRuntimeEventContent } from 'src/app-hosts/linnya/context/agent/userInputContext';
import {
  decodeConversationListCursor,
  encodeConversationListCursor,
  getConversationListSortCursor,
} from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation-list-cursor';

interface ConversationRecord {
  metadata: ConversationListItem;
  projectId?: string;
}

function getPreviewableContent(event: RuntimeEvent): string | undefined {
  switch (event.type) {
    case 'user_input':
    case 'thought':
    case 'final_answer':
    case 'history_summary':
      {
        const content = getRenderableRuntimeEventContent(event);
        return content && content.length > 0 ? content : undefined;
      }
    case 'error':
      return event.error.trim().length > 0 ? event.error : undefined;
    default:
      return undefined;
  }
}

function derivePreviewText(events: RuntimeEvent[]): string | undefined {
  const content = events.map(getPreviewableContent).find((candidate) => typeof candidate === 'string');
  return content ? content.slice(0, 120) : undefined;
}

/**
 * 纯内存 EventStore 测试夹具。
 *
 * 中文备注：
 * - 用于 contract/integration 测试，不依赖 SQLite / native module ABI；
 * - 目标是复用 IEventStore 协议，而不是模拟 SQLite 实现细节。
 */
export class InMemoryEventStore implements IEventStore {
  private readonly eventsByConversation = new Map<string, RoutedRuntimeEvent[]>();
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly runSessions = new Map<string, RunSession>();

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
    const session = this.runSessions.get(runId);
    if (!session) {
      throw new Error(`[InMemoryEventStore] run ${runId} does not exist`);
    }
    if (session.conversationId !== conversationId) {
      throw new Error(`[InMemoryEventStore] run ${runId} belongs to ${session.conversationId}`);
    }
    return session;
  }

  async appendEventToRun(session: RunSession, event: RoutedRuntimeEvent): Promise<void> {
    runtimeEvents.requirePersistableRoutedRuntimeEvent(event);
    const identity = parseRuntimeEventRoutingIdentity(event);
    if (event.conversation_id !== session.conversationId || identity.run_id !== session.runId) {
      throw new Error('[InMemoryEventStore] event does not belong to the target run session');
    }
    const existing = this.eventsByConversation.get(session.conversationId) ?? [];
    this.eventsByConversation.set(session.conversationId, [...existing, event]);
    this.refreshConversationMetadata(session.conversationId, [event]);
  }

  async replaceUserInputEvent(
    session: RunSession,
    targetEventId: string,
    replacement: RoutedRuntimeEvent,
  ): Promise<{ deletedEventCount: number; deletedRunCount: number }> {
    runtimeEvents.requirePersistableRoutedRuntimeEvent(replacement);
    const identity = parseRuntimeEventRoutingIdentity(replacement);
    if (replacement.conversation_id !== session.conversationId || identity.run_id !== session.runId) {
      throw new Error('[InMemoryEventStore] replacement does not belong to the target run session');
    }
    const existing = this.eventsByConversation.get(session.conversationId) ?? [];
    const targetIndex = existing.findIndex(event => event.id === targetEventId && event.type === 'user_input');
    if (targetIndex < 0 || replacement.type !== 'user_input' || replacement.id !== targetEventId) {
      throw new Error('[InMemoryEventStore] invalid user-input replacement');
    }
    const removed = existing.slice(targetIndex);
    this.eventsByConversation.set(session.conversationId, [
      ...existing.slice(0, targetIndex),
      replacement,
    ]);
    this.refreshConversationMetadata(session.conversationId, [replacement]);
    return {
      deletedEventCount: removed.length,
      deletedRunCount: countRunIds(removed),
    };
  }

  async completeRun(_session: RunSession): Promise<void> {
    // noop for in-memory test harness
  }

  async failRun(_session: RunSession, _error: { code: string; message: string }): Promise<void> {
    // noop for in-memory test harness
  }

  async ensureConversation(
    conversationId: string,
    initialEvents: RuntimeEvent[],
    projectId?: string,
    mode?: string,
  ): Promise<void> {
    if (!this.eventsByConversation.has(conversationId)) {
      this.eventsByConversation.set(conversationId, []);
    }

    const existing = this.conversations.get(conversationId);
    if (existing) {
      this.conversations.set(conversationId, {
        ...existing,
        projectId: projectId ?? existing.projectId,
        metadata: {
          ...existing.metadata,
          mode: mode ?? existing.metadata.mode,
          title: existing.metadata.title || 'New Chat',
          preview_text: existing.metadata.preview_text ?? derivePreviewText(initialEvents),
        },
      });
      return;
    }

    const createdAt = initialEvents[0]?.timestamp ?? Date.now();
    const lastEventAt = initialEvents[initialEvents.length - 1]?.timestamp ?? createdAt;
    this.conversations.set(conversationId, {
      projectId,
      metadata: {
        conversation_id: conversationId,
        title: 'New Chat',
        created_at: createdAt,
        last_event_at: lastEventAt,
        preview_text: derivePreviewText(initialEvents),
        total_events: 0,
        user_message_count: 0,
        is_pinned: false,
        mode,
        selected_agent_id: null,
      },
    });
  }

  async readEvents(
    conversationId: string,
    options?: ReadRuntimeEventsOptions,
  ): Promise<{ events: RoutedRuntimeEvent[]; nextCursor?: number; hasMore: boolean }> {
    const excluded = new Set(options?.excludeTypes ?? []);
    const allEvents = (this.eventsByConversation.get(conversationId) ?? [])
      .filter(event => !excluded.has(event.type))
      .filter((event) => {
        if (options?.routingScope !== 'foreground-conversation') return true;
        const identity = parseRuntimeEventRoutingIdentity(event);
        return identity.lane === 'foreground' && identity.visibility === 'conversation';
      });
    const limit = typeof options?.limit === 'number' && options.limit > 0 ? options.limit : 50;
    const cursor = typeof options?.cursor === 'number' && options.cursor >= 0 ? options.cursor : 0;
    const page = allEvents.slice(cursor, cursor + limit);
    const nextCursor = cursor + page.length;
    return {
      events: page,
      nextCursor: nextCursor < allEvents.length ? nextCursor : undefined,
      hasMore: nextCursor < allEvents.length,
    };
  }

  async listConversations(
    options?: { limit?: number; cursor?: string; search?: string; projectId?: string },
  ): Promise<{ conversations: ConversationListItem[]; nextCursor?: string; hasMore: boolean }> {
    const search = options?.search?.trim().toLowerCase();
    const hasProjectFilter = typeof options?.projectId === 'string' && options.projectId.length > 0;
    const projectId = options?.projectId;
    const limit = typeof options?.limit === 'number' && options.limit > 0 ? options.limit : 50;
    const cursor = decodeConversationListCursor(options?.cursor);

    const all = [...this.conversations.values()]
      .filter(({ projectId: candidateProjectId, metadata }) => {
        if (hasProjectFilter && candidateProjectId !== projectId) return false;
        if (!hasProjectFilter && candidateProjectId) return false;
        if (!search) return true;
        const haystack = `${metadata.title} ${metadata.preview_text ?? ''}`.toLowerCase();
        return haystack.includes(search);
      })
      .map(({ metadata }) => metadata)
      .sort((left, right) => {
        const cursorDiff = getConversationListSortCursor(right) - getConversationListSortCursor(left);
        if (cursorDiff !== 0) return cursorDiff;
        if (right.conversation_id > left.conversation_id) return 1;
        if (right.conversation_id < left.conversation_id) return -1;
        return 0;
      })
      .filter((conversation) => {
        if (!cursor) return true;
        const sortCursor = getConversationListSortCursor(conversation);
        return sortCursor < cursor.sortCursor
          || (sortCursor === cursor.sortCursor && conversation.conversation_id < cursor.conversationId);
      });

    const rows = all.slice(0, limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const lastConversation = page[page.length - 1];
    return {
      conversations: page,
      nextCursor: hasMore && lastConversation
        ? encodeConversationListCursor({
            sortCursor: getConversationListSortCursor(lastConversation),
            conversationId: lastConversation.conversation_id,
          })
        : undefined,
      hasMore,
    };
  }

  async deleteConversationsWithoutProject(): Promise<number> {
    const orphanIds = [...this.conversations.entries()]
      .filter(([, record]) => !record.projectId)
      .map(([conversationId]) => conversationId);

    orphanIds.forEach((conversationId) => {
      this.conversations.delete(conversationId);
      this.eventsByConversation.delete(conversationId);
    });

    return orphanIds.length;
  }

  async getConversationMetadata(conversationId: string): Promise<ConversationListItem | null> {
    return this.conversations.get(conversationId)?.metadata ?? null;
  }

  async updateTitle(conversationId: string, title: string): Promise<boolean> {
    const existing = this.conversations.get(conversationId);
    if (!existing) {
      return false;
    }

    this.conversations.set(conversationId, {
      ...existing,
      metadata: {
        ...existing.metadata,
        title,
      },
    });
    return true;
  }

  async updatePinned(conversationId: string, pinned: boolean, pinnedAt: number | null): Promise<boolean> {
    const existing = this.conversations.get(conversationId);
    if (!existing) {
      return false;
    }

    this.conversations.set(conversationId, {
      ...existing,
      metadata: {
        ...existing.metadata,
        is_pinned: pinned,
        pinned_at: typeof pinnedAt === 'number' ? pinnedAt : undefined,
      },
    });
    return true;
  }

  async updateSelectedAgent(
    conversationId: string,
    selectedAgentId: ConversationListItem['selected_agent_id'],
    projectId: string | null,
  ): Promise<boolean> {
    await this.ensureConversation(conversationId, [], projectId ?? undefined);
    const existing = this.conversations.get(conversationId);
    if (!existing) throw new Error('conversation materialization failed');

    this.conversations.set(conversationId, {
      ...existing,
      metadata: {
        ...existing.metadata,
        selected_agent_id: selectedAgentId,
      },
    });
    return true;
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    const removedConversation = this.conversations.delete(conversationId);
    const removedEvents = this.eventsByConversation.delete(conversationId);
    return removedConversation || removedEvents;
  }

  async truncateFromEvent(
    conversationId: string,
    eventId: string,
  ): Promise<{ found: boolean; deletedEventCount: number; deletedRunCount: number }> {
    const existing = this.eventsByConversation.get(conversationId) ?? [];
    const targetIndex = existing.findIndex((event) => event.id === eventId);
    if (targetIndex < 0) {
      return { found: false, deletedEventCount: 0, deletedRunCount: 0 };
    }

    const kept = existing.slice(0, targetIndex);
    const removed = existing.slice(targetIndex);
    this.eventsByConversation.set(conversationId, kept);
    this.refreshConversationMetadata(conversationId);
    return {
      found: true,
      deletedEventCount: removed.length,
      deletedRunCount: countRunIds(removed),
    };
  }

  close(): void {
    this.eventsByConversation.clear();
    this.conversations.clear();
  }

  private refreshConversationMetadata(conversationId: string, fallbackEvents: RuntimeEvent[] = []): void {
    const existing = this.conversations.get(conversationId);
    const storedEvents = this.eventsByConversation.get(conversationId) ?? [];
    const sourceEvents = storedEvents.length > 0 ? storedEvents : fallbackEvents;
    const createdAt = existing?.metadata.created_at ?? sourceEvents[0]?.timestamp ?? Date.now();
    const lastEventAt = storedEvents[storedEvents.length - 1]?.timestamp
      ?? sourceEvents[sourceEvents.length - 1]?.timestamp
      ?? createdAt;

    this.conversations.set(conversationId, {
      projectId: existing?.projectId,
      metadata: {
        conversation_id: conversationId,
        title: existing?.metadata.title ?? 'New Chat',
        created_at: createdAt,
        last_event_at: lastEventAt,
        preview_text: existing?.metadata.preview_text ?? derivePreviewText(sourceEvents),
        total_events: storedEvents.length,
        user_message_count: storedEvents.filter((event) => event.type === 'user_input').length,
        is_pinned: existing?.metadata.is_pinned ?? false,
        pinned_at: existing?.metadata.pinned_at,
        mode: existing?.metadata.mode,
        selected_agent_id: existing?.metadata.selected_agent_id ?? null,
      },
    });
  }
}

function countRunIds(events: readonly RuntimeEvent[]): number {
  return new Set(events.flatMap(event => event.run_id ? [event.run_id] : [])).size;
}
