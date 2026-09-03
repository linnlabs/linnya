import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { SQLiteEventStore } from 'src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation';
import { HistoryRepository } from 'src/features/conversation/history/history.repository';
import {
  createFinalAnswerEvent,
  createToolCallDecisionEvent,
  createUserInputEvent,
  routeRuntimeEvent,
  type RoutedRuntimeEvent,
  type RuntimeEvent,
  type RuntimeResourceRef,
} from 'linnkit/contracts';
import type { WorkspaceAssetCommitRecord } from 'src/features/workspace/assets/definitions/workspaceAssetCommit';
import { createConversationPersistencePort, EventPersistenceCoordinator } from '../flow.persistence';
import { createDirectFlowConversationAdmissionPort } from '../__test-helpers__/createDirectFlowConversationAdmissionPort';

interface CountRow {
  count: number;
}

interface RunRow {
  id: string;
  status: string;
  kind: string;
  end_ts: number | null;
}

function createStore(): {
  db: Database.Database;
  store: SQLiteEventStore;
  repository: HistoryRepository;
  coordinator: EventPersistenceCoordinator;
} {
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
    CREATE TABLE project_asset_links (
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'resource',
      origin TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(project_id, asset_id)
    );
  `);
  for (const schema of CONVERSATION_SCHEMAS) {
    db.exec(schema);
  }
  const store = new SQLiteEventStore(db);
  const repository = new HistoryRepository(store);
  const coordinator = new EventPersistenceCoordinator({
    persistencePort: createConversationPersistencePort(repository),
    conversationAdmission: createDirectFlowConversationAdmissionPort(repository),
  });
  return { db, store, repository, coordinator };
}

function countRows(db: Database.Database, tableName: 'runs' | 'events' | 'conversation_ui_messages'): number {
  return (db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as CountRow).count;
}

function makeUserInput(id: string, conversationId: string, content: string, timestamp: number): RuntimeEvent {
  return createUserInputEvent(id, conversationId, `turn-${id}`, content, { timestamp });
}

function makeFinalAnswer(id: string, conversationId: string, content: string, timestamp: number): RuntimeEvent {
  return createFinalAnswerEvent(`answer-${id}`, conversationId, `turn-${id}`, content, {
    timestamp,
    completion_reason: 'terminal',
  });
}

function routeForRun(event: RuntimeEvent, runId: string): RoutedRuntimeEvent {
  return routeRuntimeEvent(event, {
    run_id: runId,
    lane: 'foreground',
    visibility: 'conversation',
  });
}

async function admitConversation(
  coordinator: EventPersistenceCoordinator,
  conversationId: string,
  initialEvents: readonly RuntimeEvent[],
  mode?: string,
): Promise<void> {
  await coordinator.withConversationAdmission({
    conversationId,
    initialEvents,
    ...(mode !== undefined ? { mode } : {}),
    admitted: () => undefined,
  });
}

describe('EventPersistenceCoordinator B3c event-grained core', () => {
  it('把当前 event 的 asset commit 计划透传到同一 EventStore 短事务', async () => {
    const { db, store, coordinator } = createStore();
    const conversationId = 'conv-event-grained-assets';
    const attachment: RuntimeResourceRef = {
      id: 'attachment-event-grained',
      kind: 'image',
      resourceId: 'asset-event-grained',
      mediaType: 'image/png',
      byteLength: 128,
      width: 16,
      height: 8,
      sha256: 'f'.repeat(64),
    };
    const event = createUserInputEvent(
      'event-grained-assets',
      conversationId,
      'turn-event-grained-assets',
      '',
      { attachments: [attachment], timestamp: 1000 },
    );
    const commit: WorkspaceAssetCommitRecord = {
      assetId: attachment.resourceId,
      uri: `/Resources/Attachments/ff/${attachment.sha256}.png`,
      mediaType: attachment.mediaType,
      byteLength: attachment.byteLength,
      width: attachment.width,
      height: attachment.height,
      sha256: attachment.sha256,
      localPath: `/managed/${attachment.sha256}.png`,
      createdAt: 1000,
    };

    await admitConversation(coordinator, conversationId, [event]);
    const session = await coordinator.createExplicitRunSession(
      conversationId,
      'turn-event-grained-assets',
      { kind: 'user_input' },
    );
    await coordinator.appendEventsToRun(
      session,
      [routeForRun(event, session.runId)],
      new Map([[event.id, [commit]]]),
    );

    expect(db.prepare(`
      SELECT event_id, attachment_id, asset_id
      FROM conversation_event_asset_links
    `).get()).toEqual({
      event_id: event.id,
      attachment_id: attachment.id,
      asset_id: attachment.resourceId,
    });
    expect(db.prepare('SELECT id, uri FROM assets').get()).toEqual({
      id: attachment.resourceId,
      uri: commit.uri,
    });
    store.close();
  });

  it('appendEventsToRun writes all events into an explicit runtime run', async () => {
    const { db, store, coordinator } = createStore();
    const conversationId = 'conv-event-grained-run';
    const userInput = makeUserInput('event-grained-user', conversationId, 'hello', 1000);
    const toolDecision = createToolCallDecisionEvent(
      'event-grained-tool-decision',
      conversationId,
      'turn-event-grained-tool',
      'web_search',
      'call-event-grained-tool',
      { args: { query: 'hello' }, timestamp: 1500 },
    );
    const finalAnswer = makeFinalAnswer('event-grained-answer', conversationId, 'answer', 2000);

    await admitConversation(coordinator, conversationId, [userInput], 'agent');
    const session = await coordinator.createExplicitRunSession(conversationId, 'turn-event-grained-run', {
      kind: 'agent',
      model_key: 'model-event-grained',
    });
    await coordinator.appendEventsToRun(session, [userInput, toolDecision, finalAnswer].map(
      event => routeForRun(event, session.runId),
    ));
    await coordinator.completeRun(session);

    expect(countRows(db, 'runs')).toBe(1);
    expect(countRows(db, 'events')).toBe(3);
    expect(countRows(db, 'conversation_ui_messages')).toBe(3);

    const run = db.prepare('SELECT id, status, kind, end_ts FROM runs WHERE id = ?').get(session.runId) as RunRow;
    expect(run).toMatchObject({ id: session.runId, status: 'completed', kind: 'agent' });
    expect(run.end_ts).toEqual(expect.any(Number));

    const rawEvents = await store.readEvents(conversationId, { direction: 'forward', limit: 10 });
    expect(rawEvents.events.map(event => event.id)).toEqual([
      'event-grained-user',
      'event-grained-tool-decision',
      'answer-event-grained-answer',
    ]);

    store.close();
  });

  it('append failure can be marked failed while keeping already committed events readable', async () => {
    const { db, store, coordinator } = createStore();
    const conversationId = 'conv-event-grained-failure';
    const first = makeUserInput('event-grained-fail-first', conversationId, 'first', 1000);
    const duplicate = makeUserInput('event-grained-fail-first', conversationId, 'duplicate', 2000);

    await admitConversation(coordinator, conversationId, [first], 'chat');
    const session = await coordinator.createExplicitRunSession(conversationId, 'turn-event-grained-failure', { kind: 'agent' });
    await expect(coordinator.appendEventsToRun(session, [first, duplicate].map(
      event => routeForRun(event, session.runId),
    ))).rejects.toThrow();
    await coordinator.failRun(session, 'PERSIST_RUN_ERROR', new Error('duplicate'));

    expect(countRows(db, 'runs')).toBe(1);
    expect(countRows(db, 'events')).toBe(1);

    const failedRun = db.prepare('SELECT id, status, kind, end_ts FROM runs').get() as RunRow;
    expect(failedRun.status).toBe('failed');
    expect(failedRun.kind).toBe('agent');
    expect(failedRun.end_ts).toEqual(expect.any(Number));

    const rawEvents = await store.readEvents(conversationId, { direction: 'forward', limit: 10 });
    expect(rawEvents.events.map(event => event.id)).toEqual(['event-grained-fail-first']);

    store.close();
  });

  it('appendEventsToRun does not double-write the same RuntimeEvent id', async () => {
    const { db, store, coordinator } = createStore();
    const conversationId = 'conv-event-grained-no-double-write';
    const event = makeUserInput('event-grained-unique', conversationId, 'unique', 1000);

    await admitConversation(coordinator, conversationId, [event], 'chat');
    const session = await coordinator.createExplicitRunSession(conversationId, 'turn-event-grained-unique', { kind: 'agent' });
    const routedEvent = routeForRun(event, session.runId);
    await coordinator.appendEventsToRun(session, [routedEvent]);

    await expect(coordinator.appendEventsToRun(session, [routedEvent])).rejects.toThrow();

    expect(countRows(db, 'runs')).toBe(1);
    expect(countRows(db, 'events')).toBe(1);

    const duplicateRows = db
      .prepare('SELECT id, COUNT(*) as count FROM events GROUP BY id HAVING COUNT(*) > 1')
      .all() as Array<{ id: string; count: number }>;
    expect(duplicateRows).toEqual([]);

    store.close();
  });

  it('truncateFromEvent keeps the current run-grained deletion semantics', async () => {
    const { db, store, repository, coordinator } = createStore();
    const conversationId = 'conv-event-grained-truncate';
    const first = makeUserInput('event-grained-truncate-first', conversationId, 'first', 1000);
    const second = makeUserInput('event-grained-truncate-second', conversationId, 'second', 2000);

    await admitConversation(coordinator, conversationId, [first], 'chat');
    const firstSession = await coordinator.createExplicitRunSession(conversationId, 'turn-event-grained-truncate-first', { kind: 'user_input' });
    await coordinator.appendEventsToRun(firstSession, [routeForRun(first, firstSession.runId)]);
    await coordinator.completeRun(firstSession);
    const secondSession = await coordinator.createExplicitRunSession(conversationId, 'turn-event-grained-truncate-second', { kind: 'user_input' });
    await coordinator.appendEventsToRun(secondSession, [routeForRun(second, secondSession.runId)]);
    await coordinator.completeRun(secondSession);

    const result = await repository.truncateFromEvent(conversationId, second.id);

    expect(result.found).toBe(true);
    expect(countRows(db, 'runs')).toBe(1);
    expect(countRows(db, 'events')).toBe(1);
    expect(countRows(db, 'conversation_ui_messages')).toBe(1);

    const rawEvents = await store.readEvents(conversationId, { direction: 'forward', limit: 10 });
    expect(rawEvents.events.map(event => event.id)).toEqual(['event-grained-truncate-first']);

    store.close();
  });
});
