import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateV79ToV80KnowledgeIndexIdentity } from 'src/electron-main/services/database/migrations/v79-to-v80-knowledge-index-identity';
import { KNOWLEDGE_BASE_SCHEMAS } from '../knowledge/src/backend/database/schemas';

describe('knowledge index identity migration', () => {
  it('old metadata keeps its model reference and source records without inventing a vector identity', () => {
    const database = new Database(':memory:');
    try {
      database.exec(`CREATE TABLE knowledge_bases(id TEXT PRIMARY KEY, name TEXT, embedding_model_id TEXT);
        CREATE TABLE kb_documents(id TEXT PRIMARY KEY, kb_id TEXT, status TEXT);
        INSERT INTO knowledge_bases VALUES ('library','Library','old-model');
        INSERT INTO kb_documents VALUES ('document','library','failed');`);
      migrateV79ToV80KnowledgeIndexIdentity(database);
      migrateV79ToV80KnowledgeIndexIdentity(database);
      expect(database.prepare('SELECT * FROM knowledge_bases').get()).toEqual({
        id: 'library',
        name: 'Library',
        embedding_model_id: 'old-model',
        embedding_space_id: null,
      });
      expect(database.prepare('SELECT * FROM kb_documents').get()).toEqual({
        id: 'document',
        kb_id: 'library',
        status: 'failed',
      });
    } finally {
      database.close();
    }
  });
  it('fresh schema already owns the field; running historical migration does not reset a valid identity', () => {
    const database = new Database(':memory:');
    try {
      database.exec('CREATE TABLE projects(id TEXT PRIMARY KEY)');
      for (const ddl of KNOWLEDGE_BASE_SCHEMAS) database.exec(ddl);
      database
        .prepare(
          'INSERT INTO knowledge_bases(id,name,created_at,embedding_space_id) VALUES (?,?,?,?)'
        )
        .run('library', 'Library', 0, 'known-space');
      migrateV79ToV80KnowledgeIndexIdentity(database);
      expect(database.prepare('SELECT embedding_space_id FROM knowledge_bases').get()).toEqual({
        embedding_space_id: 'known-space',
      });
    } finally {
      database.close();
    }
  });
});
