import Database from 'better-sqlite3';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingRequest } from '@plugin/backend/inferenceRuntime';
import { BlockType, type DocumentSoT } from '../../domain/block';
import { createDocument, DocumentStatus } from '../../domain/document';
import { createKnowledgeBase } from '../../domain/knowledgeBase';
import { KNOWLEDGE_BASE_SCHEMAS } from '../../database/schemas/knowledgeBase';
import { KNOWLEDGE_GRAPH_SCHEMAS } from '../../database/schemas/knowledgeGraph';
import { BetterSqliteMetadataRepository } from '../../infrastructure/sqlite/better-sqlite-metadata.repository';
import { BetterSqliteKnowledgeGraphRepository } from '../../graph/infrastructure/better-sqlite-knowledge-graph.repository';
import { FileSotRepository } from '../../infrastructure/sotRepository';
import type { QdrantPoint } from '../../infrastructure/qdrantRepository';
import { getGraphNodesCollectionName, getGraphEdgesCollectionName } from '../../graph/infrastructure/qdrantCollections';
import { createKnowledgeActivityOwner } from '../../runtime/orchestration/createKnowledgeActivityOwner';
import { PendingHandler } from '../../ingestion/handlers/PendingHandler';
import { InternalStage } from '../../ingestion/definitions/state';
import { IngestionStateMachine } from '../../ingestion/stateMachine';
import { rebuildKnowledgeIndex, type KnowledgeIndexRebuildDependencies } from './rebuildKnowledgeIndex';
import { createKnowledgeIndexRebuildOwner } from './createKnowledgeIndexRebuildOwner';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture(blockCount = 25) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-rebuild-'));
  const dbPath = path.join(root, 'workspace.sqlite');
  let database = new Database(dbPath);
  cleanups.push(async () => { database.close(); await rm(root, { recursive: true, force: true }); });
  database.exec('CREATE TABLE projects(id TEXT PRIMARY KEY)');
  for (const ddl of [...KNOWLEDGE_BASE_SCHEMAS, ...KNOWLEDGE_GRAPH_SCHEMAS]) database.exec(ddl);
  let metadata = new BetterSqliteMetadataRepository(database);
  let graph = new BetterSqliteKnowledgeGraphRepository(database);
  await metadata.createKnowledgeBase(createKnowledgeBase('other', 'Other'));
  metadata.indexState.publishRebuilt('default', { modelId: 'old-model', spaceId: 'old-space' });
  metadata.indexState.publishRebuilt('other', { modelId: 'other-model', spaceId: 'other-space' });
  database.prepare('INSERT INTO projects(id) VALUES (?)').run('project');
  database.prepare('INSERT INTO project_knowledge_base_links(project_id,kb_id,role,created_at,updated_at) VALUES (?,?,?,?,?)').run('project', 'default', 'read_only', 0, 0);
  const directory = path.join(root, 'sot');
  await mkdir(directory);
  const sot = new FileSotRepository(directory);
  const source: DocumentSoT = {
    doc_id: 'doc',
    doc_title: 'Source',
    metadata: {},
    content_blocks: {},
    structure: { root: [] },
  };
  if (blockCount) {
    await metadata.addDocument({ ...createDocument('doc', 'default', 'source.md', 42), status: DocumentStatus.FAILED });
    for (let i = 0; i < blockCount; i++) {
      const id = `block-${i}`;
      source.content_blocks[id] = { block_type: BlockType.PARAGRAPH, text: `apple train sample ${i}` };
      source.structure.root.push(id);
    }
    await sot.save('doc', source);
    await graph.upsertNodes([
      {
        kbId: 'default',
        id: 'apple',
        name: 'Apple',
        canonicalName: 'apple',
        sourceDocId: 'doc',
        sourceBlockId: 'block-0',
      },
      {
        kbId: 'default',
        id: 'train',
        name: 'Train',
        canonicalName: 'train',
        sourceDocId: 'doc',
        sourceBlockId: 'block-1',
      },
    ]);
    await graph.upsertEdges([{ kbId: 'default', id: 'edge', sourceEntityId: 'apple', targetEntityId: 'train', relationType: 'on', evidenceDocId: 'doc', evidenceBlockId: 'block-0' }]);
  }
  // 向量端仅模拟存储协议；SQLite、SoT、图谱和任务生命周期均运行正式实现。
  const collections = new Map<string, Map<string, QdrantPoint>>([['default', new Map()], ['other', new Map()]]);
  const vectors: KnowledgeIndexRebuildDependencies['vectors'] = {
    collectionExists: vi.fn(async name => collections.has(name)),
    deleteCollection: vi.fn(async name => { collections.delete(name); }),
    getOrCreateCollection: vi.fn(async name => { if (!collections.has(name)) collections.set(name, new Map()); }),
    addPoints: vi.fn(async (name, points) => {
      const collection = collections.get(name);
      if (!collection) throw new Error('collection missing');
      for (const point of points) collection.set(point.id, point);
    }),
    countPointsByIds: async (name, ids) => ids.filter(id => collections.get(name)?.has(id)).length,
  };
  const requests: EmbeddingRequest[] = [];
  let failAt = 0;
  const embedding: KnowledgeIndexRebuildDependencies['embedding'] = {
    embed: async request => {
      requests.push(request);
      request.signal?.throwIfAborted();
      if (requests.length === failAt) throw new Error('fixture upstream rejected');
      return { spaceId: 'new-space', vectors: request.values.map(() => [0.1, 0.2, 0.3]) };
    },
  };
  const deps = {
    get metadata() {
      return metadata;
    },
    get graph() {
      return graph;
    },
    sot,
    vectors,
    embedding,
  };
  const input = (signal = new AbortController().signal) => ({
    deps,
    kbId: 'default',
    modelId: 'new-model',
    signal,
    progress: () => {},
  });
  return {
    deps, input, requests, collections, root,
    failOn(call: number) { failAt = call; },
    sourceBytes: () => readFile(path.join(directory, 'doc.source.json'), 'utf8'),
    links: () => database.prepare('SELECT * FROM project_knowledge_base_links').all(),
    reopen() { database.close(); database = new Database(dbPath); metadata = new BetterSqliteMetadataRepository(database); graph = new BetterSqliteKnowledgeGraphRepository(database); },
  };
}

