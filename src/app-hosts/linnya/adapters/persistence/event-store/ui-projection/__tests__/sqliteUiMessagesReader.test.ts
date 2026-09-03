import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  createSubRunTraceEvent,
  createToolOutputEvent,
  RunIdSchema,
  ToolCallIdSchema,
} from '@linnlabs/linnkit/contracts';
import {
  conversationMessageIdFromToolIdentity,
  type ConversationAttachmentRef,
} from '@app/schemas';
import { CONVERSATION_SCHEMAS } from '../../conversation.schema';
import {
  readAfter,
  readAround,
  readBefore,
  readRunFinalAnswer,
  readSubrunTrace,
  readTail,
  readTurnIndex,
} from '../sqliteUiMessagesReader';
import { SqliteSubrunTraceHistoryProjector } from '../../../subrun-trace-history/sqliteSubrunTraceHistoryProjector';
import { SqliteConversationCitationFactIndex } from '../sqliteCitationFactIndex';

interface TestMessageSeed {
  readonly messageId: string;
  readonly sortSeq: number;
  readonly messageType?: string;
  readonly content?: string | null;
  readonly presentation?: string | null;
  readonly attachments?: readonly ConversationAttachmentRef[];
  readonly runId?: string;
  readonly turnId?: string;
}

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE assets (id TEXT PRIMARY KEY);
  `);
  for (const schema of CONVERSATION_SCHEMAS) {
    db.exec(schema);
  }
  return db;
}

function seedConversation(db: Database.Database, conversationId: string): void {
  db.prepare(
    `
    INSERT INTO conversations (
      conversation_id,
      title,
      created_at,
      last_event_at,
      total_events,
      user_message_count
    )
    VALUES (?, 'conversation', 1, 1, 0, 0)
  `
  ).run(conversationId);
}

function seedProjectionState(
  db: Database.Database,
  conversationId: string,
  status: 'pending' | 'ready',
  revision: number
): void {
  db.prepare(
    `
    INSERT INTO conversation_ui_projection_state (
      conversation_id,
      status,
      revision,
      last_event_rowid,
      rebuilt_at
    )
    VALUES (?, ?, ?, 0, 1)
  `
  ).run(conversationId, status, revision);
}

function seedMessage(db: Database.Database, conversationId: string, seed: TestMessageSeed): void {
  const messageType = seed.messageType ?? 'final_answer';
  const payloadJson =
    messageType === 'user_input'
      ? null
      : JSON.stringify({
          answer_id: seed.messageId,
          is_complete: true,
          completion_reason: 'terminal',
          first_token_at: seed.sortSeq * 100,
        });
  db.prepare(
    `
    INSERT INTO conversation_ui_messages (
      message_id,
      conversation_id,
      turn_id,
      role,
      message_type,
      sort_seq,
      timestamp,
      content,
      attachments_json,
      payload_json,
      merge_key,
      presentation,
      run_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    seed.messageId,
    conversationId,
    seed.turnId ?? `turn-${seed.messageId}`,
    messageType === 'user_input' ? 'user' : 'assistant',
    messageType,
    seed.sortSeq,
    seed.sortSeq * 100,
    seed.content ?? seed.messageId,
    seed.attachments ? JSON.stringify(seed.attachments) : null,
    payloadJson,
    null,
    seed.presentation ?? null,
    seed.runId ?? 'run-reader'
  );
}

