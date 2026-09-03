import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { agentUtils } from 'linnkit/context-manager';
import {
  createUserInputEvent,
  routeRuntimeEvent,
  type RoutedRuntimeEvent,
} from 'linnkit/contracts';

import {
  createFlowHistoryAccessPort,
  HistoryHandlerService,
} from 'src/app-hosts/linnya/adapters/flow/flow.history-handler.service';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { serializeStoredRuntimeEvent } from 'src/app-hosts/linnya/adapters/persistence/event-store/functions/runtimeEventStorageCodec';
import { SQLiteEventStore } from 'src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation';
import { HistoryRepository } from 'src/features/conversation/history/history.repository';

function insertRun(
  db: Database.Database,
  params: { runId: string; conversationId: string; parentRunId?: string; startedAt: number },
): void {
  db.prepare(`
    INSERT INTO runs (id, conversation_id, kind, status, parent_run_id, start_ts, updated_ts)
    VALUES (?, ?, 'agent', 'completed', ?, ?, ?)
  `).run(
    params.runId,
    params.conversationId,
    params.parentRunId ?? null,
    params.startedAt,
    params.startedAt,
  );
}

function insertRoutedEvent(
  db: Database.Database,
  event: RoutedRuntimeEvent,
): void {
  db.prepare(`
    INSERT INTO events (id, run_id, type, payload, ts)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.run_id,
    event.type,
    serializeStoredRuntimeEvent(event),
    event.timestamp,
  );
}

describe('foreground Agent history routing', () => {
  it('SQLite 默认读取保留规范 parent/child facts，但 foreground context 只接纳 parent', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
    for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);

    const conversationId = 'conversation-foreground-history-routing';
    db.prepare(`
      INSERT INTO conversations (
        conversation_id, title, created_at, last_event_at, total_events, user_message_count
      ) VALUES (?, 'routing test', 1, 2, 2, 1)
    `).run(conversationId);

    insertRun(db, { runId: 'new-parent-run', conversationId, startedAt: 1 });
    insertRun(db, {
      runId: 'new-child-run',
      conversationId,
      parentRunId: 'new-parent-run',
      startedAt: 2,
    });

    const newParent = routeRuntimeEvent(createUserInputEvent(
      'new-parent-fact',
      conversationId,
      'new-parent-turn',
      'new foreground',
      { timestamp: 1 },
    ), {
      run_id: 'new-parent-run',
      lane: 'foreground',
      visibility: 'conversation',
    });
    const newChild = routeRuntimeEvent(createUserInputEvent(
      'new-child-fact',
      conversationId,
      'new-child-turn',
      'new child',
      { timestamp: 2 },
    ), {
      run_id: 'new-child-run',
      parent_run_id: 'new-parent-run',
      lane: 'child',
      visibility: 'parent-trace',
    });

    insertRoutedEvent(db, newParent);
    insertRoutedEvent(db, newChild);

    const store = new SQLiteEventStore(db);
    try {
      const rawFacts = await store.readEvents(conversationId, {
        direction: 'forward',
        limit: 10,
      });
      expect(rawFacts.events.map(event => event.id)).toEqual([
        'new-parent-fact',
        'new-child-fact',
      ]);

      const historyHandler = new HistoryHandlerService(
        createFlowHistoryAccessPort(new HistoryRepository(store)),
      );
      const foregroundHistory = await historyHandler.readHistory(conversationId);
      expect(foregroundHistory.map(event => event.id)).toEqual([
        'new-parent-fact',
      ]);
      expect(foregroundHistory.every(
        event => event.lane === 'foreground' && event.visibility === 'conversation',
      )).toBe(true);

      const foregroundAgentMessages = agentUtils.convertEventsToAiMessages(foregroundHistory);
      expect(foregroundAgentMessages.map(message => message.id)).toEqual([
        'new-parent-fact',
      ]);
    } finally {
      store.close();
    }
  });

  it('缺少 routing identity 的历史事实必须在读取边界明确失败', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
    for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);

    const conversationId = 'conversation-invalid-history-routing';
    db.prepare(`
      INSERT INTO conversations (
        conversation_id, title, created_at, last_event_at, total_events, user_message_count
      ) VALUES (?, 'invalid routing test', 1, 1, 1, 1)
    `).run(conversationId);
    insertRun(db, { runId: 'invalid-parent-run', conversationId, startedAt: 1 });
    db.prepare(`
      INSERT INTO events (id, run_id, type, payload, ts)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'invalid-parent-fact',
      'invalid-parent-run',
      'user_input',
      JSON.stringify({
        turn_id: 'invalid-parent-turn',
        version: 1,
        content: 'missing routing identity',
        source: 'user',
      }),
      1,
    );

    const store = new SQLiteEventStore(db);
    try {
      await expect(store.readEvents(conversationId, {
        direction: 'forward',
        limit: 10,
      })).rejects.toThrow();
      await expect(store.readEvents(conversationId, {
        direction: 'forward',
        limit: 10,
        routingScope: 'foreground-conversation',
      })).rejects.toThrow();
    } finally {
      store.close();
    }
  });
});
