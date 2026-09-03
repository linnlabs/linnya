/**
 * @file 摘要功能简化测试
 * @description 验证摘要的核心持久化语义：存储、读取、过滤
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createConversationPersistencePort,
  EventPersistenceCoordinator,
} from 'src/app-hosts/linnya/adapters/flow/flow.persistence';
import { createDirectFlowConversationAdmissionPort } from 'src/app-hosts/linnya/adapters/flow/__test-helpers__/createDirectFlowConversationAdmissionPort';
import { HistoryRepository } from 'src/features/conversation/history/history.repository';
import { InMemoryEventStore } from 'src/app-hosts/linnya/testkit/persistence/inMemoryEventStore';
import { routeRuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { RunMetadata } from 'src/app-hosts/linnya/adapters/persistence/event-store';

async function appendEventsToRunForTest(
  coordinator: EventPersistenceCoordinator,
  conversationId: string,
  runId: string,
  events: RuntimeEvent[],
  metadata: RunMetadata,
): Promise<void> {
  const session = await coordinator.createExplicitRunSession(conversationId, runId, metadata);
  await coordinator.appendEventsToRun(session, events.map(event => routeRuntimeEvent(event, {
    run_id: runId,
    lane: 'foreground',
    visibility: 'conversation',
  })));
  await coordinator.completeRun(session);
}

describe('摘要功能简化测试', () => {
  let eventStore: InMemoryEventStore;
  let historyRepository: HistoryRepository;
  let persistenceCoordinator: EventPersistenceCoordinator;

  beforeEach(() => {
    eventStore = new InMemoryEventStore();
    historyRepository = new HistoryRepository(eventStore);
    persistenceCoordinator = new EventPersistenceCoordinator({
      persistencePort: createConversationPersistencePort(historyRepository),
      conversationAdmission: createDirectFlowConversationAdmissionPort(historyRepository),
    });
  });

  afterEach(() => {
    eventStore.close();
  });

  it('应该正确存储和读取带有 replaced_message_ids 的摘要事件', async () => {
    const conversationId = 'test_conv_simple';

    const originalMessages: RuntimeEvent[] = [
      {
        type: 'user_input',
        id: 'msg_1',
        content: '消息1',
        conversation_id: conversationId,
        timestamp: Date.now(),
        turn_id: 'turn_1',
        version: 1,
        source: 'user',
      },
      {
        type: 'user_input',
        id: 'msg_2',
        content: '消息2',
        conversation_id: conversationId,
        timestamp: Date.now() + 100,
        turn_id: 'turn_2',
        version: 1,
        source: 'user',
      },
    ];

    await persistenceCoordinator.withConversationAdmission({
      conversationId,
      initialEvents: originalMessages,
      admitted: () => undefined,
    });
    await appendEventsToRunForTest(
      persistenceCoordinator,
      conversationId,
      'turn_1',
      originalMessages,
      { kind: 'user_input', toolset_version: '1.0' },
    );

    const summaryEvent: RuntimeEvent = {
      type: 'history_summary',
      id: 'summary_1',
      content: '这是摘要内容',
      conversation_id: conversationId,
      timestamp: Date.now() + 200,
      turn_id: 'turn_summary',
      version: 1,
      original_message_count: 2,
      replaced_message_ids: ['msg_1', 'msg_2'],
      summary_seq: 0,
      included_old_summary: false,
    };

    await appendEventsToRunForTest(
      persistenceCoordinator,
      conversationId,
      'turn_summary',
      [summaryEvent],
      { kind: 'agent', toolset_version: '1.0' },
    );

    const history = await historyRepository.readFrom(conversationId, 0);
    const summaries = history.events.filter(e => e.type === 'history_summary');

    expect(history.events).toHaveLength(3);
    expect(summaries.length).toBe(1);

    const storedSummary = summaries[0] as Extract<RuntimeEvent, { type: 'history_summary' }>;
    expect(storedSummary.replaced_message_ids).toBeDefined();
    expect(Array.isArray(storedSummary.replaced_message_ids)).toBe(true);
    expect(storedSummary.replaced_message_ids).toEqual(['msg_1', 'msg_2']);
  });

  it('应该正确过滤被摘要替换的消息', async () => {
    const conversationId = 'test_conv_filter';

    const messages: RuntimeEvent[] = [
      {
        type: 'user_input',
        id: 'msg_a',
        content: '消息A',
        conversation_id: conversationId,
        timestamp: Date.now(),
        turn_id: 'turn_1',
        version: 1,
        source: 'user',
      },
      {
        type: 'user_input',
        id: 'msg_b',
        content: '消息B',
        conversation_id: conversationId,
        timestamp: Date.now() + 100,
        turn_id: 'turn_2',
        version: 1,
        source: 'user',
      },
    ];

    await persistenceCoordinator.withConversationAdmission({
      conversationId,
      initialEvents: messages,
      admitted: () => undefined,
    });
    await appendEventsToRunForTest(
      persistenceCoordinator,
      conversationId,
      'turn_1',
      messages,
      { kind: 'user_input', toolset_version: '1.0' },
    );

    const summary: RuntimeEvent = {
      type: 'history_summary',
      id: 'summary_x',
      content: '摘要X',
      conversation_id: conversationId,
      timestamp: Date.now() + 200,
      turn_id: 'turn_summary',
      version: 1,
      replaced_message_ids: ['msg_a', 'msg_b'],
      original_message_count: 2,
      summary_seq: 0,
    };

    await appendEventsToRunForTest(
      persistenceCoordinator,
      conversationId,
      'turn_summary',
      [summary],
      { kind: 'agent', toolset_version: '1.0' },
    );

    const history = await historyRepository.readFrom(conversationId, 0);
    const replacedIds = new Set<string>();

    history.events
      .filter(e => e.type === 'history_summary')
      .forEach(s => {
        const replaces = (s as Extract<RuntimeEvent, { type: 'history_summary' }>).replaced_message_ids ?? [];
        replaces.forEach((id: string) => replacedIds.add(id));
      });

    const filtered = history.events.filter((event) => event.type === 'history_summary' || !replacedIds.has(event.id));

    expect(history.events).toHaveLength(3);
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('summary_x');
  });
});
