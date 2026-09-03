import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { allocateCitationRefs } from '../../../../../domains/citation';
import { CONVERSATION_SCHEMAS } from '../event-store/conversation.schema';
import { CITATION_REF_CLAIM_SCHEMAS } from './schema-provider';
import { SqliteCitationRefClaimStore } from './sqliteCitationRefClaimStore';

describe('SqliteCitationRefClaimStore', () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it('通过 Conversation 双唯一约束持久化复用与碰撞改道', () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
    const conversationsDdl = CONVERSATION_SCHEMAS.find(ddl =>
      ddl.includes('CREATE TABLE IF NOT EXISTS conversations')
    );
    const claimsDdl = CITATION_REF_CLAIM_SCHEMAS[0];
    if (!conversationsDdl || !claimsDdl)
      throw new Error('Conversation citation claim schema 缺失。');
    db.exec(conversationsDdl);
    db.exec(claimsDdl);
    db.prepare(
      `
      INSERT INTO conversations (
        conversation_id, title, created_at, last_event_at
      ) VALUES (?, ?, ?, ?)
    `
    ).run('conversation-1', 'test', 1, 1);

    const claimStore = new SqliteCitationRefClaimStore(db);
    const anchors = [
      { sourceType: 'web' as const, url: 'https://example.test/article?id=100759' },
      { sourceType: 'web' as const, url: 'https://example.test/article?id=355289' },
    ];
    const first = allocateCitationRefs({ conversationId: 'conversation-1', anchors, claimStore });
    const second = allocateCitationRefs({
      conversationId: 'conversation-1',
      anchors: [anchors[1]],
      claimStore,
    });

    expect(first[0]).toBe('B4Sf9g');
    expect(first[1]).not.toBe(first[0]);
    expect(second).toEqual([first[1]]);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM conversation_citation_ref_claims').get()
    ).toEqual({ count: 2 });
  });
});
