import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import Database from 'better-sqlite3';
import { createFinalAnswerEvent, createUserInputEvent, routeRuntimeEvent } from '@linnlabs/linnkit/contracts';
import { SQLiteEventStore } from '../../../src/app-hosts/linnya/adapters/persistence/event-store';

/** 隔离探针夹具也必须落 canonical facts，不能只塞可被后台重建清空的 UI projection。 */
const [probeRoot, databasePath] = process.argv.slice(2);
assert.ok(probeRoot && databasePath);
const scope = relative(realpathSync(probeRoot), realpathSync(databasePath));
assert.ok(scope && !scope.startsWith('..') && !isAbsolute(scope));
const db = new Database(databasePath);
try {
  const store = new SQLiteEventStore(db);
  const rows = db.prepare<[], { conversation_id: string; title: string; last_event_at: number }>(
    "SELECT conversation_id, title, last_event_at FROM conversations WHERE conversation_id IN ('query-a', 'query-b', 'query-private')",
  ).all();
  for (const row of rows) {
    const runId = `run-${row.conversation_id}`;
    const turnId = `turn-${row.conversation_id}`;
    const session = await store.openRunSession(row.conversation_id, runId);
    const routing = { run_id: runId, lane: 'foreground' as const, visibility: 'conversation' as const };
    await store.appendEventToRun(session, routeRuntimeEvent(createUserInputEvent(
      `question-${row.conversation_id}`, row.conversation_id, turnId, `${row.title}：请分析报价`, { timestamp: row.last_event_at - 1 },
    ), routing));
    await store.appendEventToRun(session, routeRuntimeEvent(createFinalAnswerEvent(
      `answer-${row.conversation_id}`, row.conversation_id, turnId, `${row.title}：可读回答`,
      { timestamp: row.last_event_at, completion_reason: 'interrupted' },
    ), routing));
    db.prepare('UPDATE conversations SET last_event_at = ? WHERE conversation_id = ?').run(row.last_event_at, row.conversation_id);
  }
} finally { db.close(); }
