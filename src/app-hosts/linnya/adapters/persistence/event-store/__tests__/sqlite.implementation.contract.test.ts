import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  createFinalAnswerEvent,
  createRunExecutionMetricsEvent,
  createThoughtEvent,
  createToolCallDecisionEvent,
  createToolOutputEvent,
  createToolProcessEvent,
  createUserInputEvent,
  routeRuntimeEvent,
  type RoutedRuntimeEvent,
  type RuntimeEvent,
  type RuntimeResourceRef,
  type UserInputEvent,
  RunIdSchema,
} from '@linnlabs/linnkit/contracts';
import { CONVERSATION_SCHEMAS } from '../conversation.schema';
import {
  ConversationSelectedAgentIdSchema,
  conversationMessageIdFromToolIdentity,
} from '@app/schemas';
import { SQLiteEventStore } from '../sqlite.implementation';
import { purgeStaleAuditEvents } from '..';
import type { RunSession } from '../event-store.interface';
import { rebuildConversationUiProjection } from '../ui-projection/rebuildConversation';
import { readAround } from '../ui-projection/sqliteUiMessagesReader';

interface CountRow {
  count: number;
}

interface RunRow {
  id: string;
  kind: string;
  status: string;
  model_key: string | null;
  toolset_version: string | null;
  start_ts: number;
  end_ts: number | null;
}

interface ConversationRow {
  conversation_id: string;
  title: string;
  last_event_at?: number;
  preview_text: string | null;
  total_events: number;
  user_message_count: number;
}

interface UiMessageRow {
  message_id: string;
  conversation_id: string;
  message_type: string;
  sort_seq: number;
  content: string | null;
  attachments_json: string | null;
  payload_json: string | null;
  presentation: string | null;
  run_id: string;
}

interface UiProjectionStateRow {
  conversation_id: string;
  status: 'pending' | 'ready';
  revision: number;
}

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw ?? '{}');
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected JSON object');
  }
  return parsed as Record<string, unknown>;
}

function createStore(): { db: Database.Database; store: SQLiteEventStore } {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      uri TEXT NOT NULL UNIQUE,
      media_type TEXT,
      size_bytes INTEGER,
      width_px INTEGER,
      height_px INTEGER,
      sha256 TEXT,
      storage_status TEXT NOT NULL,
      local_path TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  for (const schema of CONVERSATION_SCHEMAS) {
    db.exec(schema);
  }
  return { db, store: new SQLiteEventStore(db) };
}

function countRows(db: Database.Database, tableName: 'runs' | 'events'): number {
  return (db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as CountRow).count;
}

function routeForSession(event: RuntimeEvent, session: RunSession): RoutedRuntimeEvent {
  return routeRuntimeEvent(event, {
    run_id: session.runId,
    lane: 'foreground',
    visibility: 'conversation',
  });
}

function routeChildForSession(
  event: RuntimeEvent,
  session: RunSession,
  parentRunId: string
): RoutedRuntimeEvent {
  return routeRuntimeEvent(event, {
    run_id: session.runId,
    parent_run_id: parentRunId,
    lane: 'child',
    visibility: 'parent-trace',
  });
}

function countUiMessages(db: Database.Database, conversationId: string): number {
  return (
    db
      .prepare('SELECT COUNT(*) as count FROM conversation_ui_messages WHERE conversation_id = ?')
      .get(conversationId) as CountRow
  ).count;
}

function countUiProjectionState(db: Database.Database, conversationId: string): number {
  return (
    db
      .prepare(
        'SELECT COUNT(*) as count FROM conversation_ui_projection_state WHERE conversation_id = ?'
      )
      .get(conversationId) as CountRow
  ).count;
}

function readUiMessages(db: Database.Database, conversationId: string): UiMessageRow[] {
  return db
    .prepare(
      `
      SELECT message_id, conversation_id, message_type, sort_seq, content,
             attachments_json, payload_json, presentation, run_id
      FROM conversation_ui_messages
      WHERE conversation_id = ?
      ORDER BY sort_seq ASC
    `
    )
    .all(conversationId) as UiMessageRow[];
}

function readUiProjectionState(
  db: Database.Database,
  conversationId: string
): UiProjectionStateRow {
  return db
    .prepare(
      'SELECT conversation_id, status, revision FROM conversation_ui_projection_state WHERE conversation_id = ?'
    )
    .get(conversationId) as UiProjectionStateRow;
}

function makeUserInput(
  id: string,
  conversationId: string,
  content: string,
  timestamp: number
): UserInputEvent {
  return createUserInputEvent(id, conversationId, `turn-${id}`, content, { timestamp });
}

function makeFinalAnswer(
  id: string,
  conversationId: string,
  content: string,
  timestamp: number
): RuntimeEvent {
  return createFinalAnswerEvent(`answer-${id}`, conversationId, `turn-${id}`, content, {
    timestamp,
    completion_reason: 'terminal',
  });
}

