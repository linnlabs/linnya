import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearKnowledgeGraphTablesInDatabase,
  deleteKnowledgeGraphVectorCollections,
  assertMaintenanceCollectionSegment,
  parseKnowledgeGraphResetArgs,
} from './knowledge-graph-reset-runtime';

import { QdrantAdapter } from '../../src/backend/infrastructure/vector-store';

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
  vi.restoreAllMocks();
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
    expect(() =>
      clearKnowledgeGraphTablesInDatabase({
        database,
        kbId: 'default',
        tableNames: ['workspace_nodes'],
      })
    ).toThrow('不允许清理未知知识图谱表');
    database.close();
  });

  it('要求显式 kbId，并保留 Qdrant 选择参数', () => {
    expect(
      parseKnowledgeGraphResetArgs([
        '--kbId',
        'default',
        '--withQdrant',
        '--qdrantUrl',
        'http://127.0.0.1:6334',
      ])
    ).toMatchObject({
      kbId: 'default',
      withQdrant: true,
      qdrantUrl: 'http://127.0.0.1:6334',
    });
    expect(() => parseKnowledgeGraphResetArgs([])).toThrow('缺少参数');
  });
});

it('非法维护目标在任何数据库写入或向量请求前拒绝', async () => {
  const database = createDatabase();
  database.prepare('INSERT INTO knowledge_graph_nodes VALUES (?, ?)').run('keep', 'source');
  const request = vi.spyOn(QdrantAdapter.prototype, 'collectionExists');
  for (const kbId of ['../other', 'a/../../other', 'a\\other', '.', '..', 'C:other']) {
    expect(() => parseKnowledgeGraphResetArgs(['--kbId', kbId])).toThrow('单段');
    expect(() => assertMaintenanceCollectionSegment(kbId)).toThrow('单段');
    expect(() =>
      clearKnowledgeGraphTablesInDatabase({ database, kbId, tableNames: ['knowledge_graph_nodes'] })
    ).toThrow('单段');
    await expect(
      deleteKnowledgeGraphVectorCollections({
        kbId,
        withQdrant: true,
        qdrantUrl: 'http://127.0.0.1:6333',
        workspaceDb: database.name,
        workspaceRoot: path.dirname(database.name),
      })
    ).rejects.toThrow('单段');
  }
  expect(request).not.toHaveBeenCalled();
  expect(database.prepare('SELECT kb_id FROM knowledge_graph_nodes').all()).toEqual([
    { kb_id: 'keep' },
  ]);
  database.close();
});

it('远端失败不转删本地；本机离线清理只删除目标库的两个集合', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'linnya-kg-offline-'));
  temporaryDirectories.push(root);
  const collections = path.join(root, 'KnowledgeBase/qdrant/storage/collections');
  for (const collection of ['kg_nodes_a', 'kg_edges_a', 'kg_nodes_b', 'kg_edges_b']) {
    mkdirSync(path.join(collections, collection), { recursive: true });
    writeFileSync(path.join(collections, collection, 'segment'), collection);
  }
  const failure = new Error('fixture endpoint unavailable');
  vi.spyOn(QdrantAdapter.prototype, 'collectionExists').mockRejectedValue(failure);
  const args = {
    kbId: 'a',
    withQdrant: true,
    workspaceDb: path.join(root, 'workspace.sqlite'),
    workspaceRoot: root,
    qdrantUrl: 'https://remote.invalid',
  };
  await expect(deleteKnowledgeGraphVectorCollections(args)).rejects.toBe(failure);
  for (const collection of ['kg_nodes_a', 'kg_edges_a', 'kg_nodes_b', 'kg_edges_b']) {
    expect(readFileSync(path.join(collections, collection, 'segment'), 'utf8')).toBe(collection);
  }
  vi.restoreAllMocks();
  const offline = createServer();
  await new Promise<void>(resolve => offline.listen(0, '127.0.0.1', resolve));
  const address = offline.address();
  if (!address || typeof address === 'string') throw new Error('fixture address missing');
  await new Promise<void>((resolve, reject) =>
    offline.close(error => (error ? reject(error) : resolve()))
  );
  await deleteKnowledgeGraphVectorCollections({
    ...args,
    qdrantUrl: `http://127.0.0.1:${address.port}`,
  });
  expect(existsSync(path.join(collections, 'kg_nodes_a'))).toBe(false);
  expect(existsSync(path.join(collections, 'kg_edges_a'))).toBe(false);
  for (const collection of ['kg_nodes_b', 'kg_edges_b'])
    expect(readFileSync(path.join(collections, collection, 'segment'), 'utf8')).toBe(collection);
});

it('本机 HTTP 拒绝、服务错误与超时不触发离线目录清理', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'linnya-kg-http-failure-'));
  temporaryDirectories.push(root);
  const collections = path.join(root, 'KnowledgeBase/qdrant/storage/collections');
  const names = ['kg_nodes_a', 'kg_edges_a', 'kg_nodes_b', 'kg_edges_b'];
  for (const collection of names) {
    mkdirSync(path.join(collections, collection), { recursive: true });
    writeFileSync(path.join(collections, collection, 'segment'), collection);
  }
  let status = 401;
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: { error: 'fixture error' }, time: 0 }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture address missing');
  const args = {
    kbId: 'a',
    withQdrant: true,
    workspaceDb: path.join(root, 'workspace.sqlite'),
    workspaceRoot: root,
    qdrantUrl: `http://127.0.0.1:${address.port}`,
  };
  try {
    for (status of [401, 403, 500]) {
      await expect(deleteKnowledgeGraphVectorCollections(args)).rejects.toMatchObject({
        httpStatus: status,
      });
      for (const collection of names)
        expect(readFileSync(path.join(collections, collection, 'segment'), 'utf8')).toBe(
          collection
        );
    }
    const timeout = Object.assign(new Error('fixture timed out'), { code: 'ETIMEDOUT' });
    vi.spyOn(QdrantAdapter.prototype, 'collectionExists').mockRejectedValue(timeout);
    await expect(deleteKnowledgeGraphVectorCollections(args)).rejects.toBe(timeout);
    for (const collection of names)
      expect(readFileSync(path.join(collections, collection, 'segment'), 'utf8')).toBe(collection);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
});
