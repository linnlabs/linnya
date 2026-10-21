import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFinalAnswerEvent,
  createSubRunTraceEvent,
  createToolOutputEvent,
  routeRuntimeEvent,
  RunIdSchema,
  ToolCallIdSchema,
} from '@linnlabs/linnkit/contracts';
import { WorkspaceReadFileEventResultSchema, type WorkspaceReadFileCitation } from '@app/schemas';
import { migrateV66ToV67ConversationCitationMetadata } from '../../../../../../electron-main/services/database/migrations/v66-to-v67-conversation-citation-metadata';
import { runMigrations } from '../../../../../../electron-main/services/database/migrations';
import { SqliteSubrunTraceHistoryProjector } from '../../subrun-trace-history/sqliteSubrunTraceHistoryProjector';
import { CONVERSATION_SCHEMAS } from '../conversation.schema';
import { SQLiteEventStore } from '../sqlite.implementation';
import { readTail } from '../ui-projection/sqliteUiMessagesReader';
import { rebuildConversationUiProjection } from '../ui-projection/rebuildConversation';

const conversationId = 'conversation-metadata-history';
const runId = 'run-metadata-history';
const turnId = 'turn-metadata-history';
const webSource = {
  sourceType: 'web',
  ref: 'Ab3Def',
  index: 1,
  url: 'https://example.com/article',
  docTitle: 'Synthetic article',
  snippet: 'The acquired source text.',
  authors: ['Alice', 'Bob', 'Carol'],
  containerTitle: 'Synthetic Journal',
  publishedAt: '2026-01-02',
} satisfies WorkspaceReadFileCitation;
const knowledgeSource = {
  sourceType: 'knowledge_base',
  ref: 'Gh4Jkm',
  index: 2,
  docId: 'document-source',
  blockId: 'block-source',
  kbId: 'knowledge-collection',
  docTitle: 'Synthetic knowledge source',
  snippet: 'The cited knowledge block.',
} satisfies WorkspaceReadFileCitation;
const childSource = {
  ...webSource,
  ref: 'Lm6Tuv',
  url: 'https://example.com/child-article',
  authors: ['Dana', 'Eli'],
  containerTitle: 'Child Journal',
} satisfies WorkspaceReadFileCitation;

function createStore(path = ':memory:') {
  const db = new Database(path);
  db.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY)');
  for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);
  return { db, store: new SQLiteEventStore(db) };
}

function readFileResult(citations: readonly WorkspaceReadFileCitation[]) {
  return WorkspaceReadFileEventResultSchema.parse({
    data: {
      source_kind: 'workspace_document',
      locator: 'workspace:/source.md',
      inode: 'workspace:source-document',
      content_type: 'application/vnd.linnya.document-view',
      document: {
        documentId: 'source-document',
        docType: 'markdown',
        documentName: 'source.md',
        truncatedByChars: false,
        totalTextLength: 30,
        presentation: { kind: 'text', text: 'A source-bearing document.' },
        nextOffset: null,
      },
      citations: { citations },
      citation_diagnostics: [],
    },
    observation: 'A source-bearing document.',
  });
}

function readOutput(id: string, citations: readonly WorkspaceReadFileCitation[], timestamp: number) {
  const result = readFileResult(citations);
  return routeRuntimeEvent(createToolOutputEvent(
    id, conversationId, turnId, 'read_file', `call-${id}`,
    { status: 'success', data: result.data, observation: result.observation },
    { timestamp },
  ), { run_id: runId, lane: 'foreground', visibility: 'conversation' });
}

async function seedHistory(store: SQLiteEventStore, db: Database.Database) {
  await store.ensureConversation(conversationId, [], undefined, 'agent');
  const session = await store.beginRunSession(conversationId, runId, { kind: 'agent' });
  await store.appendEventToRun(session, readOutput('read-main', [webSource, knowledgeSource], 100));
  await store.appendEventToRun(session, routeRuntimeEvent(createToolOutputEvent(
    'parent-subagent', conversationId, turnId, 'subagent', 'call-parent',
    { status: 'success', data: { status: 'completed' }, observation: 'Child completed.' },
    { timestamp: 200 },
  ), { run_id: runId, lane: 'foreground', visibility: 'conversation' }));
  const result = readFileResult([childSource]);
  new SqliteSubrunTraceHistoryProjector(db).project(createSubRunTraceEvent(
    'trace-child-source', conversationId, turnId, 'call-parent', 'subrun-source', 'tool_output',
    {
      source_event_id: 'source-child-read',
      timestamp: 210,
      run_id: RunIdSchema.parse(runId),
      tool_name: 'read_file',
      tool_call_id: ToolCallIdSchema.parse('call-child-read'),
      status: 'success',
      output: { data: result.data, observation: result.observation },
    },
  ));
  await store.appendEventToRun(session, routeRuntimeEvent(createFinalAnswerEvent(
    'answer-source', conversationId, turnId, 'Main [@Ab3Def], knowledge [@Gh4Jkm], child [@Lm6Tuv].',
    { timestamp: 300, completion_reason: 'terminal' },
  ), { run_id: runId, lane: 'foreground', visibility: 'conversation' }));
  return session;
}

