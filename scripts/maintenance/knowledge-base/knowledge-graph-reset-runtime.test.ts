import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearKnowledgeGraphTablesInDatabase,
  parseKnowledgeGraphResetArgs,
} from './knowledge-graph-reset-runtime';

const temporaryDirectories: string[] = [];

function createDatabase(): Database.Database {
  const directory = mkdtempSync(path.join(tmpdir(), 'linnya-kg-reset-'));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, 'workspace.sqlite');
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE knowledge_graph_nodes (kb_id TEXT NOT NULL, value TEXT NOT NULL);
    CREATE TABLE knowledge_graph_vector_doc_status (kb_id TEXT NOT NULL, value TEXT NOT NULL);
  `);
  return database;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('knowledge graph reset runtime', () => {
  it('按精确 kbId 参数绑定清理，不影响其他知识库', () => {
    const database = createDatabase();
    database.prepare('INSERT INTO knowledge_graph_nodes VALUES (?, ?)').run("kb'o", 'target');
    database.prepare('INSERT INTO knowledge_graph_nodes VALUES (?, ?)').run('other', 'keep');

    clearKnowledgeGraphTablesInDatabase({
      database,
      kbId: "kb'o",
      tableNames: ['knowledge_graph_nodes'],
    });

    expect(database.prepare('SELECT kb_id FROM knowledge_graph_nodes').all()).toEqual([
      { kb_id: 'other' },
    ]);
    database.close();
  });

  it('只允许维护模块声明的图谱表', () => {
    const database = createDatabase();
    expect(() => clearKnowledgeGraphTablesInDatabase({
      database,
      kbId: 'default',
      tableNames: ['workspace_nodes'],
    })).toThrow('不允许清理未知知识图谱表');
    database.close();
  });

  it('要求显式 kbId，并保留 Qdrant 选择参数', () => {
    expect(parseKnowledgeGraphResetArgs([
      '--kbId',
      'default',
      '--withQdrant',
      '--qdrantUrl',
      'http://127.0.0.1:6334',
    ])).toEqual({
      kbId: 'default',
      withQdrant: true,
      qdrantUrl: 'http://127.0.0.1:6334',
    });
    expect(() => parseKnowledgeGraphResetArgs([])).toThrow('缺少参数');
  });
});