function seedWebSearchToolMessage(params: {
  readonly db: Database.Database;
  readonly conversationId: string;
  readonly messageId: string;
  readonly turnId: string;
  readonly sortSeq: number;
  readonly ref: string;
  readonly url: string;
}): void {
  const query = `query-${params.ref}`;
  const citation = {
    sourceType: 'web',
    ref: params.ref,
    index: 1,
    url: params.url,
    docTitle: `title-${params.ref}`,
    snippet: `snippet-${params.ref}`,
  } as const;
  const toolCallId = `call-${params.ref}`;
  const runId = 'run-reader';
  params.db
    .prepare(
      `
    INSERT INTO conversation_ui_messages (
      message_id, conversation_id, turn_id, role, message_type, sort_seq, timestamp,
      content, attachments_json, payload_json, merge_key, presentation, run_id
    ) VALUES (?, ?, ?, 'assistant', 'tool_calls', ?, ?, ?, NULL, ?, ?, NULL, ?)
  `
    )
    .run(
      conversationMessageIdFromToolIdentity(runId, toolCallId),
      params.conversationId,
      params.turnId,
      params.sortSeq,
      params.sortSeq * 100,
      'web search observation',
      JSON.stringify({
        tool_call_id: toolCallId,
        tool_name: 'web_search',
        status: 'success',
        phase: 'complete',
        args: { query, top_k: 10 },
        data: {
          query,
          resultCount: 1,
          citations: { query, searchMode: 'web', citations: [citation] },
          evidence_store: { bundle_id: `bundle-${params.ref}` },
          cacheStatus: 'miss',
        },
        started_at: params.sortSeq * 100 - 10,
        completed_at: params.sortSeq * 100,
      }),
      `tool:${params.ref}`,
      runId
    );
  const event = createToolOutputEvent(
    params.messageId,
    params.conversationId,
    params.turnId,
    'web_search',
    toolCallId,
    {
      status: 'success',
      observation: 'web search observation',
      data: {
        query,
        resultCount: 1,
        citations: { query, searchMode: 'web', citations: [citation] },
        evidence_store: { bundle_id: `bundle-${params.ref}` },
        cacheStatus: 'miss',
      },
    },
    {
      timestamp: params.sortSeq * 100,
      run_id: RunIdSchema.parse(runId),
      lane: 'foreground',
      visibility: 'conversation',
    }
  );
  new SqliteConversationCitationFactIndex(params.db).projectMainToolOutput(event, runId);
}

function seedSubrunParentToolMessage(
  db: Database.Database,
  conversationId: string,
  toolCallId: string,
  sortSeq: number
): void {
  db.prepare(
    `
    INSERT INTO conversation_ui_messages (
      message_id, conversation_id, turn_id, role, message_type, sort_seq, timestamp,
      content, attachments_json, payload_json, merge_key, presentation, run_id
    ) VALUES (?, ?, 'turn-parent', 'assistant', 'tool_calls', ?, ?, ?, NULL, ?, ?, NULL, 'run-reader')
  `
  ).run(
    conversationMessageIdFromToolIdentity('run-reader', toolCallId),
    conversationId,
    sortSeq,
    sortSeq * 100,
    'subrun completed',
    JSON.stringify({
      tool_call_id: toolCallId,
      tool_name: 'subagent',
      status: 'success',
      phase: 'complete',
      data: { status: 'completed' },
      started_at: sortSeq * 100 - 10,
      completed_at: sortSeq * 100,
    }),
    `tool:${toolCallId}`
  );
}

function seedMessages(db: Database.Database, conversationId: string): void {
  seedMessage(db, conversationId, {
    messageId: 'm1',
    sortSeq: 1,
    messageType: 'user_input',
    content: 'first user message',
  });
  seedMessage(db, conversationId, { messageId: 'm2', sortSeq: 2 });
  seedMessage(db, conversationId, {
    messageId: 'm3',
    sortSeq: 3,
    messageType: 'user_input',
    content: 'second user message',
  });
  seedMessage(db, conversationId, { messageId: 'm4', sortSeq: 4 });
  seedMessage(db, conversationId, {
    messageId: 'm5-hidden',
    sortSeq: 5,
    presentation: 'hidden',
  });
  seedMessage(db, conversationId, { messageId: 'm6', sortSeq: 6 });
}

