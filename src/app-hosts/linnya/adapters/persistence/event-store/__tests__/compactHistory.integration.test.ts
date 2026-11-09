import { expect, it } from 'vitest';
import { createThoughtEvent, createToolCallDecisionEvent, routeRuntimeEvent } from '@linnlabs/linnkit/contracts';
import { DatabaseService } from '../../../../../../electron-main/services/database';
import { runMigrationStep } from '../../../../../../electron-main/services/database/migrations';
import { runConversationMaintenanceOnce } from '../../../../../../electron-main/services/conversation/conversation-maintenance';
import { SQLiteEventStore } from '../sqlite.implementation';
import { readRuntimeEventsByIds } from '../functions/readRuntimeEventsByIds';
import { readTail } from '../ui-projection/sqliteUiMessagesReader';

it('思考更新保留原位置并读取最新正文；迁移重建与增量窗口一致', async () => {
  const service = new DatabaseService(':memory:');
  service.initialize();
  try {
    const db = service.getDb();
    const store = new SQLiteEventStore(db);
    const cid = 'thought-history';
    await store.ensureConversation(cid, [], undefined, 'agent');
    const session = await store.beginRunSession(cid, 'run', { kind: 'agent' });
    const latest = db.prepare("SELECT sort_seq,content,content_event_id FROM conversation_ui_messages WHERE message_id='thought'");
    for (const [id, content] of [['event1', '起始内容'], ['event2', '更新后的完整正文']]) {
      const thought = createThoughtEvent(id, cid, 'turn', content, { thought_message_id: 'thought', is_complete: true });
      await store.appendEventToRun(session, routeRuntimeEvent(thought, {
        run_id: session.runId, lane: 'foreground', visibility: 'conversation',
      }));
      expect(latest.get()).toEqual({ sort_seq: 1, content: null, content_event_id: id });
    }
    const initial = readTail(db, cid, 10);
    if (initial.status !== 'ready') throw new Error('Expected ready history');
    expect(initial.messages).toMatchObject([{ message_id: 'thought', content: '更新后的完整正文' }]);
    // v72 以独立正文保存这行。升级应使用最后贡献正文的事件，保留原消息 ID。
    db.exec("UPDATE conversation_ui_messages SET content='更新后的完整正文',content_event_id=NULL");
    runMigrationStep(db, 72);
    await runConversationMaintenanceOnce(service);
    const rebuilt = readTail(db, cid, 10);
    if (rebuilt.status !== 'ready') throw new Error('Expected rebuilt history');
    expect(rebuilt.messages).toEqual(initial.messages);
    expect(latest.get()).toEqual({ sort_seq: 1, content: null, content_event_id: 'event2' });
    expect(await store.deleteConversation(cid)).toBe(true);
  } finally { service.close(); }
});

it('同值参数只存一份，缺省和不同的参数分别保留；恢复按原 ID 读出相同事件', async () => {
  const service = new DatabaseService(':memory:');
  service.initialize();
  try {
    const db = service.getDb();
    const store = new SQLiteEventStore(db);
    const cid = 'tool-args';
    await store.ensureConversation(cid, [], undefined, 'agent');
    const session = await store.beginRunSession(cid, 'run', { kind: 'agent' });
    const args = { query: '检索', options: ['一', '二'] };
    const cases = [
      { args, payload: { args } },
      { args, payload: { args: { query: '另一组' } } },
      { args, payload: {} },
      { payload: { args } },
    ];
    for (const [n, fields] of cases.entries()) {
      const event = routeRuntimeEvent(createToolCallDecisionEvent('d'+n, cid, 'turn', 'search', 'call'+n, fields),
        { run_id: session.runId, lane: 'foreground', visibility: 'conversation' });
      await store.appendEventToRun(session, event);
      expect(db.prepare("SELECT payload ->> '$.__linnya_shared_tool_args' AS shared FROM events WHERE id=?")
        .get(event.id)).toEqual({ shared: n === 0 ? 1 : null });
      expect(readRuntimeEventsByIds(db, cid, [event.id])).toEqual([event]);
    }
  } finally { service.close(); }
});
