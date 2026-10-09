import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { execution } from '@linnlabs/linnkit/runtime-kernel';
import {
  createToolOutputEvent,
  parseRoutedRuntimeEvent,
  routeRuntimeEvent,
  type RuntimeEvent,
  type SerializableJsonValue,
  type SSEEvent,
} from '@linnlabs/linnkit/contracts';
import { ConversationToolMessagePayloadSchema } from '@app/schemas';

import { CONVERSATION_SCHEMAS } from '../conversation.schema';
import { SQLiteEventStore } from '../sqlite.implementation';
import { readTail } from '../ui-projection/sqliteUiMessagesReader';
import { rebuildConversationUiProjection } from '../ui-projection/rebuildConversation';
import {
  toolObservationTruncation,
  toolObservationTruncationFixture,
} from '../ui-projection/__fixtures__/toolObservationTruncationFixture';
import { DefaultRuntimeEventSseMapper } from '../../../realtime/sse.port';
import {
  createInitialProjectionState,
  reduceEvent,
} from '../../../../../../../apps/renderer/domains/conversation/services/messageProjection';
import { mapUiMessageDtoToConversationMessage } from '../../../../../../../apps/renderer/domains/conversation/message-window/functions/mapUiMessageDto';

const conversationId = 'conv_ui_projection_fixture';
const runId = 'run_observation_truncation';
const openStores: SQLiteEventStore[] = [];
const malformedTruncations: SerializableJsonValue[] = [
  null,
  { originalChars: -1, previewChars: 1 },
  { originalChars: 10 },
];

async function createStore() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);
  const store = new SQLiteEventStore(db);
  openStores.push(store);
  await store.ensureConversation(conversationId, [], undefined, 'agent');
  const session = await store.beginRunSession(conversationId, runId, { kind: 'agent' });
  return { db, store, session };
}

function createLiveProjection() {
  const state = createInitialProjectionState({
    id: conversationId,
    title: '截断事实投影',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    selectedAgentId: null,
    messages: [],
  });
  const sequencer = new execution.EventSequencer(conversationId);
  const mapper = new DefaultRuntimeEventSseMapper();
  function mapEvent(event: RuntimeEvent): SSEEvent {
    const mapped = mapper.mapToSse(sequencer.wrapEvent(parseRoutedRuntimeEvent(event), 'test'));
    if (mapped?.length !== 1 || !mapped[0]) throw new Error('Expected one live tool event');
    return mapped[0];
  }
  return { state, mapEvent };
}

function readMessages(db: Database.Database) {
  const window = readTail(db, conversationId, 20);
  if (window.status !== 'ready') throw new Error('Expected ready durable window');
  return window.messages;
}

describe('tool observation truncation through durable and live Conversation projection', () => {
  afterEach(() => {
    for (const store of openStores.splice(0)) store.close();
  });

  it('preserves governance facts through SQLite, real SSE, reload and rebuild without parsing source markers', async () => {
    const { db, store, session } = await createStore();
    const live = createLiveProjection();
    for (const event of toolObservationTruncationFixture.events) {
      await store.appendEventToRun(session, parseRoutedRuntimeEvent(event));
      const sse = live.mapEvent(event);
      if (event.type === 'tool_output' && sse.type === 'tool_output') {
        expect(sse.metadata?.observationTruncation).toEqual(event.metadata?.observationTruncation);
      }
      expect(reduceEvent(live.state, sse).success).toBe(true);
    }

    const persisted = await store.readEvents(conversationId);
    expect(persisted.events).toEqual(toolObservationTruncationFixture.events);
    const expected = [
      toolObservationTruncation,
      { originalChars: toolObservationTruncation.originalChars, previewChars: toolObservationTruncation.previewChars },
      undefined,
    ];
    const rawRows = db.prepare<[], { payload_json: string }>(
      'SELECT payload_json FROM conversation_ui_messages ORDER BY sort_seq',
    ).all();
    expect(rawRows.map(row => ConversationToolMessagePayloadSchema.parse(
      JSON.parse(row.payload_json),
    ).observation_truncation)).toEqual(expected);

    const durable = readMessages(db);
    const reloaded = durable.map(message => mapUiMessageDtoToConversationMessage(message));
    expect(live.state.conversation.messages.map(message => {
      if (message.type !== 'tool_calls') throw new Error('Expected tool message');
      return message.metadata.observation_truncation;
    })).toEqual(expected);
    for (const [index, message] of reloaded.entries()) {
      const liveMessage = live.state.conversation.messages[index];
      if (message.type !== 'tool_calls' || liveMessage?.type !== 'tool_calls') {
        throw new Error('Expected matching tool messages');
      }
      const { execution_id: executionId, ...liveMetadata } = liveMessage.metadata;
      const { merge_key: mergeKey, ...durableMetadata } = message.metadata;
      expect(executionId).toBeTypeOf('string');
      expect(mergeKey).toBe(message.id);
      expect(durableMetadata).toEqual(liveMetadata);
      expect(message.content).toBe(liveMessage.content);
      expect(message.metadata.observation_truncation).toEqual(expected[index]);
    }

    // 模拟升级前丢字段的 disposable row；缺省仍可读，只有原始事实能恢复已知计量。
    db.exec("UPDATE conversation_ui_messages SET payload_json = json_remove(payload_json, '$.observation_truncation')");
    expect(readMessages(db).every(message => message.message_type === 'tool_calls'
      && message.payload.observation_truncation === undefined)).toBe(true);
    expect(rebuildConversationUiProjection(db, conversationId, { force: true }).status).toBe('rebuilt');
    expect(readMessages(db)).toEqual(durable);
    expect((await store.readEvents(conversationId)).events).toEqual(persisted.events);
  });

  it.each(malformedTruncations)(
    'rejects malformed truncation %j before durable or live tool state can change',
    async observationTruncation => {
      const { db, store, session } = await createStore();
      const live = createLiveProjection();
      const decision = toolObservationTruncationFixture.events[0];
      if (!decision) throw new Error('Expected tool decision');
      await store.appendEventToRun(session, parseRoutedRuntimeEvent(decision));
      expect(reduceEvent(live.state, live.mapEvent(decision)).success).toBe(true);
      const previousLive = live.state.conversation.messages[0];
      const previousDurable = readMessages(db);
      const malformed = routeRuntimeEvent(createToolOutputEvent(
        'malformed_truncation', conversationId, decision.turn_id, 'read_file', 'call_truncated',
        { status: 'error', error: '读取失败', observation: '截断前缀' },
        { timestamp: 801, metadata: { observationTruncation } },
      ), { run_id: runId, lane: 'foreground', visibility: 'conversation' });

      await expect(store.appendEventToRun(session, malformed)).rejects.toThrow();
      expect((await store.readEvents(conversationId)).events).toEqual([decision]);
      expect(readMessages(db)).toEqual(previousDurable);
      expect(reduceEvent(live.state, live.mapEvent(malformed)).success).toBe(false);
      expect(live.state.conversation.messages[0]).toBe(previousLive);
    },
  );
});
