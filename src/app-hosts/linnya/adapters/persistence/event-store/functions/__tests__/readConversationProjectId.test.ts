import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { readConversationProjectId } from '../../projection';

describe('conversation project projection', () => {
  it('follows formal project moves, ignores metadata and stops returning ownership after deletion', () => {
    const database = new Database(':memory:');
    try {
      database.exec('CREATE TABLE conversations(conversation_id TEXT PRIMARY KEY, project_id TEXT, metadata TEXT)');
      database.prepare('INSERT INTO conversations VALUES (?, ?, ?)').run('conversation', 'project-a', JSON.stringify({ project_id: 'wrong' }));
      expect(readConversationProjectId(database, 'conversation')).toBe('project-a');
      database.prepare('UPDATE conversations SET project_id = ?').run('project-b'); expect(readConversationProjectId(database, 'conversation')).toBe('project-b');
      database.prepare('UPDATE conversations SET project_id = NULL').run(); expect(readConversationProjectId(database, 'conversation')).toBeNull();
      database.prepare('DELETE FROM conversations').run(); expect(readConversationProjectId(database, 'conversation')).toBeNull();
    } finally { database.close(); }
  });
});
