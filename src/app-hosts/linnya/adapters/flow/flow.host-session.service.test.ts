import { describe, expect, it, vi } from 'vitest';
import type { ConversationNextRequest } from '@app/schemas';
import {
  createFinalAnswerEvent,
  createHistorySummaryEvent,
  type RuntimeEvent,
  RunIdSchema,
} from 'linnkit/contracts';
import { graph } from 'linnkit/runtime-kernel';
import { FlowHostSessionService } from './flow.host-session.service';
import {
  createConversationPersistencePort,
  EventPersistenceCoordinator,
  type ConversationPersistencePort,
} from './flow.persistence';
import type { FlowIncomingEventBatch } from './incoming-events/definitions/flowIncomingEventBatch';

function createCoordinator(): EventPersistenceCoordinator {
  const persistencePort: ConversationPersistencePort = {
    beginRunSession: vi.fn(),
    openRunSession: vi.fn(),
    appendEventToRun: vi.fn(),
    replaceUserInputEvent: vi.fn(),
    completeRun: vi.fn(),
    failRun: vi.fn(),
  };
  return new EventPersistenceCoordinator({
    persistencePort: createConversationPersistencePort(persistencePort),
    conversationAdmission: {
      withConversationAdmission: async input => input.admitted(),
    },
  });
}

describe('FlowHostSessionService user input commit ack', () => {
  it('图片-only 输入只确认 durable asset 身份，不泄漏 draft 身份', () => {
    const sseSink = vi.fn();
    const event: RuntimeEvent = {
      id: 'message-1',
      type: 'user_input',
      timestamp: 10,
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      version: 1,
      content: '<user_request>\n\n</user_request>',
      raw_content: '',
      source: 'user',
      attachments: [
        {
          id: 'attachment-1',
          kind: 'image',
          resourceId: 'asset-1',
          mediaType: 'image/png',
          byteLength: 4,
          width: 2,
          height: 2,
          sha256: 'a'.repeat(64),
          fileName: 'diagram.png',
        },
      ],
    };
    const request: ConversationNextRequest = {
      conversation_id: 'conversation-1',
      new_events: [
        {
          id: 'message-1',
          type: 'user_input',
          timestamp: 10,
          turn_id: 'turn-1',
          content: '',
          source: 'user',
          attachments: [{ draftId: 'draft-1', kind: 'image', fileName: 'diagram.png' }],
        },
      ],
    };
    const batch: FlowIncomingEventBatch = {
      events: [event],
      assetCommitsByEventId: new Map(),
      committedDraftIds: ['draft-1'],
    };
    const session = new FlowHostSessionService({
      conversationId: 'conversation-1',
      sseSink,
      shouldPersist: true,
      persistenceCoordinator: createCoordinator(),
      eventStore: new graph.MemoryEventStore(),
      nextEventStoreId: graph.createMonotonicEventStoreIdFactory(() => 10),
    });
    session.bindRunIdentity({
      runId: RunIdSchema.parse('run-1'),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const routedBatch = session.routeIncomingEventBatch(batch);

    session.emitCommittedUserInputs(request, routedBatch);

    expect(sseSink).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'message-1',
        type: 'user_input_committed',
        operation: 'append',
        raw_content: '',
        attachments: [
          expect.objectContaining({
            id: 'attachment-1',
            assetId: 'asset-1',
            fileName: 'diagram.png',
          }),
        ],
      })
    );
    expect(JSON.stringify(sseSink.mock.calls)).not.toContain('draft-1');
  });

  it('把 publisher 接纳的 root 事实从同一 EventBus 持久化到 EventStore', async () => {
    const eventStore = new graph.MemoryEventStore();
    const session = new FlowHostSessionService({
      conversationId: 'conversation-1',
      sseSink: vi.fn(),
      shouldPersist: true,
      persistenceCoordinator: createCoordinator(),
      eventStore,
      nextEventStoreId: graph.createMonotonicEventStoreIdFactory(() => 20),
    });
    session.bindRunIdentity({
      runId: RunIdSchema.parse('run-1'),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const ports = session.createRunnerHostPorts();

    ports.runtimeEventSink(
      createFinalAnswerEvent('answer-1', 'conversation-1', 'turn-1', '交付答案', {
        completion_reason: 'terminal',
      }),
      'FlowHostSessionService.test'
    );
    await ports.drainPersistence();

    const persisted = await eventStore.range('conversation-1');
    expect(persisted).toEqual([
      expect.objectContaining({
        eventStoreId: '0000000000020-0000',
        event: expect.objectContaining({
          id: 'answer-1',
          run_id: 'run-1',
          content: '交付答案',
        }),
      }),
    ]);
    session.eventBus.close();
  });

  it('自动压缩摘要先持久化再 fan-out，且只写入一次', async () => {
    const eventStore = new graph.MemoryEventStore();
    const observed: string[] = [];
    const session = new FlowHostSessionService({
      conversationId: 'conversation-1',
      sseSink: vi.fn(),
      shouldPersist: true,
      persistenceCoordinator: createCoordinator(),
      eventStore,
      nextEventStoreId: graph.createMonotonicEventStoreIdFactory(() => 30),
    });
    session.bindRunIdentity({
      runId: RunIdSchema.parse('run-1'),
      lane: 'foreground',
      visibility: 'conversation',
    });
    session.eventBus.on('event', envelope => observed.push(envelope.payload.id));
    const ports = session.createRunnerHostPorts();
    const summary = createHistorySummaryEvent(
      'summary-1',
      'conversation-1',
      'turn-1',
      'checkpoint',
      ['old-1'],
      1,
      1,
    );

    await ports.runtimeEventCommitPort?.(summary, 'FlowHostSessionService.test');
    expect(observed).toEqual([]);
    expect(await eventStore.range('conversation-1')).toHaveLength(1);

    ports.runtimeEventSink(summary, 'FlowHostSessionService.test');
    await ports.drainPersistence();

    expect(observed).toEqual(['summary-1']);
    expect(await eventStore.range('conversation-1')).toHaveLength(1);
    session.eventBus.close();
  });
});
