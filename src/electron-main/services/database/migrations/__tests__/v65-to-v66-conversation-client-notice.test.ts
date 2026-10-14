import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { CONVERSATION_SCHEMAS } from '../../../../../app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { migrateV65ToV66ConversationClientNotice } from '../v65-to-v66-conversation-client-notice';

it('recreates only the disposable UI table and admits null identity exclusively for client notices', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY)');
    for (const sql of CONVERSATION_SCHEMAS) db.exec(sql);
    db.prepare('INSERT INTO conversations(conversation_id, created_at, last_event_at) VALUES (?,1,1)').run('conv');
    db.prepare("INSERT INTO conversation_ui_projection_state(conversation_id,status,revision,last_event_rowid) VALUES ('conv','ready',7,0)").run();
    db.prepare("INSERT INTO runs(id,conversation_id,kind,status,start_ts) VALUES ('run','conv','agent','completed',1)").run();
    const runs = db.prepare('SELECT * FROM runs').all();
    expect(() => db.transaction(() => { migrateV65ToV66ConversationClientNotice(db); throw new Error('rollback'); })()).toThrow('rollback');
    expect(db.prepare('SELECT status FROM conversation_ui_projection_state').get()).toEqual({ status: 'ready' });
    db.transaction(() => migrateV65ToV66ConversationClientNotice(db))();
    expect(db.prepare('SELECT * FROM runs').all()).toEqual(runs);
    expect(db.prepare('SELECT status FROM conversation_ui_projection_state').get()).toEqual({ status: 'pending' });
    const insert = db.prepare(`INSERT INTO conversation_ui_messages(message_id,conversation_id,role,message_type,sort_seq,timestamp) VALUES (?,'conv','system',?,1,1)`);
    insert.run('client', 'client_notice');
    expect(() => insert.run('invalid', 'execution_notice')).toThrow('CHECK constraint');
  } finally { db.close(); }
});