describe('rebuild retained knowledge sources', () => {
  it('successful rebuild preserves source bytes, document identity and project role; chunk and graph share the new space', async () => {
    const f = await fixture();
    const before = await f.sourceBytes();
    const links = f.links();
    const nodes = await f.deps.graph.listNodesBySourceDocId('default', 'doc');
    const result = await rebuildKnowledgeIndex(f.input());
    expect(result.points).toBe(28);
    expect(await f.sourceBytes()).toBe(before);
    expect(f.links()).toEqual(links);
    expect(await f.deps.graph.listNodesBySourceDocId('default', 'doc')).toEqual(nodes);
    expect((await f.deps.metadata.getDocumentById('doc'))?.status).toBe(DocumentStatus.COMPLETED);
    expect(f.collections.get('default')?.size).toBe(25);
    expect(f.collections.get(getGraphNodesCollectionName('default'))?.size).toBe(2);
    expect(f.collections.get(getGraphEdgesCollectionName('default'))?.size).toBe(1);
    expect(f.requests.slice(1).every(request => request.expectedSpaceId === 'new-space')).toBe(true);
    expect(f.deps.metadata.indexState.requireReady('default')).toEqual({ modelId: 'new-model', spaceId: 'new-space' });
    expect((await f.deps.graph.getVectorDocStatus('default', 'doc'))?.embeddingModelId).toBe('new-model');
    expect(f.deps.metadata.indexState.requireReady('other').spaceId).toBe('other-space');
  });

  it('reimport of retained failed content guides rebuild without duplicating source or losing its identity', async () => {
    const f = await fixture();
    const before = await f.sourceBytes();
    const upload = path.join(f.root, 'retry.md');
    await writeFile(upload, 'x'.repeat(42));
    await f.deps.metadata.addDocument(createDocument('retry', 'default', 'source.md', 42));
    const result = await new PendingHandler(f.deps.metadata, f.deps.sot).execute({
      taskId: 'retry-task', docId: 'retry', kbId: 'default', filename: 'source.md', filePath: upload,
      embeddingModelId: 'old-model', currentProgress: 0, stageProgress: 0, lastUpdated: Date.now(),
    });
    expect(result.newStage).toBe(InternalStage.DUPLICATE);
    expect(result.message).toContain('重建');
    expect(IngestionStateMachine.createFrontendState(result.context, result.newStage).message).toContain('重建');
    expect(await f.deps.metadata.getDocumentById('retry')).toBeUndefined();
    // 重传按重复收口，不启动第二次解析/向量写；旧资料仍由同一 ID 重建。
    expect(await f.deps.metadata.getDocumentById('doc')).toMatchObject({ id: 'doc', kbId: 'default', status: DocumentStatus.FAILED });
    expect(await f.sourceBytes()).toBe(before);
    await rebuildKnowledgeIndex(f.input());
    expect(await f.deps.metadata.getDocumentById('doc')).toMatchObject({ id: 'doc', kbId: 'default', status: DocumentStatus.COMPLETED });
    expect(f.collections.get('default')?.size).toBe(25);
    expect(await f.sourceBytes()).toBe(before);
  });

  it('failed uploads without saved content can retry while retaining the previous record', async () => {
    const f = await fixture(0);
    const upload = path.join(f.root, 'retry.md');
    await writeFile(upload, 'x'.repeat(42));
    await f.deps.metadata.addDocument({ ...createDocument('failed-original', 'default', 'source.md', 42), status: DocumentStatus.FAILED });
    await f.deps.metadata.addDocument(createDocument('retry', 'default', 'source.md', 42));
    const result = await new PendingHandler(f.deps.metadata, f.deps.sot).execute({
      taskId: 'retry-task', docId: 'retry', kbId: 'default', filename: 'source.md', filePath: upload,
      embeddingModelId: 'old-model', currentProgress: 0, stageProgress: 0, lastUpdated: Date.now(),
    });
    expect(result.newStage).toBe(InternalStage.PARSING);
    expect(await f.deps.metadata.getDocumentById('failed-original')).toMatchObject({ status: DocumentStatus.FAILED });
    expect(await f.deps.metadata.getDocumentById('retry')).toBeDefined();
  });

  it('first model rejection leaves the existing index usable and never starts vectors', async () => {
    const f = await fixture(); f.failOn(1);
    await expect(rebuildKnowledgeIndex(f.input())).rejects.toThrow('upstream rejected');
    expect(f.deps.vectors.collectionExists).not.toHaveBeenCalled();
    expect(f.deps.metadata.indexState.requireReady('default').spaceId).toBe('old-space');
  });

  it('midway failure survives reopening as unavailable, retains sources and can explicitly retry', async () => {
    const f = await fixture(); const before = await f.sourceBytes(); f.failOn(2);
    await expect(rebuildKnowledgeIndex(f.input())).rejects.toThrow('upstream rejected');
    expect(f.collections.get('default')?.size).toBe(20);
    f.reopen();
    expect(() => f.deps.metadata.indexState.requireReady('default')).toThrow('重建');
    expect(await f.sourceBytes()).toBe(before);
    expect(f.deps.metadata.indexState.requireReady('other').spaceId).toBe('other-space');
    f.failOn(0);
    await rebuildKnowledgeIndex(f.input());
    expect(f.deps.metadata.indexState.requireReady('default').spaceId).toBe('new-space');
    expect(await f.sourceBytes()).toBe(before);
  });

  it('cancel stops following batches; owner shutdown drains the same task, releases exclusivity and keeps sources', async () => {
    const f = await fixture();
    const controller = new AbortController();
    await expect(rebuildKnowledgeIndex({ ...f.input(controller.signal), progress: () => controller.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.requests).toHaveLength(1);
    expect(() => f.deps.metadata.indexState.requireReady('default')).toThrow('重建');
    const activity = createKnowledgeActivityOwner();
    const owner = createKnowledgeIndexRebuildOwner(f.deps, activity);
    const task = await owner.start('default', 'new-model');
    expect(() => activity.begin('default', 'ingestion')).toThrow('知识库');
    const otherLease = activity.begin('other', 'ingestion'); otherLease.release();
    await activity.drain();
    expect(owner.get('default')).toMatchObject({ taskId: task.taskId, status: 'cancelled' });
    expect(activity.hasActivity()).toBe(false);
    expect(await f.deps.sot.get('doc')).toBeDefined();
  });

  it('empty library rejects without a model request, vector process, or activity lease', async () => {
    const f = await fixture(0);
    const activity = createKnowledgeActivityOwner();
    const owner = createKnowledgeIndexRebuildOwner(f.deps, activity);
    await expect(owner.start('default', 'new-model')).rejects.toThrow('没有可重建');
    expect(f.requests).toHaveLength(0);
    expect(f.deps.vectors.collectionExists).not.toHaveBeenCalled();
    expect(activity.hasActivity()).toBe(false);
  });
});
