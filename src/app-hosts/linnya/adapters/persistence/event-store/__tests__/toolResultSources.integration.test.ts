import { describe, expect, it } from 'vitest';
import { createToolOutputEvent, parseRoutedRuntimeEvent, routeRuntimeEvent } from '@linnlabs/linnkit/contracts';
import { DatabaseService } from '../../../../../../electron-main/services/database';
import { runMigrationStep } from '../../../../../../electron-main/services/database/migrations';
import { runConversationMaintenanceOnce } from '../../../../../../electron-main/services/conversation/conversation-maintenance';
import { uiProjectionFixtures } from '../ui-projection/__fixtures__/uiProjectionFixtures';
import { isRecord } from '../ui-projection/json';
import { readTail } from '../ui-projection/sqliteUiMessagesReader';
import { SQLiteEventStore } from '../sqlite.implementation';

describe('工具卡读取产生各字段的 Runtime 事实', () => {
  it('审批回复沿用表单，随后没有 data 的错误只替换正文；重建与删除保留相同语义', async () => {
    const service = new DatabaseService(':memory:');
    service.initialize();
    const db = service.getDb();
    const store = new SQLiteEventStore(db);
    try {
      const events = uiProjectionFixtures.find(f => f.name === 'interactive-tool-wait-and-run-error')?.events;
      const decision = events?.find(e => e.type === 'tool_call_decision');
      const wait = events?.find(e => e.type === 'requires_user_interaction');
      if (!decision || !wait || !isRecord(wait.form)) throw new Error('Missing interactive tool fixture');
      const form = wait.form;
      const cid = wait.conversation_id;
      await store.ensureConversation(cid, [], undefined, 'agent');
      const session = await store.beginRunSession(cid, wait.run_id, { kind: 'agent' });
      const routing = { run_id: wait.run_id, lane: 'foreground', visibility: 'conversation' } as const;
      await store.appendEventToRun(session, parseRoutedRuntimeEvent(decision));
      await store.appendEventToRun(session, parseRoutedRuntimeEvent(wait));
      const reply = createToolOutputEvent('reply', cid, wait.turn_id, 'ask', wait.tool_call_id,
        { status: 'success', data: { approved: true }, observation: '已提交' },
        { timestamp: 730, metadata: { interaction: { status: 'approved', submittedAt: 730 } } });
      await store.appendEventToRun(session, routeRuntimeEvent(reply, routing));
      const sources = db.prepare('SELECT content_event_id, data_event_id FROM conversation_ui_messages');
      expect(sources.get()).toEqual({ content_event_id: wait.id, data_event_id: wait.id });
      expect(readTail(db, cid, 10)).toMatchObject({ messages: [{
        content: form.observation, payload: { data: form.data, interaction: { status: 'approved' } },
      }] });

      const failure = createToolOutputEvent('error-output', cid, wait.turn_id, 'ask', wait.tool_call_id,
        { status: 'error', error: '执行失败', observation: '新正文' }, { timestamp: 740 });
      await store.appendEventToRun(session, routeRuntimeEvent(failure, routing));
      expect(sources.get()).toEqual({ content_event_id: failure.id, data_event_id: wait.id });
      const page = readTail(db, cid, 10);
      expect(page).toMatchObject({ messages: [{ content: '新正文', payload: { data: form.data, status: 'error' } }] });

      runMigrationStep(db, 71);
      expect(readTail(db, cid, 10).status).toBe('preparing');
      await runConversationMaintenanceOnce(service);
      expect(sources.get()).toEqual({ content_event_id: failure.id, data_event_id: wait.id });
      const rebuilt = readTail(db, cid, 10);
      if (page.status !== 'ready' || rebuilt.status !== 'ready') throw new Error('Expected ready history');
      expect(rebuilt.messages).toEqual(page.messages);
      // 合法外键指向错误种类的事件也不能被当作空结果交给界面。
      db.prepare('UPDATE conversation_ui_messages SET data_event_id = ?').run(decision.id);
      expect(() => readTail(db, cid, 10)).toThrow('cannot read its result');
      expect(await store.deleteConversation(cid)).toBe(true);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      service.close();
    }
  });

  it('一个旧会话的坏事实不会挡住其他会话；修复后可继续重建', async () => {
    const service = new DatabaseService(':memory:');
    service.initialize();
    const db = service.getDb();
    const store = new SQLiteEventStore(db);
    try {
      for (const cid of ['healthy', 'broken']) {
        const runId = 'run-' + cid;
        await store.ensureConversation(cid, [], undefined, 'agent');
        const session = await store.beginRunSession(cid, runId, { kind: 'agent' });
        const event = createToolOutputEvent('output-' + cid, cid, 'turn', 'fixture_tool', 'call',
          { status: 'success', observation: '文件内容', data: { text: '文件内容' } },
          { timestamp: cid === 'broken' ? 2 : 1 });
        await store.appendEventToRun(session, routeRuntimeEvent(event, {
          run_id: runId, lane: 'foreground', visibility: 'conversation',
        }));
      }
      runMigrationStep(db, 71);
      const saved = db.prepare<[], { payload: string }>("SELECT payload FROM events WHERE id = 'output-broken'").get();
      if (!saved) throw new Error('Missing source event');
      const update = db.prepare("UPDATE events SET payload = ? WHERE id = 'output-broken'");
      update.run('{}');
      await runConversationMaintenanceOnce(service);
      expect(readTail(db, 'broken', 1).status).toBe('preparing');
      expect(readTail(db, 'healthy', 1)).toMatchObject({ messages: [{ content: '文件内容' }] });
      update.run(saved.payload);
      await runConversationMaintenanceOnce(service);
      expect(readTail(db, 'broken', 1)).toMatchObject({ messages: [{ content: '文件内容' }] });
    } finally {
      service.close();
    }
  });
});
