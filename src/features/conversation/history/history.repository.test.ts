/**
 * @file src/features/conversation/history/history.repository.test.ts
 * @description HistoryRepository.readFrom 分页读取回归测试
 *
 * 中文备注（根因）：
 * - deep_research 等多阶段任务会在单步内产生大量 RuntimeEvent；
 * - 如果历史读取只取固定数量的“旧事件”，会导致 Runner 读不到最新的共享状态快照事件，
 *   从而触发“初始化空快照”并覆盖最新快照，表现为“共享面板突然变空”。
 *
 * 该测试确保：readFrom 会分页读全，并且保留 fromRevision 的语义。
 */
import { describe, expect, it } from 'vitest';
import type {
  IEventStore,
  ConversationListItem,
  ReadRuntimeEventsOptions,
  RunMetadata,
  RunSession,
} from '../../../app-hosts/linnya/adapters/persistence/event-store/event-store.interface';
import { HistoryRepository } from './history.repository';
import {
  routeRuntimeEvent,
  type RoutedRuntimeEvent,
  type RuntimeEvent,
} from 'linnkit/contracts';

class FakeEventStore implements IEventStore {
  private readonly eventsByConversation = new Map<string, RoutedRuntimeEvent[]>();

  seed(conversationId: string, events: RuntimeEvent[]): void {
    this.eventsByConversation.set(
      conversationId,
      events.map(event => routeRuntimeEvent(event, {
        run_id: event.turn_id,
        lane: 'foreground',
        visibility: 'conversation',
      })),
    );
  }

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
    conversationId: string,
    options?: ReadRuntimeEventsOptions,
  ): Promise<{ events: RoutedRuntimeEvent[]; nextCursor?: number; hasMore: boolean }> {
    const excluded = new Set(options?.excludeTypes ?? []);
    const all = (this.eventsByConversation.get(conversationId) ?? [])
      .filter(event => !excluded.has(event.type));
    const limit = typeof options?.limit === 'number' && options.limit > 0 ? options.limit : 50;

    // 中文备注：cursor 是“events.rowid”的抽象；这里用数组下标+1 近似模拟 rowid 单调递增。
    const cursor = typeof options?.cursor === 'number' && options.cursor >= 0 ? options.cursor : 0;
    const startIdx = cursor;
    const page = all.slice(startIdx, startIdx + limit);
    const nextCursor = startIdx + page.length;
    const hasMore = nextCursor < all.length;

    return { events: page, nextCursor: hasMore ? nextCursor : undefined, hasMore };
  }

  async listConversations(
    _options?: { limit?: number; cursor?: string; search?: string; projectId?: string }
  ): Promise<{ conversations: ConversationListItem[]; nextCursor?: string; hasMore: boolean }> {
    throw new Error('not implemented');
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
  async updatePinned(_conversationId: string, _pinned: boolean, _pinnedAt: number | null): Promise<boolean> {
    throw new Error('not implemented');
  }
  async updateSelectedAgent(
    _conversationId: string,
    _selectedAgentId: ConversationListItem['selected_agent_id'],
  ): Promise<boolean> {
    throw new Error('not implemented');
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

function buildEvents(n: number, conversationId: string): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  for (let i = 0; i < n; i += 1) {
    events.push({
      type: 'thought',
      id: `evt_${i}`,
      conversation_id: conversationId,
      turn_id: `turn_${Math.floor(i / 10)}`,
      timestamp: 1000 + i,
      version: 1,
      content: `c_${i}`,
      is_complete: true,
    });
  }
  return events;
}

describe('HistoryRepository.readFrom', () => {
  it('应分页读取全量 events，并保持 revision / fromRevision 语义', async () => {
    const conversationId = 'conv_readFrom_pagination';
    const total = 1201;
    const store = new FakeEventStore();
    store.seed(conversationId, buildEvents(total, conversationId));
    const repo = new HistoryRepository(store);

    const all = await repo.readFrom(conversationId, 0);
    expect(all.revision).toBe(total);
    expect(all.events.length).toBe(total);
    expect(all.events[0]?.id).toBe('evt_0');
    expect(all.events[total - 1]?.id).toBe(`evt_${total - 1}`);

    const from = 1000;
    const sliced = await repo.readFrom(conversationId, from);
    expect(sliced.revision).toBe(total);
    expect(sliced.events.length).toBe(total - from);
    expect(sliced.events[0]?.id).toBe(`evt_${from}`);
    expect(sliced.events[sliced.events.length - 1]?.id).toBe(`evt_${total - 1}`);
  });
});
