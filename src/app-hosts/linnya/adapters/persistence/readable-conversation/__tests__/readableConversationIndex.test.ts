import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { READABLE_CONVERSATION_SCHEMAS } from '../readableConversation.schema';
import { buildReadableConversationMatch } from '../readableConversationMatch';
import { migrateV76ToV77ReadableConversationIndex } from 'src/electron-main/services/database/migrations/v76-to-v77-readable-conversation-index';

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function createDb(withIndex: boolean): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  db.exec(`CREATE TABLE conversation_ui_messages (
    message_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, message_type TEXT NOT NULL,
    sort_seq INTEGER NOT NULL, timestamp INTEGER NOT NULL, content TEXT
  )`);
  if (withIndex) for (const ddl of READABLE_CONVERSATION_SCHEMAS) db.exec(ddl);
  return db;
}

const insert = (db: Database.Database, id: string, type: string, content: string | null) => db.prepare(
  'INSERT INTO conversation_ui_messages VALUES (?, ?, ?, ?, ?, ?)'
).run(id, 'conv', type, Number(id.replace(/\D/g, '')) || 0, 1, content);

const matches = (db: Database.Database, query: string) => db.prepare<[string], { message_id: string }>(`
  SELECT m.message_id FROM conversation_readable_fts f
  JOIN conversation_ui_messages m ON m.rowid = f.rowid
  WHERE conversation_readable_fts MATCH ? ORDER BY m.message_id
`).all(buildReadableConversationMatch(query) ?? '').map(row => row.message_id);

it('只收录可读消息；改写、改类型和删除都同步撤回旧内容', () => {
  const db = createDb(true);
  insert(db, 'm1', 'user_input', '帮我比较欧洲渠道');
  insert(db, 'm2', 'thought', '欧洲渠道的思考过程');
  insert(db, 'm3', 'tool_calls', null);
  insert(db, 'm4', 'final_answer', '欧洲渠道按国家列出');
  expect(matches(db, '欧洲渠道')).toEqual(['m1', 'm4']);

  db.prepare("UPDATE conversation_ui_messages SET content = '定价按德国口径' WHERE message_id = 'm4'").run();
  expect(matches(db, '欧洲渠道')).toEqual(['m1']);
  expect(matches(db, '德国口径')).toEqual(['m4']);

  // 两版共有的三字组不能被误删。
  db.prepare("UPDATE conversation_ui_messages SET content = '定价按德国口径更新' WHERE message_id = 'm4'").run();
  expect(matches(db, '德国口径')).toEqual(['m4']);

  db.prepare("UPDATE conversation_ui_messages SET message_type = 'thought' WHERE message_id = 'm1'").run();
  expect(matches(db, '欧洲渠道')).toEqual([]);

  db.prepare("DELETE FROM conversation_ui_messages WHERE message_id = 'm4'").run();
  expect(matches(db, '德国口径')).toEqual([]);
  db.exec("INSERT INTO conversation_readable_fts(conversation_readable_fts) VALUES ('integrity-check')");
});

it('v76→v77 给已有可读消息建索引，此后新消息由触发器接上', () => {
  const db = createDb(false);
  insert(db, 'm1', 'user_input', '电池供应链资料');
  insert(db, 'm2', 'thought', '电池供应链的思考');
  db.transaction(() => migrateV76ToV77ReadableConversationIndex(db))();
  for (const ddl of READABLE_CONVERSATION_SCHEMAS) db.exec(ddl);
  expect(matches(db, '电池供应链')).toEqual(['m1']);
  insert(db, 'm3', 'final_answer', '电池供应链整理完了');
  expect(matches(db, '电池供应链')).toEqual(['m1', 'm3']);
});