function readSources(db: Database.Database) {
  const window = readTail(db, conversationId, 1);
  if (window.status !== 'ready') throw new Error('Expected a ready citation window');
  const answer = window.messages[0];
  if (!answer) throw new Error('Expected an answer');
  const sources = window.citation_dependencies[answer.message_id];
  if (!sources) throw new Error('Expected citation dependencies');
  expect(sources.unresolved_refs).toEqual([]);
  return sources.citations;
}

describe('complete citation metadata in durable Conversation history', () => {
  it('preserves main and Subrun read_file source metadata through window, fresh connection and rebuild', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'citation-history-'));
    const file = join(directory, 'workspace.sqlite');
    const first = createStore(file);
    let firstClosed = false;
    try {
      await seedHistory(first.store, first.db);
      expect(readSources(first.db)).toEqual([webSource, knowledgeSource, childSource]);
      const events = (await first.store.readEvents(conversationId)).events;
      first.store.close();
      firstClosed = true;

      const reloaded = createStore(file);
      try {
        expect(readSources(reloaded.db)).toEqual([webSource, knowledgeSource, childSource]);
        expect(rebuildConversationUiProjection(reloaded.db, conversationId, { force: true }).status).toBe('rebuilt');
        expect(readSources(reloaded.db)).toEqual([webSource, knowledgeSource, childSource]);
        expect((await reloaded.store.readEvents(conversationId)).events).toEqual(events);
      } finally {
        reloaded.store.close();
      }
    } finally {
      if (!firstClosed) first.store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('invalidates legacy ready sidecars transactionally and rebuilds full metadata from untouched facts', async () => {
    const { db, store } = createStore();
    try {
      await seedHistory(store, db);
      const events = db.prepare('SELECT * FROM events ORDER BY rowid').all();
      const traces = db.prepare('SELECT * FROM subrun_trace_items ORDER BY id').all();
      // 复现升级前 ready 缓存：旧索引只有单作者和站点摘要，不能作为完整来源继续读取。
      db.prepare(`UPDATE conversation_ui_citation_facts SET citation_json = ? WHERE ref = ?`).run(
        JSON.stringify({ sourceType: 'web', ref: webSource.ref, index: 1,
          url: webSource.url, docTitle: webSource.docTitle, snippet: webSource.snippet,
          author: 'Alice', siteName: 'Synthetic Journal' }), webSource.ref,
      );
      expect(rebuildConversationUiProjection(db, conversationId).status).toBe('skipped');
      const oldRows = db.prepare('SELECT * FROM conversation_ui_citation_facts ORDER BY id').all();
      expect(() => db.transaction(() => {
        migrateV66ToV67ConversationCitationMetadata(db);
        throw new Error('rollback');
      })()).toThrow('rollback');
      expect(db.prepare('SELECT * FROM conversation_ui_citation_facts ORDER BY id').all()).toEqual(oldRows);
      expect(db.prepare('SELECT status FROM conversation_ui_projection_state').get()).toEqual({ status: 'ready' });

      db.pragma('user_version = 66');
      runMigrations(db, 66, 67);
      expect(db.pragma('user_version', { simple: true })).toBe(67);
      expect(db.prepare('SELECT * FROM conversation_ui_citation_facts').all()).toEqual([]);
      expect(readTail(db, conversationId, 1).status).toBe('preparing');
      expect(db.prepare('SELECT * FROM events ORDER BY rowid').all()).toEqual(events);
      expect(db.prepare('SELECT * FROM subrun_trace_items ORDER BY id').all()).toEqual(traces);
      expect(rebuildConversationUiProjection(db, conversationId).status).toBe('rebuilt');
      expect(readSources(db)).toEqual([webSource, knowledgeSource, childSource]);
      expect(db.prepare('SELECT * FROM events ORDER BY rowid').all()).toEqual(events);
      expect(db.prepare('SELECT * FROM subrun_trace_items ORDER BY id').all()).toEqual(traces);
    } finally {
      store.close();
    }
  });

  it('keeps the first complete snapshot and rejects conflicting anchors without merging metadata', async () => {
    const { db, store } = createStore();
    try {
      const session = await seedHistory(store, db);
      await store.appendEventToRun(session, readOutput('read-later', [{
        ...webSource, authors: ['Later Author'], containerTitle: 'Later Journal',
      }], 400));
      await store.appendEventToRun(session, routeRuntimeEvent(createFinalAnswerEvent(
        'answer-later', conversationId, turnId, 'Still the original source [@Ab3Def].',
        { timestamp: 500, completion_reason: 'terminal' },
      ), { run_id: runId, lane: 'foreground', visibility: 'conversation' }));
      expect(readSources(db)).toEqual([webSource]);
      const before = (await store.readEvents(conversationId)).events;
      await expect(store.appendEventToRun(session, readOutput('read-conflict', [{
        ...webSource, url: 'https://example.com/different-source',
      }], 600))).rejects.toThrow(/两个不同来源/);
      expect((await store.readEvents(conversationId)).events).toEqual(before);
      expect(rebuildConversationUiProjection(db, conversationId, { force: true }).status).toBe('rebuilt');
      expect(readSources(db)).toEqual([webSource]);
    } finally {
      store.close();
    }
  });
});
