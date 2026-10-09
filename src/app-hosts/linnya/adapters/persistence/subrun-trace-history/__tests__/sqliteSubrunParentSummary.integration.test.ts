import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  createSubRunTraceEvent,
  createToolCallDecisionEvent,
  createToolOutputEvent,
  routeRuntimeEvent,
  RunIdSchema,
  type RuntimeEvent,
  type SubRunTraceEvent,
} from '@linnlabs/linnkit/contracts';
import { CONVERSATION_SCHEMAS } from '../../event-store/conversation.schema';
import { SQLiteEventStore } from '../../event-store/sqlite.implementation';
import { readTail, readSubrunTrace } from '../../event-store/ui-projection/sqliteUiMessagesReader';
import { rebuildConversationUiProjection } from '../../event-store/ui-projection/rebuildConversation';
import { SqliteSubrunTraceHistoryProjector } from '../sqliteSubrunTraceHistoryProjector';

const conversationId = 'parent-summary';
const parentRunId = RunIdSchema.parse('parent-run');
const parentToolCallId = 'parent-call';

function createStore() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);
  db.prepare('INSERT INTO conversations (conversation_id, created_at, last_event_at) VALUES (?, 1, 1)').run(conversationId);
  return { db, store: new SQLiteEventStore(db), traces: new SqliteSubrunTraceHistoryProjector(db) };
}

function routed(event: RuntimeEvent) {
  return routeRuntimeEvent(event, { run_id: parentRunId, lane: 'foreground', visibility: 'conversation' });
}

function trace(subrunId: string, kind: SubRunTraceEvent['kind'], id: string): SubRunTraceEvent {
  return createSubRunTraceEvent(`trace-${id}`, conversationId, 'parent-turn', parentToolCallId, subrunId, kind, {
    source_event_id: id, run_id: parentRunId, timestamp: 2,
    content: 'Actual child activity',
    ...(kind === 'final_answer' ? { answer_id: `answer-${id}`, completion_reason: 'terminal' } : {}),
  });
}

function parentWindow(db: Database.Database) {
  const window = readTail(db, conversationId, 10);
  if (window.status !== 'ready') throw new Error('Expected ready UI window');
  const message = window.messages[0];
  if (message?.message_type !== 'tool_calls') throw new Error('Expected parent tool message');
  return { ...window, parent: message };
}

describe('parent subrun index from compact history', () => {
  for (const toolName of ['subagent', 'subrun_batch', 'research_run']) {
    it.each(['success', 'error', 'cancelled'] as const)(`${toolName} retains started children through %s and rebuild`, async outcome => {
      const { db, store, traces } = createStore();
      try {
        const session = await store.beginRunSession(conversationId, parentRunId, { kind: 'agent' });
        await store.appendEventToRun(session, routed(createToolCallDecisionEvent('decision', conversationId, 'parent-turn', toolName, parentToolCallId, {
          timestamp: 1, payload: { args: { description: 'Research question' } },
        })));
        const before = parentWindow(db);
        traces.project(trace('started-unsaved', 'thought_delta', 'first-frame'));
        const running = parentWindow(db);
        expect(running.parent.payload).toMatchObject({
          status: 'loading', subrun_summary: { subrun_ids: ['started-unsaved'], event_counts: { 'started-unsaved': 0 } },
        });
        expect(running.revision).toBe(before.revision + 1);
        traces.project(trace('started-unsaved', 'thought_delta', 'next-frame'));
        expect(parentWindow(db).revision).toBe(running.revision);
        rebuildConversationUiProjection(db, conversationId, { force: true });
        expect(parentWindow(db).parent).toEqual(running.parent);
        traces.project(trace('saved-child', 'final_answer', 'child-finished'));

        const result = outcome === 'success'
          ? { status: 'success' as const, data: { subrun_ids: ['saved-child'] }, observation: 'Saved child document' }
          : { status: 'error' as const, observation: outcome, error: outcome, error_code: outcome === 'cancelled' ? 'CANCELLED' : 'CHILD_FAILED' };
        await store.appendEventToRun(session, routed(createToolOutputEvent('output', conversationId, 'parent-turn', toolName, parentToolCallId, result, { timestamp: 3 })));
        const terminal = parentWindow(db);
        expect(terminal.parent.payload).toMatchObject({
          status: outcome === 'success' ? 'success' : 'error',
          subrun_summary: {
            subrun_ids: outcome === 'success' ? ['saved-child', 'started-unsaved'] : ['started-unsaved', 'saved-child'],
            event_counts: { 'saved-child': 1, 'started-unsaved': 0 },
          },
        });
        expect(db.prepare('SELECT type FROM events ORDER BY rowid').all()).toEqual([
          { type: 'tool_call_decision' }, { type: 'tool_output' },
        ]);
        expect(readSubrunTrace(db, conversationId, parentToolCallId, 'saved-child')).toMatchObject({
          status: 'ready', events: [expect.objectContaining({ source_event_id: 'child-finished' })],
        });
        rebuildConversationUiProjection(db, conversationId, { force: true });
        expect(parentWindow(db).parent).toEqual(terminal.parent);
      } finally {
        db.close();
      }
    });
  }

  it('rolls back trace binding, semantic item and revision if the parent index cannot commit', async () => {
    const { db, store, traces } = createStore();
    try {
      const session = await store.beginRunSession(conversationId, parentRunId, { kind: 'agent' });
      await store.appendEventToRun(session, routed(createToolCallDecisionEvent('decision', conversationId, 'parent-turn', 'subagent', parentToolCallId, {
        timestamp: 1, payload: { args: {} },
      })));
      const before = parentWindow(db);
      db.exec(`CREATE TRIGGER reject_parent_update BEFORE UPDATE ON conversation_ui_messages BEGIN SELECT RAISE(ABORT, 'parent index rejected'); END`);
      expect(() => traces.project(trace('child', 'final_answer', 'failed-commit'))).toThrow('parent index rejected');
      expect(db.prepare('SELECT * FROM subrun_trace_runs').all()).toEqual([]);
      expect(db.prepare('SELECT * FROM subrun_trace_items').all()).toEqual([]);
      expect(parentWindow(db)).toEqual(before);
    } finally {
      db.close();
    }
  });

  it('never invents a foreground row or crosses parent run identity for nested traces', async () => {
    const { db, store, traces } = createStore();
    try {
      const session = await store.beginRunSession(conversationId, parentRunId, { kind: 'agent' });
      await store.appendEventToRun(session, routed(createToolCallDecisionEvent('decision', conversationId, 'parent-turn', 'subagent', parentToolCallId, {
        timestamp: 1, payload: { args: {} },
      })));
      const before = parentWindow(db);
      traces.project({ ...trace('nested-child', 'final_answer', 'nested-finished'), run_id: RunIdSchema.parse('another-parent-run') });
      expect(parentWindow(db)).toEqual(before);
      expect(db.prepare('SELECT subrun_id FROM subrun_trace_runs').all()).toEqual([{ subrun_id: 'nested-child' }]);
    } finally {
      db.close();
    }
  });
});