describe('sqlite UI messages reader', () => {
  it('按目标 run 读取 final_answer，不使用会话最后一条回答猜结果', () => {
    const db = createDb();
    const conversationId = 'conv-reader-run-result';
    seedConversation(db, conversationId);
    seedProjectionState(db, conversationId, 'ready', 3);
    seedMessage(db, conversationId, {
      messageId: 'answer-target',
      sortSeq: 1,
      runId: 'run-target',
    });
    seedMessage(db, conversationId, {
      messageId: 'answer-later-other-run',
      sortSeq: 2,
      runId: 'run-other',
    });

    expect(readRunFinalAnswer(db, conversationId, 'run-target')).toMatchObject({
      status: 'ready',
      message: { message_id: 'answer-target', run_id: 'run-target' },
    });
    expect(readRunFinalAnswer(db, conversationId, 'run-missing')).toEqual({
      status: 'ready',
      conversation_id: conversationId,
      message: null,
    });
    db.close();
  });

  it('reads tail/before/after windows in old-to-new order and skips hidden rows', () => {
    const db = createDb();
    const conversationId = 'conv-reader-window';
    seedConversation(db, conversationId);
    seedProjectionState(db, conversationId, 'ready', 11);
    seedMessages(db, conversationId);

    const tail = readTail(db, conversationId, 3);
    expect(tail).toMatchObject({
      status: 'ready',
      conversation_id: conversationId,
      has_more_before: true,
      has_more_after: false,
      prev_cursor: 3,
      next_cursor: 6,
      revision: 11,
    });
    expect(tail.status === 'ready' ? tail.messages.map(message => message.message_id) : []).toEqual(
      ['m3', 'm4', 'm6']
    );

    const before = readBefore(db, conversationId, 6, 2);
    expect(before).toMatchObject({
      status: 'ready',
      has_more_before: true,
      has_more_after: true,
      prev_cursor: 3,
      next_cursor: 4,
    });
    expect(
      before.status === 'ready' ? before.messages.map(message => message.message_id) : []
    ).toEqual(['m3', 'm4']);

    const after = readAfter(db, conversationId, 2, 2);
    expect(after).toMatchObject({
      status: 'ready',
      has_more_before: true,
      has_more_after: true,
      prev_cursor: 3,
      next_cursor: 4,
    });
    expect(
      after.status === 'ready' ? after.messages.map(message => message.message_id) : []
    ).toEqual(['m3', 'm4']);

    db.close();
  });

  it('窗口只返回答案行时仍携带 main 与 child tool 的引用依赖闭包', () => {
    const db = createDb();
    const conversationId = 'conv-reader-citation-closure';
    seedConversation(db, conversationId);
    seedProjectionState(db, conversationId, 'ready', 9);
    seedWebSearchToolMessage({
      db,
      conversationId,
      messageId: 'main-search',
      turnId: 'turn-main-source',
      sortSeq: 1,
      ref: 'Ab3Def',
      url: 'https://example.com/main',
    });
    seedSubrunParentToolMessage(db, conversationId, 'parent-call', 2);

    const childQuery = 'child query';
    const childTrace = createSubRunTraceEvent(
      'subrun-citation-trace',
      conversationId,
      'turn-child-source',
      'parent-call',
      'subrun-citation',
      'tool_output',
      {
        source_event_id: 'child-web-search-output',
        timestamp: 200,
        run_id: RunIdSchema.parse('run-reader'),
        tool_name: 'web_search',
        tool_call_id: ToolCallIdSchema.parse('child-web-call'),
        status: 'success',
        output: {
          data: {
            query: childQuery,
            resultCount: 1,
            citations: {
              query: childQuery,
              searchMode: 'web',
              citations: [
                {
                  sourceType: 'web',
                  ref: 'Gh4Jkm',
                  index: 1,
                  url: 'https://example.com/child',
                  docTitle: 'child title',
                  snippet: 'child snippet',
                },
              ],
            },
            evidence_store: { bundle_id: 'bundle-child' },
            cacheStatus: 'miss',
          },
          observation: 'child search observation',
        },
      }
    );
    const nestedQuery = 'nested child query';
    const nestedChildTrace = createSubRunTraceEvent(
      'nested-subrun-citation-trace',
      conversationId,
      'turn-nested-source',
      'nested-parent-call',
      'nested-subrun-citation',
      'tool_output',
      {
        source_event_id: 'nested-child-web-search-output',
        timestamp: 250,
        run_id: RunIdSchema.parse('run-child'),
        subrun_parent_id: 'subrun-citation',
        tool_name: 'web_search',
        tool_call_id: ToolCallIdSchema.parse('nested-child-web-call'),
        status: 'success',
        output: {
          data: {
            query: nestedQuery,
            resultCount: 1,
            citations: {
              query: nestedQuery,
              searchMode: 'web',
              citations: [
                {
                  sourceType: 'web',
                  ref: 'Lm6Tuv',
                  index: 1,
                  url: 'https://example.com/nested-child',
                  docTitle: 'nested child title',
                  snippet: 'nested child snippet',
                },
              ],
            },
            evidence_store: { bundle_id: 'bundle-nested-child' },
            cacheStatus: 'miss',
          },
          observation: 'nested child search observation',
        },
      }
    );
    const subrunProjector = new SqliteSubrunTraceHistoryProjector(db);
    subrunProjector.project(childTrace);
    subrunProjector.project(nestedChildTrace);
    seedMessage(db, conversationId, {
      messageId: 'answer-window',
      turnId: 'turn-answer',
      sortSeq: 3,
      content: 'main [@Ab3Def] child [@Gh4Jkm] nested [@Lm6Tuv] missing [@Np5Qrs]',
    });

    const result = readTail(db, conversationId, 1);
    if (result.status !== 'ready') throw new Error('Expected ready citation window');
    expect(result.revision).toBe(11);
    expect(result.messages.map(message => message.message_id)).toEqual(['answer-window']);
    expect(result.citation_dependencies['answer-window']).toEqual({
      citations: [
        expect.objectContaining({ ref: 'Ab3Def', url: 'https://example.com/main' }),
        expect.objectContaining({ ref: 'Gh4Jkm', url: 'https://example.com/child' }),
        expect.objectContaining({ ref: 'Lm6Tuv', url: 'https://example.com/nested-child' }),
      ],
      unresolved_refs: ['Np5Qrs'],
    });
    db.close();
  });

  it('不会让答案之后才出现的 citation 反向改变历史消息含义', () => {
    const db = createDb();
    const conversationId = 'conv-reader-citation-as-of-message';
    seedConversation(db, conversationId);
    seedProjectionState(db, conversationId, 'ready', 3);
    seedMessage(db, conversationId, {
      messageId: 'answer-before-source',
      turnId: 'turn-same-scope',
      sortSeq: 1,
      content: 'future ref [@Ab3Def]',
    });
    seedWebSearchToolMessage({
      db,
      conversationId,
      messageId: 'future-search',
      turnId: 'turn-same-scope',
      sortSeq: 2,
      ref: 'Ab3Def',
      url: 'https://example.com/future',
    });

    const result = readAround(db, conversationId, 'answer-before-source', 1);
    if (result.status !== 'ready') throw new Error('Expected ready citation window');
    expect(result.citation_dependencies['answer-before-source']).toEqual({
      citations: [],
      unresolved_refs: ['Ab3Def'],
    });
    db.close();
  });

  it('returns ordered durable attachments from the explicit projection column', () => {
    const db = createDb();
    const conversationId = 'conv-reader-attachments';
    const attachments: readonly ConversationAttachmentRef[] = [
      {
        id: 'attachment-reader',
        kind: 'image',
        assetId: 'asset-reader',
        mediaType: 'image/png',
        byteLength: 128,
        width: 16,
        height: 8,
        sha256: 'c'.repeat(64),
        fileName: 'reader.png',
      },
    ];
    seedConversation(db, conversationId);
    seedProjectionState(db, conversationId, 'ready', 1);
    seedMessage(db, conversationId, {
      messageId: 'message-reader-attachments',
      sortSeq: 1,
      messageType: 'user_input',
      attachments,
    });

    const result = readTail(db, conversationId, 10);
    expect(result.status === 'ready' ? result.messages[0]?.attachments : undefined).toEqual(
      attachments
    );
    db.close();
  });

  it('reads around an anchor and reports missing anchors explicitly', () => {
    const db = createDb();
    const conversationId = 'conv-reader-around';
    seedConversation(db, conversationId);
    seedProjectionState(db, conversationId, 'ready', 3);
    seedMessages(db, conversationId);

    const around = readAround(db, conversationId, 'm3', 3);
    expect(around).toMatchObject({
      status: 'ready',
      has_more_before: true,
      has_more_after: true,
      prev_cursor: 2,
      next_cursor: 4,
    });
    expect(
      around.status === 'ready' ? around.messages.map(message => message.message_id) : []
    ).toEqual(['m2', 'm3', 'm4']);

    expect(readAround(db, conversationId, 'missing', 3)).toEqual({
      status: 'anchor-not-found',
      conversation_id: conversationId,
      anchor_message_id: 'missing',
    });

    db.close();
  });

  it('returns ready empty windows and preparing state without inventing rows', () => {
    const db = createDb();
    const readyConversationId = 'conv-reader-empty';
    const pendingConversationId = 'conv-reader-pending';
    seedConversation(db, readyConversationId);
    seedProjectionState(db, readyConversationId, 'ready', 9);
    seedConversation(db, pendingConversationId);
    seedProjectionState(db, pendingConversationId, 'pending', 2);

    expect(readTail(db, readyConversationId, 80)).toEqual({
      status: 'ready',
      conversation_id: readyConversationId,
      messages: [],
      citation_dependencies: {},
      has_more_before: false,
      has_more_after: false,
      revision: 9,
    });
    expect(readTail(db, pendingConversationId, 80)).toEqual({
      status: 'preparing',
      conversation_id: pendingConversationId,
    });

    db.close();
  });

  it('builds turn index from visible user messages with real projection revision', () => {
    const db = createDb();
    const conversationId = 'conv-reader-turns';
    seedConversation(db, conversationId);
    seedProjectionState(db, conversationId, 'ready', 21);
    seedMessage(db, conversationId, {
      messageId: 'user-1',
      sortSeq: 1,
      messageType: 'user_input',
      content: 'a'.repeat(121),
    });
    seedMessage(db, conversationId, { messageId: 'answer-1', sortSeq: 2 });
    seedMessage(db, conversationId, {
      messageId: 'user-hidden',
      sortSeq: 3,
      messageType: 'user_input',
      content: 'hidden',
      presentation: 'hidden',
    });
    seedMessage(db, conversationId, {
      messageId: 'user-2',
      sortSeq: 4,
      messageType: 'user_input',
      content: 'second',
    });

    expect(readTurnIndex(db, conversationId)).toEqual({
      status: 'ready',
      conversation_id: conversationId,
      revision: 21,
      turns: [
        {
          visual_turn_id: 'visual_turn_user-1',
          ordinal: 1,
          summary: 'a'.repeat(120),
          anchor_message_id: 'user-1',
          sort_seq: 1,
        },
        {
          visual_turn_id: 'visual_turn_user-2',
          ordinal: 2,
          summary: 'second',
          anchor_message_id: 'user-2',
          sort_seq: 4,
        },
      ],
    });

    db.close();
  });

  it('按 parent + subrun 读取紧凑历史，并且不保存实时 chunk 或兄弟 subrun', () => {
    const db = createDb();
    const conversationId = 'conv-reader-subrun';
    seedConversation(db, conversationId);
    seedProjectionState(db, conversationId, 'ready', 5);
    const projector = new SqliteSubrunTraceHistoryProjector(db);

    const first = createSubRunTraceEvent(
      'subrun-event-1',
      conversationId,
      'turn-subrun',
      'parent-call',
      'subrun-a',
      'tool_call_decision',
      {
        source_event_id: 'child-process-1',
        timestamp: 10,
        tool_calls: [
          {
            tool_name: 'child_tool',
            tool_call_id: ToolCallIdSchema.parse('child-call-1'),
            args: {},
          },
        ],
      }
    );
    const second = createSubRunTraceEvent(
      'subrun-event-2',
      conversationId,
      'turn-subrun',
      'parent-call',
      'subrun-a',
      'tool_output',
      {
        source_event_id: 'child-output-1',
        timestamp: 11,
        tool_name: 'child_tool',
        tool_call_id: ToolCallIdSchema.parse('child-call-1'),
        status: 'success',
        output: 'step 2',
      }
    );
    const noisyDelta = createSubRunTraceEvent(
      'subrun-event-delta',
      conversationId,
      'turn-subrun',
      'parent-call',
      'subrun-a',
      'thought_delta',
      { source_event_id: 'child-thought-delta', timestamp: 12, delta: 'typing noise' }
    );
    const sibling = createSubRunTraceEvent(
      'subrun-event-other-parent',
      conversationId,
      'turn-subrun',
      'parent-call',
      'subrun-b',
      'tool_output',
      {
        source_event_id: 'sibling-child-output',
        timestamp: 13,
        tool_name: 'sibling_tool',
        tool_call_id: ToolCallIdSchema.parse('sibling-call'),
        status: 'success',
        output: 'sibling',
      }
    );

    for (const event of [first, second, noisyDelta, sibling]) projector.project(event);

    expect(
      db.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'subrun_trace'").get()
    ).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM subrun_trace_items').get()).toEqual({
      count: 3,
    });

    const result = readSubrunTrace(db, conversationId, 'parent-call', 'subrun-a', {
      kinds: ['tool_call_decision', 'tool_output'],
      limit: 1,
    });
    expect(result).toMatchObject({
      status: 'ready',
      conversation_id: conversationId,
      parent_tool_call_id: 'parent-call',
      subrun_id: 'subrun-a',
    });
    expect(
      result.status === 'ready' ? result.events.map(event => event.source_event_id) : []
    ).toEqual(['child-process-1']);
    expect(result.status === 'ready' ? result.next_cursor : null).toEqual(expect.any(Number));

    const nextCursor = result.status === 'ready' ? result.next_cursor : null;
    if (nextCursor === null) {
      throw new Error('expected cursor for second subrun trace page');
    }
    const secondPage = readSubrunTrace(db, conversationId, 'parent-call', 'subrun-a', {
      kinds: ['tool_call_decision', 'tool_output'],
      limit: 1,
      cursor: nextCursor,
    });
    expect(
      secondPage.status === 'ready' ? secondPage.events.map(event => event.source_event_id) : []
    ).toEqual(['child-output-1']);
    expect(secondPage.status === 'ready' ? secondPage.next_cursor : 'not-ready').toBeNull();

    const siblingResult = readSubrunTrace(db, conversationId, 'parent-call', 'subrun-b');
    expect(
      siblingResult.status === 'ready'
        ? siblingResult.events.map(event => event.source_event_id)
        : []
    ).toEqual(['sibling-child-output']);

    db.close();
  });
});