describe('SQLiteEventStore explicit run session contract', () => {
  it('audit maintenance only purges expired audit_envelope facts', () => {
    const { db, store } = createStore();
    db.prepare(`
      INSERT INTO conversations (conversation_id, created_at, last_event_at)
      VALUES (?, ?, ?)
    `).run('conv-audit-retention', 1, 1);
    db.prepare(`
      INSERT INTO runs (id, conversation_id, kind, status, start_ts)
      VALUES (?, ?, 'agent', 'completed', ?)
    `).run('run-audit-retention', 'conv-audit-retention', 1);
    db.prepare(`
      INSERT INTO events (id, run_id, type, payload, ts)
      VALUES (?, ?, ?, ?, ?)
    `).run('audit-old', 'run-audit-retention', 'audit_envelope', '{}', 100);
    db.prepare(`
      INSERT INTO events (id, run_id, type, payload, ts)
      VALUES (?, ?, ?, ?, ?)
    `).run('audit-new', 'run-audit-retention', 'audit_envelope', '{}', 900);
    db.prepare(`
      INSERT INTO events (id, run_id, type, payload, ts)
      VALUES (?, ?, ?, ?, ?)
    `).run('runtime-old', 'run-audit-retention', 'error', '{}', 100);

    expect(purgeStaleAuditEvents(db, { olderThanMs: 500, nowMs: 1_000 })).toBe(1);
    expect(db.prepare('SELECT id FROM events ORDER BY id').all()).toEqual([
      { id: 'audit-new' },
      { id: 'runtime-old' },
    ]);
    store.close();
  });

  it('fresh conversation schema has one event fact source and one UI history read model', () => {
    const { db, store } = createStore();
    const tables = db
      .prepare(
        `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name IN ('events', 'messages', 'conversation_ui_messages')
      ORDER BY name ASC
    `
      )
      .all();

    expect(tables).toEqual([{ name: 'conversation_ui_messages' }, { name: 'events' }]);
    store.close();
  });

  it('ensureConversation 只建存储骨架，不从首问复制标题业务规则', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-initial-title';
    const userInput = makeUserInput(
      'event-initial-title',
      conversationId,
      '  帮我规划\n东京三日游  ',
      1000
    );

    await store.ensureConversation(conversationId, [userInput], undefined, 'chat');

    const conversation = db
      .prepare('SELECT * FROM conversations WHERE conversation_id = ?')
      .get(conversationId) as ConversationRow;
    expect(conversation.title).toBe('New Chat');
    expect(conversation.preview_text).toBe('帮我规划\n东京三日游');
    store.close();
  });

  it('persists a run, raw events, UI history and conversation counters through an explicit runId', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-sqlite-contract';
    const userInput = makeUserInput('event-user-1', conversationId, 'hello world', 1000);
    const finalAnswer = makeFinalAnswer(
      'event-answer-1',
      conversationId,
      'final answer. second sentence',
      2000
    );
    const ephemeralThought = createThoughtEvent(
      'event-thought-ephemeral',
      conversationId,
      'turn-event-thought-ephemeral',
      'hidden thought',
      { ephemeral: true, timestamp: 1500 }
    );

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'turn-event-user-1', {
      kind: 'agent',
      model_key: 'model-a',
      toolset_version: 'tools-v1',
    });
    await store.appendEventToRun(session, routeForSession(userInput, session));
    await expect(
      store.appendEventToRun(session, routeForSession(ephemeralThought, session))
    ).rejects.toThrow('is not eligible for persistence');
    await store.appendEventToRun(session, routeForSession(finalAnswer, session));
    await store.completeRun(session);
    const runId = session.runId;

    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow;
    expect(run).toMatchObject({
      id: runId,
      kind: 'agent',
      status: 'completed',
      model_key: 'model-a',
      toolset_version: 'tools-v1',
    });
    expect(run.end_ts).toEqual(expect.any(Number));
    expect(run.end_ts).toBeGreaterThanOrEqual(run.start_ts);

    const rawEvents = await store.readEvents(conversationId, { direction: 'forward', limit: 10 });
    expect(rawEvents.events.map(event => event.id)).toEqual([
      'event-user-1',
      'answer-event-answer-1',
    ]);

    expect(
      readUiMessages(db, conversationId).map(message => ({
        id: message.message_id,
        run_id: message.run_id,
        seq: message.sort_seq,
        type: message.message_type,
        content: message.content,
      }))
    ).toEqual([
      {
        id: 'event-user-1',
        run_id: runId,
        seq: 1,
        type: 'user_input',
        content: 'hello world',
      },
      {
        id: 'answer-event-answer-1',
        run_id: runId,
        seq: 2,
        type: 'final_answer',
        content: 'final answer. second sentence',
      },
    ]);

    const conversation = db
      .prepare(
        'SELECT conversation_id, preview_text, total_events, user_message_count FROM conversations WHERE conversation_id = ?'
      )
      .get(conversationId) as ConversationRow;
    expect(conversation).toEqual({
      conversation_id: conversationId,
      preview_text: 'final answer.',
      total_events: 2,
      user_message_count: 1,
    });

    store.close();
  });

  it('readEvents 可在 SQL 层排除类型级永不 UI 回放事件，且默认保持事实读取无损', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-sqlite-exclude-types';
    const userInput = makeUserInput('event-user-exclude', conversationId, 'hello world', 1000);
    const finalAnswer = makeFinalAnswer(
      'event-answer-exclude',
      conversationId,
      'visible answer',
      2000
    );
    const auditEnvelope: RuntimeEvent = {
      type: 'audit_envelope',
      id: 'event-audit-exclude',
      conversation_id: conversationId,
      turn_id: 'turn-audit-exclude',
      timestamp: 1500,
      version: 1,
      envelope: {
        envelopeId: 'audit-exclude',
        runId: RunIdSchema.parse('run-exclude-types'),
        ts: 1500,
        actor: { kind: 'system' },
        action: 'context.manager.before',
        scope: {
          conversationId,
          runId: RunIdSchema.parse('run-exclude-types'),
          turnId: 'turn-audit-exclude',
        },
      },
    };

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-exclude-types', {
      kind: 'agent',
    });
    await store.appendEventToRun(session, routeForSession(userInput, session));
    const beforeAudit = db
      .prepare('SELECT total_events, last_event_at FROM conversations WHERE conversation_id = ?')
      .get(conversationId) as { total_events: number; last_event_at: number };
    const beforeAuditProjection = readUiProjectionState(db, conversationId);
    await store.appendEventToRun(session, routeForSession(auditEnvelope, session));
    expect(db
      .prepare('SELECT total_events, last_event_at FROM conversations WHERE conversation_id = ?')
      .get(conversationId)).toEqual(beforeAudit);
    expect(readUiProjectionState(db, conversationId)).toEqual(beforeAuditProjection);
    await store.appendEventToRun(session, routeForSession(finalAnswer, session));
    await store.completeRun(session);

    const rawEvents = await store.readEvents(conversationId, { direction: 'forward', limit: 10 });
    expect(rawEvents.events.map(event => event.type)).toEqual([
      'user_input',
      'audit_envelope',
      'final_answer',
    ]);

    const uiEvents = await store.readEvents(conversationId, {
      direction: 'forward',
      limit: 10,
      excludeTypes: ['audit_envelope'],
    });
    expect(uiEvents.events.map(event => event.type)).toEqual(['user_input', 'final_answer']);

    store.close();
  });

  it('readEvents 的 excludeTypes 在解析 payload 前生效', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-sqlite-exclude-before-parse';
    const userInput = makeUserInput('event-user-before-parse', conversationId, 'hello world', 1000);
    const finalAnswer = makeFinalAnswer(
      'event-answer-before-parse',
      conversationId,
      'visible answer',
      2000
    );

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-exclude-before-parse', {
      kind: 'agent',
    });
    await store.appendEventToRun(session, routeForSession(userInput, session));
    db.prepare(
      `
      INSERT INTO events (id, run_id, type, payload, ts, event_store_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      'event-audit-invalid-payload',
      session.runId,
      'audit_envelope',
      '{"type":"audit_envelope","payload":"intentionally incomplete"',
      1500,
      null
    );
    await store.appendEventToRun(session, routeForSession(finalAnswer, session));
    await store.completeRun(session);

    const uiEvents = await store.readEvents(conversationId, {
      direction: 'forward',
      limit: 10,
      excludeTypes: ['audit_envelope'],
    });
    expect(uiEvents.events.map(event => event.id)).toEqual([
      'event-user-before-parse',
      'answer-event-answer-before-parse',
    ]);

    store.close();
  });

  it('readEvents 默认读取与 foreground scope 都拒绝缺 routing identity 的 stored fact', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-read-rejects-unrouted';
    const userInput = makeUserInput(
      'event-read-rejects-unrouted',
      conversationId,
      'unrouted payload',
      1000
    );

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-read-rejects-unrouted', {
      kind: 'agent',
    });
    db.prepare(
      `
      INSERT INTO events (id, run_id, type, payload, ts)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(
      userInput.id,
      session.runId,
      userInput.type,
      JSON.stringify({
        content: userInput.content,
        source: userInput.source,
        version: userInput.version,
        turn_id: userInput.turn_id,
      }),
      userInput.timestamp
    );

    await expect(store.readEvents(conversationId, { direction: 'forward' })).rejects.toThrow();
    await expect(
      store.readEvents(conversationId, {
        direction: 'forward',
        routingScope: 'foreground-conversation',
      })
    ).rejects.toThrow();

    store.close();
  });

  it('readEvents 拒绝绕开 codec 在 payload 重复写入身份字段的 stored fact', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-read-rejects-owner-mismatch';
    const userInput = makeUserInput(
      'event-read-rejects-owner-mismatch',
      'conv-payload-owner-mismatch',
      'mismatched payload owner',
      1000
    );

    await store.ensureConversation(conversationId, [], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-read-rejects-owner-mismatch', {
      kind: 'agent',
    });
    const routed = routeRuntimeEvent(userInput, {
      run_id: session.runId,
      lane: 'foreground',
      visibility: 'conversation',
    });
    db.prepare(
      `
      INSERT INTO events (id, run_id, type, payload, ts)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(routed.id, session.runId, routed.type, JSON.stringify(routed), routed.timestamp);

    await expect(store.readEvents(conversationId, { direction: 'forward' })).rejects.toThrow(
      'payload must not contain identity field id'
    );

    store.close();
  });

  it('keeps explicit run rows separate when an append hits an existing event id', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-sqlite-rollback';
    const firstEvent = makeUserInput('event-existing', conversationId, 'first', 1000);
    const newEventBeforeConflict = makeUserInput(
      'event-before-conflict',
      conversationId,
      'must rollback',
      2000
    );

    await store.ensureConversation(conversationId, [firstEvent], undefined, 'chat');
    const firstSession = await store.beginRunSession(conversationId, 'turn-existing', {
      kind: 'user_input',
    });
    await store.appendEventToRun(firstSession, routeForSession(firstEvent, firstSession));
    await store.completeRun(firstSession);

    const secondSession = await store.beginRunSession(conversationId, 'turn-conflict', {
      kind: 'agent',
    });
    await store.appendEventToRun(
      secondSession,
      routeForSession(newEventBeforeConflict, secondSession)
    );
    await expect(
      store.appendEventToRun(secondSession, routeForSession(firstEvent, secondSession))
    ).rejects.toThrow();
    await store.failRun(secondSession, { code: 'APPEND_ERROR', message: 'duplicate event' });

    expect({
      runs: countRows(db, 'runs'),
      events: countRows(db, 'events'),
      uiMessages: countUiMessages(db, conversationId),
    }).toEqual({
      runs: 2,
      events: 2,
      uiMessages: 2,
    });

    const failedRun = db
      .prepare('SELECT * FROM runs WHERE id = ?')
      .get(secondSession.runId) as RunRow;
    expect(failedRun.kind).toBe('agent');
    expect(failedRun.end_ts).toEqual(expect.any(Number));

    const rawEvents = await store.readEvents(conversationId, { direction: 'forward', limit: 10 });
    expect(rawEvents.events.map(event => event.id)).toEqual([
      'event-existing',
      'event-before-conflict',
    ]);

    store.close();
  });

  it('rejects a mismatched routed run before facts, UI history or stats can change', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-run-identity-gate';
    const seed = makeUserInput('event-run-identity-seed', conversationId, 'seed', 1000);
    await store.ensureConversation(conversationId, [seed], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-identity-owner', {
      kind: 'agent',
    });
    const mismatched = routeRuntimeEvent(seed, {
      run_id: 'run-identity-other',
      lane: 'foreground',
      visibility: 'conversation',
    });

    await expect(store.appendEventToRun(session, mismatched)).rejects.toThrow(
      'belongs to run run-identity-other'
    );

    expect(countRows(db, 'events')).toBe(0);
    expect(countUiMessages(db, conversationId)).toBe(0);
    expect(
      db
        .prepare(
          `
      SELECT total_events, user_message_count
      FROM conversations
      WHERE conversation_id = ?
    `
        )
        .get(conversationId)
    ).toEqual({ total_events: 0, user_message_count: 0 });
    store.close();
  });

  it('rejects a mismatched parent run before facts, UI history or stats can change', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-parent-identity-gate';
    const seed = makeUserInput('event-parent-identity-seed', conversationId, 'seed', 1000);
    await store.ensureConversation(conversationId, [seed], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-parent-identity-child', {
      kind: 'agent',
    });
    db.prepare('UPDATE runs SET parent_run_id = ? WHERE id = ?').run(
      'run-parent-identity-owner',
      session.runId
    );
    const mismatched = routeRuntimeEvent(seed, {
      run_id: session.runId,
      parent_run_id: 'run-parent-identity-other',
      lane: 'child',
      visibility: 'parent-trace',
    });

    await expect(store.appendEventToRun(session, mismatched)).rejects.toThrow(
      'but run run-parent-identity-child declares run-parent-identity-owner'
    );

    expect(countRows(db, 'events')).toBe(0);
    expect(countUiMessages(db, conversationId)).toBe(0);
    store.close();
  });
});

describe('SQLiteEventStore B3a.5 write session API', () => {
  it('beginRunSession creates a running run and completeRun marks it completed', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-session-complete';
    const userInput = makeUserInput('event-session-complete-user', conversationId, 'hello', 1000);

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'turn-session-complete', {
      kind: 'agent',
      model_key: 'model-b',
      toolset_version: 'tools-v2',
    });

    expect(session.conversationId).toBe(conversationId);
    expect(session.runId).toBe('turn-session-complete');
    expect(session.startedAt).toEqual(expect.any(Number));

    const runningRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(session.runId) as RunRow;
    expect(runningRun).toMatchObject({
      id: session.runId,
      kind: 'agent',
      status: 'running',
      model_key: 'model-b',
      toolset_version: 'tools-v2',
      end_ts: null,
    });

    await store.completeRun(session);

    const completedRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(session.runId) as RunRow;
    expect(completedRun.status).toBe('completed');
    expect(completedRun.end_ts).toEqual(expect.any(Number));
    expect(completedRun.end_ts).toBeGreaterThanOrEqual(completedRun.start_ts);

    store.close();
  });

  it('appendEventToRun writes facts, projects UI history, and updates conversation stats incrementally', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-session-append';
    const userInput = makeUserInput('event-session-user', conversationId, 'question one', 1000);
    const answer = makeFinalAnswer('event-session-answer', conversationId, 'answer one', 2000);

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'turn-session-append', {
      kind: 'agent',
    });

    await store.appendEventToRun(session, routeForSession(userInput, session));
    await store.appendEventToRun(session, routeForSession(answer, session));

    expect(countRows(db, 'events')).toBe(2);

    expect(
      readUiMessages(db, conversationId).map(message => ({
        id: message.message_id,
        seq: message.sort_seq,
        type: message.message_type,
      }))
    ).toEqual([
      { id: 'event-session-user', seq: 1, type: 'user_input' },
      { id: 'answer-event-session-answer', seq: 2, type: 'final_answer' },
    ]);

    const conversation = db
      .prepare(
        'SELECT conversation_id, preview_text, total_events, user_message_count FROM conversations WHERE conversation_id = ?'
      )
      .get(conversationId) as ConversationRow;
    expect(conversation).toEqual({
      conversation_id: conversationId,
      preview_text: 'answer one',
      total_events: 2,
      user_message_count: 1,
    });

    store.close();
  });

  it('appendEventToRun maintains UI projection rows in the same transaction and uses session runId as fact source', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-ui-projection-append';
    const userInput = createUserInputEvent(
      'event-ui-user',
      conversationId,
      'turn-event-ui-user',
      'question for ui model',
      {
        timestamp: 1000,
        metadata: {
          user_quote: {
            items: [
              {
                quote_id: 'reference-11111111111111111111111111111111',
                plugin_id: 'platform',
                kind: 'text-selection',
                text: 'quoted text',
              },
            ],
          },
        },
      }
    );
    const answer = makeFinalAnswer('event-ui-answer', conversationId, 'answer for ui model', 2000);
    const executionMetrics = createRunExecutionMetricsEvent(
      'event-ui-metrics',
      conversationId,
      userInput.turn_id,
      {
        timestamp: 2500,
        execution_id: 'execution-ui-projection-append',
        outcome: 'completed',
        duration_ms: 120,
        user_message_id: userInput.id,
        context_usage: {
          basis: 'last_completed_llm_prompt',
          budget_model_id: 'primary-model',
          used_tokens: 900,
          components: {
            system_prompt_tokens: 200,
            conversation_tokens: 600,
            tool_definition_tokens: 100,
          },
          component_attribution: 'normalized_local_estimate',
          input_budget_tokens: 1_000,
          remaining_tokens: 100,
          output_limit_tokens: 200,
          source: 'provider-preflight-count',
          confidence: 'provider-estimate',
          measured_at: 2_490,
        },
      }
    );

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-ui-projection-append', {
      kind: 'agent',
    });
    await store.appendEventToRun(session, routeForSession(userInput, session));
    await store.appendEventToRun(session, routeForSession(answer, session));
    await store.appendEventToRun(session, routeForSession(executionMetrics, session));

    const uiRows = readUiMessages(db, conversationId);
    expect(
      uiRows.map(row => ({
        message_id: row.message_id,
        message_type: row.message_type,
        content: row.content,
        run_id: row.run_id,
      }))
    ).toEqual([
      {
        message_id: userInput.id,
        message_type: 'user_input',
        content: 'question for ui model',
        run_id: session.runId,
      },
      {
        message_id: answer.id,
        message_type: 'final_answer',
        content: 'answer for ui model',
        run_id: session.runId,
      },
    ]);
    const userPayload = parseJsonRecord(uiRows[0]?.payload_json);
    expect(userPayload.agent_work).toEqual({
      duration_ms: 120,
      ended_at: 2500,
      outcome: 'completed',
    });
    expect(userPayload.context_usage).toEqual({
      budget_model_id: 'primary-model',
      used_tokens: 900,
      components: {
        system_prompt_tokens: 200,
        conversation_tokens: 600,
        tool_definition_tokens: 100,
      },
      input_budget_tokens: 1_000,
      remaining_tokens: 100,
      output_limit_tokens: 200,
      source: 'provider-preflight-count',
      confidence: 'provider-estimate',
    });
    expect(userPayload.user_quote).toEqual({
      items: [
        {
          quote_id: 'reference-11111111111111111111111111111111',
          plugin_id: 'platform',
          kind: 'text-selection',
          text: 'quoted text',
        },
      ],
    });
    expect(userPayload).not.toHaveProperty('metadata');

    const state = readUiProjectionState(db, conversationId);
    expect(state).toEqual({
      conversation_id: conversationId,
      status: 'ready',
      revision: 3,
    });

    store.close();
  });

  it('增量 append、rebuild 与 truncate 对 citation fact index 保持同一业务结果', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-ui-citation-index-lifecycle';
    const ref = 'Ab3Def';
    const userInput = makeUserInput(
      'event-ui-citation-user',
      conversationId,
      'citation question',
      1000
    );
    const toolCallId = 'call-ui-citation-search';
    const toolDecision = createToolCallDecisionEvent(
      'event-ui-citation-decision',
      conversationId,
      userInput.turn_id,
      'web_search',
      toolCallId,
      { timestamp: 2000 }
    );
    const toolOutput = createToolOutputEvent(
      'event-ui-citation-output',
      conversationId,
      userInput.turn_id,
      'web_search',
      toolCallId,
      {
        status: 'success',
        observation: 'web search completed',
        data: {
          query: 'citation query',
          resultCount: 1,
          citations: {
            query: 'citation query',
            searchMode: 'web',
            citations: [
              {
                sourceType: 'web',
                ref,
                index: 1,
                url: 'https://example.com/citation-index',
                docTitle: 'citation title',
                snippet: 'citation snippet',
              },
            ],
          },
          evidence_store: { bundle_id: 'bundle-ui-citation-index' },
          cacheStatus: 'miss',
        },
      },
      { timestamp: 3000 }
    );
    const answer = makeFinalAnswer(
      'event-ui-citation-answer',
      conversationId,
      `answer [@${ref}]`,
      4000
    );

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-ui-citation-index', {
      kind: 'agent',
    });
    for (const event of [userInput, toolDecision, toolOutput, answer]) {
      await store.appendEventToRun(session, routeForSession(event, session));
    }

    const readCitationUrl = (): string | undefined => {
      const window = readAround(db, conversationId, answer.id, 1);
      if (window.status !== 'ready') throw new Error('Expected ready citation window');
      const citation = window.citation_dependencies[answer.id]?.citations[0];
      return citation?.sourceType === 'web' ? citation.url : undefined;
    };
    const countCitationFacts = (): number =>
      (
        db
          .prepare(
            `
        SELECT COUNT(*) AS count
        FROM conversation_ui_citation_facts
        WHERE conversation_id = ?
      `
          )
          .get(conversationId) as CountRow
      ).count;

    expect(countCitationFacts()).toBe(1);
    expect(readCitationUrl()).toBe('https://example.com/citation-index');

    const conflictingToolCallId = 'call-ui-citation-conflict';
    const conflictingDecision = createToolCallDecisionEvent(
      'event-ui-citation-conflict-decision',
      conversationId,
      userInput.turn_id,
      'web_search',
      conflictingToolCallId,
      { timestamp: 4500 }
    );
    const conflictingOutput = createToolOutputEvent(
      'event-ui-citation-conflict-output',
      conversationId,
      userInput.turn_id,
      'web_search',
      conflictingToolCallId,
      {
        status: 'success',
        observation: 'conflicting web search completed',
        data: {
          query: 'conflicting citation query',
          resultCount: 1,
          citations: {
            query: 'conflicting citation query',
            searchMode: 'web',
            citations: [
              {
                sourceType: 'web',
                ref,
                index: 1,
                url: 'https://example.com/conflicting-source',
                docTitle: 'conflicting title',
                snippet: 'conflicting snippet',
              },
            ],
          },
          evidence_store: { bundle_id: 'bundle-ui-citation-conflict' },
          cacheStatus: 'miss',
        },
      },
      { timestamp: 5000 }
    );
    await store.appendEventToRun(session, routeForSession(conflictingDecision, session));
    await expect(
      store.appendEventToRun(session, routeForSession(conflictingOutput, session))
    ).rejects.toThrow(/指向了两个不同来源/);
    expect(
      db.prepare('SELECT id FROM events WHERE id = ?').get(conflictingOutput.id)
    ).toBeUndefined();
    expect(countCitationFacts()).toBe(1);

    expect(rebuildConversationUiProjection(db, conversationId, { force: true })).toMatchObject({
      status: 'rebuilt',
    });
    expect(countCitationFacts()).toBe(1);
    expect(readCitationUrl()).toBe('https://example.com/citation-index');

    await store.truncateFromEvent(conversationId, toolOutput.id);
    expect(countCitationFacts()).toBe(0);
    store.close();
  });

  it('truncateFromEvent removes UI projection rows for affected runs when targeting a rendered event', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-ui-truncate-materialized';
    const keptUser = makeUserInput(
      'event-ui-truncate-kept-user',
      conversationId,
      'kept question',
      1000
    );
    const deletedAnswer = makeFinalAnswer(
      'event-ui-truncate-deleted-answer',
      conversationId,
      'deleted answer',
      2000
    );

    await store.ensureConversation(conversationId, [keptUser], undefined, 'chat');
    const keptSession = await store.beginRunSession(conversationId, 'run-ui-truncate-kept', {
      kind: 'agent',
    });
    await store.appendEventToRun(keptSession, routeForSession(keptUser, keptSession));
    await store.completeRun(keptSession);

    const deletedSession = await store.beginRunSession(conversationId, 'run-ui-truncate-deleted', {
      kind: 'agent',
    });
    await store.appendEventToRun(deletedSession, routeForSession(deletedAnswer, deletedSession));
    await store.completeRun(deletedSession);
    const revisionBeforeTruncate = readUiProjectionState(db, conversationId).revision;

    const result = await store.truncateFromEvent(conversationId, deletedAnswer.id);

    expect(result.found).toBe(true);
    expect(readUiMessages(db, conversationId).map(row => row.message_id)).toEqual([keptUser.id]);
    expect(readUiMessages(db, conversationId)[0]?.run_id).toBe(keptSession.runId);
    expect(readUiProjectionState(db, conversationId).revision).toBe(revisionBeforeTruncate + 1);

    store.close();
  });

  it('truncateFromEvent removes UI projection rows for affected runs on the event-id path', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-ui-truncate-event-path';
    const keptUser = makeUserInput(
      'event-ui-event-path-kept-user',
      conversationId,
      'kept before tool',
      1000
    );
    const deletedAnswer = makeFinalAnswer(
      'event-ui-event-path-answer',
      conversationId,
      'deleted answer',
      2000
    );

    await store.ensureConversation(conversationId, [keptUser], undefined, 'chat');
    const keptSession = await store.beginRunSession(conversationId, 'run-ui-event-path-kept', {
      kind: 'agent',
    });
    await store.appendEventToRun(keptSession, routeForSession(keptUser, keptSession));
    await store.completeRun(keptSession);
    db.prepare('UPDATE runs SET start_ts = ? WHERE id = ?').run(1000, keptSession.runId);

    const deletedSession = await store.beginRunSession(
      conversationId,
      'run-ui-event-path-deleted',
      { kind: 'agent' }
    );
    await store.appendEventToRun(deletedSession, routeForSession(deletedAnswer, deletedSession));
    await store.completeRun(deletedSession);
    db.prepare('UPDATE runs SET start_ts = ? WHERE id = ?').run(2000, deletedSession.runId);
    expect(readUiMessages(db, conversationId).map(row => row.run_id)).toEqual([
      keptSession.runId,
      deletedSession.runId,
    ]);
    const revisionBeforeTruncate = readUiProjectionState(db, conversationId).revision;

    const result = await store.truncateFromEvent(conversationId, deletedAnswer.id);

    expect(result.found).toBe(true);
    expect(readUiMessages(db, conversationId).map(row => row.message_id)).toEqual([keptUser.id]);
    expect(readUiMessages(db, conversationId)[0]?.run_id).toBe(keptSession.runId);
    expect(readUiProjectionState(db, conversationId).revision).toBe(revisionBeforeTruncate + 1);

    store.close();
  });

  it('deleteConversation removes UI projection rows and state even when the test connection has no FK enforcement', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-ui-delete';
    const userInput = makeUserInput('event-ui-delete-user', conversationId, 'delete me', 1000);

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-ui-delete', { kind: 'agent' });
    await store.appendEventToRun(session, routeForSession(userInput, session));
    expect(countUiMessages(db, conversationId)).toBe(1);
    expect(countUiProjectionState(db, conversationId)).toBe(1);

    await expect(store.deleteConversation(conversationId)).resolves.toBe(true);

    expect(countUiMessages(db, conversationId)).toBe(0);
    expect(countUiProjectionState(db, conversationId)).toBe(0);

    store.close();
  });

  it('initializes UI projection state as ready for new conversations and pending for pre-existing event history', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-ui-state-init';
    const first = makeUserInput('event-ui-state-first', conversationId, 'first', 1000);
    const second = makeFinalAnswer('event-ui-state-second', conversationId, 'second', 2000);

    await store.ensureConversation(conversationId, [first], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-ui-state-init', {
      kind: 'agent',
    });
    await store.appendEventToRun(session, routeForSession(first, session));
    expect(readUiProjectionState(db, conversationId)).toEqual({
      conversation_id: conversationId,
      status: 'ready',
      revision: 1,
    });

    db.prepare('DELETE FROM conversation_ui_projection_state WHERE conversation_id = ?').run(
      conversationId
    );
    await store.appendEventToRun(session, routeForSession(second, session));

    expect(readUiProjectionState(db, conversationId)).toEqual({
      conversation_id: conversationId,
      status: 'pending',
      revision: 1,
    });

    store.close();
  });

  it('rebuilds UI projection to the same rows as incremental append, including sortSeq', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-ui-rebuild-parity';
    const attachment: RuntimeResourceRef = {
      id: 'attachment-ui-rebuild',
      kind: 'image',
      resourceId: 'asset-ui-rebuild',
      mediaType: 'image/png',
      byteLength: 128,
      width: 16,
      height: 8,
      sha256: 'f'.repeat(64),
      fileName: 'rebuild.png',
    };
    const userInput = createUserInputEvent(
      'event-ui-rebuild-user',
      conversationId,
      'turn-event-ui-rebuild-user',
      'question before rebuild',
      { timestamp: 1000, attachments: [attachment] }
    );
    const answer = makeFinalAnswer(
      'event-ui-rebuild-answer',
      conversationId,
      'answer before rebuild',
      2000
    );
    const executionMetrics = createRunExecutionMetricsEvent(
      'event-ui-rebuild-metrics',
      conversationId,
      userInput.turn_id,
      {
        timestamp: 2500,
        execution_id: 'execution-ui-rebuild',
        outcome: 'completed',
        duration_ms: 90,
        user_message_id: userInput.id,
      }
    );

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-ui-rebuild-parity', {
      kind: 'agent',
    });
    await store.appendEventToRun(session, routeForSession(userInput, session), {
      assetCommits: [
        {
          assetId: attachment.resourceId,
          uri: `/Resources/Attachments/ff/${attachment.sha256}.png`,
          mediaType: attachment.mediaType,
          byteLength: attachment.byteLength,
          width: attachment.width,
          height: attachment.height,
          sha256: attachment.sha256,
          localPath: `/managed/${attachment.sha256}.png`,
          createdAt: 1000,
        },
      ],
    });
    await store.appendEventToRun(session, routeForSession(answer, session));
    await store.appendEventToRun(session, routeForSession(executionMetrics, session));
    const incrementalRows = readUiMessages(db, conversationId);

    const result = rebuildConversationUiProjection(db, conversationId, { force: true });

    expect(result).toMatchObject({
      status: 'rebuilt',
      conversationId,
      eventCount: 3,
      messageCount: 2,
    });
    expect(readUiMessages(db, conversationId)).toEqual(incrementalRows);
    expect(JSON.parse(incrementalRows[0]?.attachments_json ?? '[]')).toEqual([
      expect.objectContaining({
        id: attachment.id,
        assetId: attachment.resourceId,
      }),
    ]);

    store.close();
  });

  it('同 conversation 的 child facts 只留在 EventStore，增量与重建都不混入正文', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-ui-child-routing';
    const parentRunId = 'run-ui-child-routing-parent';
    const childRunId = 'run-ui-child-routing-child';
    const parentToolCallId = 'call-ui-child-routing';
    const parentUser = makeUserInput(
      'event-ui-child-routing-user',
      conversationId,
      'parent question',
      1000
    );
    const parentTool = createToolCallDecisionEvent(
      'event-ui-child-routing-tool',
      conversationId,
      parentUser.turn_id,
      'subagent',
      parentToolCallId,
      { timestamp: 1100 }
    );
    const childUser = createUserInputEvent(
      'event-ui-child-routing-child-user',
      conversationId,
      'turn-ui-child-routing-child',
      'internal child task',
      { timestamp: 1200, source: 'system' }
    );
    const childThought = createThoughtEvent(
      'event-ui-child-routing-thought',
      conversationId,
      childUser.turn_id,
      'internal child thought',
      { timestamp: 1300, is_complete: true }
    );
    const childAnswer = createFinalAnswerEvent(
      'answer-ui-child-routing',
      conversationId,
      childUser.turn_id,
      'internal child answer',
      { timestamp: 1400, completion_reason: 'terminal' }
    );
    await store.ensureConversation(conversationId, [parentUser], undefined, 'agent');
    const parentSession = await store.beginRunSession(conversationId, parentRunId, {
      kind: 'agent',
    });
    const childSession = await store.beginRunSession(conversationId, childRunId, { kind: 'agent' });
    db.prepare('UPDATE runs SET parent_run_id = ? WHERE id = ?').run(parentRunId, childRunId);
    await store.appendEventToRun(parentSession, routeForSession(parentUser, parentSession));
    await store.appendEventToRun(parentSession, routeForSession(parentTool, parentSession));
    await store.appendEventToRun(
      childSession,
      routeChildForSession(childUser, childSession, parentRunId)
    );
    await store.appendEventToRun(
      childSession,
      routeChildForSession(childThought, childSession, parentRunId)
    );
    await store.appendEventToRun(
      childSession,
      routeChildForSession(childAnswer, childSession, parentRunId)
    );
    const incrementalRows = readUiMessages(db, conversationId);
    expect(incrementalRows.map(row => row.message_id)).toEqual([
      parentUser.id,
      conversationMessageIdFromToolIdentity(parentRunId, parentToolCallId),
    ]);
    expect(
      db
        .prepare(
          `
      SELECT total_events, user_message_count, preview_text
      FROM conversations
      WHERE conversation_id = ?
    `
        )
        .get(conversationId)
    ).toEqual({
      total_events: 5,
      user_message_count: 1,
      preview_text: 'parent question',
    });

    const rebuilt = rebuildConversationUiProjection(db, conversationId, { force: true });
    expect(rebuilt).toMatchObject({
      status: 'rebuilt',
      eventCount: 5,
      messageCount: 2,
      skippedEventCount: 3,
    });
    expect(readUiMessages(db, conversationId)).toEqual(incrementalRows);

    store.close();
  });

  it('UI rebuild 拒绝从 run 父子关系恢复缺 routing identity 的 stored fact', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-ui-legacy-routing';
    const parentRunId = 'run-ui-legacy-parent';
    const childRunId = 'run-ui-legacy-child';
    const parentUser = makeUserInput(
      'event-ui-legacy-parent-user',
      conversationId,
      'legacy parent question',
      1000
    );
    const childThought = createThoughtEvent(
      'event-ui-legacy-child-thought',
      conversationId,
      'turn-ui-legacy-child',
      'legacy child thought',
      { timestamp: 1100, is_complete: true }
    );

    await store.ensureConversation(conversationId, [parentUser], undefined, 'agent');
    await store.beginRunSession(conversationId, parentRunId, { kind: 'agent' });
    await store.beginRunSession(conversationId, childRunId, { kind: 'agent' });
    db.prepare('UPDATE runs SET parent_run_id = ? WHERE id = ?').run(parentRunId, childRunId);
    db.prepare(
      `
      INSERT INTO events (id, run_id, type, payload, ts)
      VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
    `
    ).run(
      parentUser.id,
      parentRunId,
      parentUser.type,
      JSON.stringify(parentUser),
      parentUser.timestamp,
      childThought.id,
      childRunId,
      childThought.type,
      JSON.stringify(childThought),
      childThought.timestamp
    );
    db.prepare(
      `
      UPDATE conversations
      SET total_events = 2
      WHERE conversation_id = ?
    `
    ).run(conversationId);

    expect(() => rebuildConversationUiProjection(db, conversationId, { force: true })).toThrow();
    expect(readUiMessages(db, conversationId)).toEqual([]);

    store.close();
  });

  it('rebuilds pending UI projection state, bumps revision, and skips ready state unless forced', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-ui-rebuild-state';
    const userInput = makeUserInput(
      'event-ui-rebuild-state-user',
      conversationId,
      'state rebuild',
      1000
    );

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-ui-rebuild-state', {
      kind: 'agent',
    });
    await store.appendEventToRun(session, routeForSession(userInput, session));

    db.prepare(
      `
      UPDATE conversation_ui_projection_state
      SET status = 'pending', revision = 7
      WHERE conversation_id = ?
    `
    ).run(conversationId);

    const pendingResult = rebuildConversationUiProjection(db, conversationId);
    expect(pendingResult).toMatchObject({
      status: 'rebuilt',
      previousRevision: 7,
      nextRevision: 8,
    });
    expect(readUiProjectionState(db, conversationId)).toEqual({
      conversation_id: conversationId,
      status: 'ready',
      revision: 8,
    });

    const readyResult = rebuildConversationUiProjection(db, conversationId);
    expect(readyResult).toMatchObject({
      status: 'skipped',
      reason: 'already-ready',
    });

    const forcedResult = rebuildConversationUiProjection(db, conversationId, { force: true });
    expect(forcedResult).toMatchObject({
      status: 'rebuilt',
      previousRevision: 8,
      nextRevision: 9,
    });

    store.close();
  });

  it('rebuild excludes non-UI and legacy-incompatible rows before parsing payload', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-ui-rebuild-exclude-audit';
    const userInput = makeUserInput(
      'event-ui-rebuild-exclude-user',
      conversationId,
      'visible',
      1000
    );

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'run-ui-rebuild-exclude-audit', {
      kind: 'agent',
    });
    await store.appendEventToRun(session, routeForSession(userInput, session));
    db.prepare(
      `
      INSERT INTO events (id, run_id, type, payload, ts, event_store_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      'event-ui-rebuild-invalid-audit',
      session.runId,
      'audit_envelope',
      '{"type":"audit_envelope","payload":"intentionally incomplete"',
      1500,
      null
    );
    db.prepare(
      `
      INSERT INTO events (id, run_id, type, payload, ts, event_store_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      'event-ui-rebuild-invalid-subrun-kind',
      session.runId,
      'subrun_trace',
      JSON.stringify({
        type: 'subrun_trace',
        id: 'event-ui-rebuild-invalid-subrun-kind',
        conversation_id: conversationId,
        turn_id: userInput.turn_id,
        timestamp: 1600,
        version: 1,
        parent_tool_call_id: 'call-legacy',
        subrun_id: 'subrun-legacy',
        kind: 'action',
      }),
      1600,
      null
    );
    db.prepare(
      `
      UPDATE conversation_ui_projection_state
      SET status = 'pending'
      WHERE conversation_id = ?
    `
    ).run(conversationId);

    const result = rebuildConversationUiProjection(db, conversationId);

    expect(result).toMatchObject({
      status: 'rebuilt',
      eventCount: 1,
      messageCount: 1,
      sqlExcludedEventCount: 2,
    });
    expect(readUiMessages(db, conversationId).map(row => row.message_id)).toEqual([userInput.id]);

    store.close();
  });

  it('rebuild 拒绝带有旧完整 envelope 的 payload', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-ui-rebuild-normalize-conversation';
    const seed = makeUserInput('event-ui-rebuild-normalize-seed', conversationId, 'seed', 1000);
    const wrongPayloadConversationEvent = makeUserInput(
      'event-ui-rebuild-wrong-payload-conversation',
      'conv-missing-from-payload',
      'payload says another conversation',
      1100
    );

    await store.ensureConversation(conversationId, [seed], undefined, 'agent');
    const session = await store.beginRunSession(
      conversationId,
      'run-ui-rebuild-normalize-conversation',
      { kind: 'agent' }
    );
    db.prepare(
      `
      INSERT INTO events (id, run_id, type, payload, ts, event_store_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      wrongPayloadConversationEvent.id,
      session.runId,
      wrongPayloadConversationEvent.type,
      JSON.stringify(routeForSession(wrongPayloadConversationEvent, session)),
      wrongPayloadConversationEvent.timestamp,
      null
    );

    expect(() => rebuildConversationUiProjection(db, conversationId)).toThrow(
      'payload must not contain identity field id'
    );
    expect(readUiMessages(db, conversationId)).toEqual([]);

    store.close();
  });

  it('uses user_input.raw_content for rendered messages and conversation preview', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-user-raw-content';
    const userInput = createUserInputEvent(
      'event-user-raw-content',
      conversationId,
      'turn-user-raw-content',
      [
        '<local_time>2026-06-18 09:07:05</local_time>',
        '<user_request>\n原始请求\n</user_request>',
      ].join('\n\n'),
      {
        timestamp: 1000,
        raw_content: '原始请求',
      }
    );

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'turn-user-raw-content', {
      kind: 'user_input',
    });
    await store.appendEventToRun(session, routeForSession(userInput, session));

    expect(readUiMessages(db, conversationId)).toEqual([
      expect.objectContaining({
        message_id: userInput.id,
        content: '原始请求',
      }),
    ]);

    const conversation = db
      .prepare(
        'SELECT conversation_id, preview_text, total_events, user_message_count FROM conversations WHERE conversation_id = ?'
      )
      .get(conversationId) as ConversationRow;
    expect(conversation).toEqual({
      conversation_id: conversationId,
      preview_text: '原始请求',
      total_events: 1,
      user_message_count: 1,
    });

    const rawEvents = await store.readEvents(conversationId, { direction: 'forward', limit: 10 });
    expect(rawEvents.events[0]).toMatchObject({
      content: expect.stringContaining('<local_time>2026-06-18 09:07:05</local_time>'),
      raw_content: '原始请求',
    });

    store.close();
  });

  it('appendEventToRun rejects realtime tool progress without durable side effects', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-session-non-renderable';
    const userInput = makeUserInput(
      'event-session-non-renderable-user',
      conversationId,
      'start',
      1000
    );
    const toolProcess = createToolProcessEvent(
      'event-session-tool-process',
      conversationId,
      'turn-tool-process',
      'web_search',
      'call-tool-process',
      { timestamp: 2000 }
    );

    await store.ensureConversation(conversationId, [userInput], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, 'turn-session-non-renderable', {
      kind: 'agent',
    });

    await expect(
      store.appendEventToRun(session, routeForSession(toolProcess, session))
    ).rejects.toThrow('is not eligible for persistence');

    expect(countRows(db, 'events')).toBe(0);
    expect(readUiMessages(db, conversationId)).toEqual([]);

    const conversation = db
      .prepare(
        'SELECT conversation_id, preview_text, total_events, user_message_count FROM conversations WHERE conversation_id = ?'
      )
      .get(conversationId) as ConversationRow;
    expect(conversation).toEqual({
      conversation_id: conversationId,
      preview_text: 'start',
      total_events: 0,
      user_message_count: 0,
    });

    store.close();
  });

  it('failRun marks the run failed without deleting committed events', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-session-fail';
    const userInput = makeUserInput(
      'event-session-fail-user',
      conversationId,
      'before failure',
      1000
    );

    await store.ensureConversation(conversationId, [userInput], undefined, 'chat');
    const session = await store.beginRunSession(conversationId, 'turn-session-fail', {
      kind: 'agent',
    });
    await store.appendEventToRun(session, routeForSession(userInput, session));
    await store.failRun(session, { code: 'TEST_FAILURE', message: 'boom' });

    const failedRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(session.runId) as RunRow;
    expect(failedRun.status).toBe('failed');
    expect(failedRun.end_ts).toEqual(expect.any(Number));

    const rawEvents = await store.readEvents(conversationId, { direction: 'forward', limit: 10 });
    expect(rawEvents.events.map(event => event.id)).toEqual(['event-session-fail-user']);

    store.close();
  });

  it('truncateFromEvent recomputes conversation metadata from fact events after deleting a later run', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-truncate-recompute-facts';
    const first = makeUserInput(
      'event-truncate-recompute-first',
      conversationId,
      'first kept',
      1000
    );
    const keptAnswer = makeFinalAnswer(
      'event-truncate-recompute-kept-answer',
      conversationId,
      'kept answer',
      1500
    );
    const deletedAnswer = makeFinalAnswer(
      'event-truncate-recompute-deleted-answer',
      conversationId,
      'deleted answer should not remain in preview',
      2000
    );

    await store.ensureConversation(conversationId, [first], undefined, 'chat');
    const firstSession = await store.beginRunSession(
      conversationId,
      'turn-truncate-recompute-first',
      { kind: 'agent' }
    );
    await store.appendEventToRun(firstSession, routeForSession(first, firstSession));
    await store.appendEventToRun(firstSession, routeForSession(keptAnswer, firstSession));
    await store.completeRun(firstSession);

    const secondSession = await store.beginRunSession(
      conversationId,
      'turn-truncate-recompute-second',
      { kind: 'agent' }
    );
    await store.appendEventToRun(secondSession, routeForSession(deletedAnswer, secondSession));
    await store.completeRun(secondSession);

    const result = await store.truncateFromEvent(conversationId, deletedAnswer.id);

    expect(result.found).toBe(true);
    expect(result).toMatchObject({ deletedEventCount: 1, deletedRunCount: 1 });
    expect(countRows(db, 'events')).toBe(2);
    expect(readUiMessages(db, conversationId).map(row => row.message_id)).toEqual([
      first.id,
      keptAnswer.id,
    ]);

    const conversation = db
      .prepare<
        unknown[],
        ConversationRow
      >('SELECT conversation_id, last_event_at, preview_text, total_events, user_message_count FROM conversations WHERE conversation_id = ?')
      .get(conversationId);
    expect(conversation).toEqual({
      conversation_id: conversationId,
      last_event_at: 1500,
      preview_text: 'kept answer',
      total_events: 2,
      user_message_count: 1,
    });

    store.close();
  });

  it('truncate metadata recompute 拒绝读取缺 routing identity 的 surviving fact', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-truncate-rejects-unrouted';
    const first = makeUserInput(
      'event-truncate-unrouted-first',
      conversationId,
      'first kept',
      1000
    );
    const later = makeFinalAnswer(
      'event-truncate-unrouted-later',
      conversationId,
      'later answer',
      2000
    );

    await store.ensureConversation(conversationId, [first], undefined, 'agent');
    const firstSession = await store.beginRunSession(
      conversationId,
      'run-truncate-unrouted-first',
      {
        kind: 'agent',
      }
    );
    await store.appendEventToRun(firstSession, routeForSession(first, firstSession));
    const laterSession = await store.beginRunSession(
      conversationId,
      'run-truncate-unrouted-later',
      {
        kind: 'agent',
      }
    );
    await store.appendEventToRun(laterSession, routeForSession(later, laterSession));
    db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(JSON.stringify(first), first.id);

    await expect(store.truncateFromEvent(conversationId, later.id)).rejects.toThrow();
    expect(countRows(db, 'events')).toBe(2);

    store.close();
  });

  it('truncateFromEvent uses run insertion order when multiple runs share the same timestamp', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-truncate-same-timestamp';
    const first = makeUserInput('event-same-time-first', conversationId, 'first', 1000);
    const second = makeUserInput('event-same-time-second', conversationId, 'second', 1000);
    const third = makeUserInput('event-same-time-third', conversationId, 'third', 1000);

    await store.ensureConversation(conversationId, [first], undefined, 'chat');
    const firstSession = await store.beginRunSession(conversationId, 'run-same-time-first', {
      kind: 'agent',
    });
    await store.appendEventToRun(firstSession, routeForSession(first, firstSession));
    const secondSession = await store.beginRunSession(conversationId, 'run-same-time-second', {
      kind: 'agent',
    });
    await store.appendEventToRun(secondSession, routeForSession(second, secondSession));
    const thirdSession = await store.beginRunSession(conversationId, 'run-same-time-third', {
      kind: 'agent',
    });
    await store.appendEventToRun(thirdSession, routeForSession(third, thirdSession));
    db.prepare('UPDATE runs SET start_ts = 1000 WHERE conversation_id = ?').run(conversationId);

    await expect(store.truncateFromEvent(conversationId, second.id)).resolves.toEqual({
      found: true,
      deletedEventCount: 2,
      deletedRunCount: 2,
    });
    expect(db.prepare('SELECT id FROM runs ORDER BY rowid ASC').all()).toEqual([
      { id: firstSession.runId },
    ]);
    expect(
      (await store.readEvents(conversationId, { direction: 'forward' })).events.map(
        event => event.id
      )
    ).toEqual([first.id]);
    store.close();
  });

  it('truncateFromEvent can anchor on a fact that has no UI history row', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-truncate-hidden-fact';
    const first = makeUserInput('event-hidden-anchor-first', conversationId, 'first', 1000);
    const hiddenFact = createUserInputEvent(
      'event-hidden-anchor-user-input',
      conversationId,
      'turn-hidden-anchor-user-input',
      'hidden input',
      {
        timestamp: 2000,
        metadata: { ui: { presentation: 'hidden' } },
      }
    );
    const later = makeFinalAnswer('event-hidden-anchor-later', conversationId, 'later', 3000);

    await store.ensureConversation(conversationId, [first], undefined, 'agent');
    const firstSession = await store.beginRunSession(conversationId, 'run-hidden-anchor-first', {
      kind: 'agent',
    });
    await store.appendEventToRun(firstSession, routeForSession(first, firstSession));
    const hiddenSession = await store.beginRunSession(conversationId, 'run-hidden-anchor-audit', {
      kind: 'agent',
    });
    await store.appendEventToRun(hiddenSession, routeForSession(hiddenFact, hiddenSession));
    const laterSession = await store.beginRunSession(conversationId, 'run-hidden-anchor-later', {
      kind: 'agent',
    });
    await store.appendEventToRun(laterSession, routeForSession(later, laterSession));
    expect(readUiMessages(db, conversationId).map(row => row.message_id)).toEqual([
      first.id,
      later.id,
    ]);

    await expect(store.truncateFromEvent(conversationId, hiddenFact.id)).resolves.toEqual({
      found: true,
      deletedEventCount: 2,
      deletedRunCount: 2,
    });
    expect(readUiMessages(db, conversationId).map(row => row.message_id)).toEqual([first.id]);
    expect(
      (await store.readEvents(conversationId, { direction: 'forward' })).events.map(
        event => event.id
      )
    ).toEqual([first.id]);
    store.close();
  });

  it('keeps committed events readable when appendEventToRun fails before caller marks the run failed', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-session-running-after-error';
    const firstEvent = makeUserInput('event-session-running-first', conversationId, 'first', 1000);
    const conflictingEvent = makeUserInput(
      'event-session-running-first',
      conversationId,
      'duplicate',
      2000
    );

    await store.ensureConversation(conversationId, [firstEvent], undefined, 'chat');
    const session = await store.beginRunSession(
      conversationId,
      'turn-session-running-after-error',
      { kind: 'agent' }
    );
    await store.appendEventToRun(session, routeForSession(firstEvent, session));

    await expect(
      store.appendEventToRun(session, routeForSession(conflictingEvent, session))
    ).rejects.toThrow();

    const runningRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(session.runId) as RunRow;
    expect(runningRun.status).toBe('running');

    const rawEvents = await store.readEvents(conversationId, { direction: 'forward', limit: 10 });
    expect(rawEvents.events.map(event => event.id)).toEqual(['event-session-running-first']);

    store.close();
  });

  it('truncateFromEvent surfaces storage errors instead of returning not found', async () => {
    const { store } = createStore();

    store.close();

    await expect(store.truncateFromEvent('conv-closed-db', 'message-closed-db')).rejects.toThrow();
  });

  it('ensureConversation updates mode without discarding existing metadata fields', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-ensure-preserve-metadata';
    const userInput = makeUserInput(
      'event-ensure-preserve-metadata-user',
      conversationId,
      'hello',
      1000
    );

    await store.ensureConversation(conversationId, [userInput], undefined, 'chat');
    db.prepare('UPDATE conversations SET metadata = ? WHERE conversation_id = ?').run(
      JSON.stringify({ mode: 'chat', custom: 'keep-me' }),
      conversationId
    );

    await store.ensureConversation(conversationId, [], undefined, 'agent');

    const row = db
      .prepare<
        unknown[],
        { metadata: string | null }
      >('SELECT metadata FROM conversations WHERE conversation_id = ?')
      .get(conversationId);
    expect(parseJsonRecord(row?.metadata)).toEqual({
      mode: 'agent',
      custom: 'keep-me',
    });

    store.close();
  });

  it('persists selected agent independently from title generation and supports clear', async () => {
    const { db, store } = createStore();
    const conversationId = 'conv-selected-agent';
    const selectedAgentId = ConversationSelectedAgentIdSchema.parse('plugin_agent_fixture');
    db.prepare('INSERT INTO projects (id) VALUES (?)').run('project-selected-agent');

    await expect(
      store.updateSelectedAgent(conversationId, selectedAgentId, 'project-selected-agent')
    ).resolves.toBe(true);

    // Agent 选择会提前物化聚合根，但首问到达后 Host 仍不得自行生成标题。
    await store.ensureConversation(
      conversationId,
      [
        makeUserInput(
          'event-selected-agent-first-question',
          conversationId,
          '帮我制作季度复盘',
          1000
        ),
      ],
      'project-selected-agent',
      'agent'
    );

    await expect(store.getConversationMetadata(conversationId)).resolves.toMatchObject({
      conversation_id: conversationId,
      title: 'New Chat',
      selected_agent_id: selectedAgentId,
      project_id: 'project-selected-agent',
    });
    await expect(store.updateTitle(conversationId, '帮我制作季度复盘')).resolves.toBe(true);
    await expect(store.getConversationMetadata(conversationId)).resolves.toMatchObject({
      title: '帮我制作季度复盘',
      selected_agent_id: selectedAgentId,
    });
    await expect(
      store.listConversations({ projectId: 'project-selected-agent' })
    ).resolves.toMatchObject({
      conversations: [{ selected_agent_id: selectedAgentId }],
    });

    db.prepare('INSERT INTO projects (id) VALUES (?)').run('project-must-not-replace-scope');
    await expect(
      store.updateSelectedAgent(conversationId, null, 'project-must-not-replace-scope')
    ).resolves.toBe(true);
    await expect(store.getConversationMetadata(conversationId)).resolves.toMatchObject({
      selected_agent_id: null,
      project_id: 'project-selected-agent',
    });

    store.close();
  });
});

describe('SQLiteEventStore conversation pinning', () => {
  it('lists conversations with the same sort cursor across page boundaries without skipping ties', async () => {
    const { db, store } = createStore();
    const firstConversationId = 'conv-sort-tie-b';
    const secondConversationId = 'conv-sort-tie-a';

    await store.ensureConversation(
      firstConversationId,
      [makeUserInput('event-sort-tie-b', firstConversationId, 'same timestamp b', 1000)],
      undefined,
      'chat'
    );
    await store.ensureConversation(
      secondConversationId,
      [makeUserInput('event-sort-tie-a', secondConversationId, 'same timestamp a', 1000)],
      undefined,
      'chat'
    );
    db.prepare('UPDATE conversations SET last_event_at = ? WHERE conversation_id IN (?, ?)').run(
      5000,
      firstConversationId,
      secondConversationId
    );

    const firstPage = await store.listConversations({ limit: 1 });
    expect(firstPage.conversations.map(conversation => conversation.conversation_id)).toEqual([
      firstConversationId,
    ]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await store.listConversations({ limit: 1, cursor: firstPage.nextCursor });
    expect(secondPage.conversations.map(conversation => conversation.conversation_id)).toEqual([
      secondConversationId,
    ]);
    expect(secondPage.hasMore).toBe(false);

    store.close();
  });

  it('persists pinned state and lists pinned conversations before recent unpinned conversations', async () => {
    const { db, store } = createStore();
    const oldConversationId = 'conv-pinned-old';
    const recentConversationId = 'conv-unpinned-recent';

    await store.ensureConversation(
      oldConversationId,
      [makeUserInput('event-pinned-old', oldConversationId, 'old pinned', 1000)],
      undefined,
      'chat'
    );
    await store.ensureConversation(
      recentConversationId,
      [makeUserInput('event-unpinned-recent', recentConversationId, 'recent unpinned', 3000)],
      undefined,
      'chat'
    );
    db.prepare('UPDATE conversations SET last_event_at = ? WHERE conversation_id = ?').run(
      1000,
      oldConversationId
    );
    db.prepare('UPDATE conversations SET last_event_at = ? WHERE conversation_id = ?').run(
      3000,
      recentConversationId
    );

    await store.updatePinned(oldConversationId, true, 2000);

    const page = await store.listConversations({ limit: 10 });

    expect(page.conversations.map(conversation => conversation.conversation_id)).toEqual([
      oldConversationId,
      recentConversationId,
    ]);
    expect(page.conversations[0]).toMatchObject({
      conversation_id: oldConversationId,
      is_pinned: true,
      pinned_at: 2000,
    });

    await store.updatePinned(oldConversationId, false, null);
    const unpinnedPage = await store.listConversations({ limit: 10 });
    expect(unpinnedPage.conversations.map(conversation => conversation.conversation_id)).toEqual([
      recentConversationId,
      oldConversationId,
    ]);

    store.close();
  });
});
