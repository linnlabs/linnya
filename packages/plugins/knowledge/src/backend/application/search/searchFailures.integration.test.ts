import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from 'src/electron-main/services/database';
import { initialKnowledgeSchema } from '../../database/migrations/initialKnowledgeSchema';
import { BetterSqliteMetadataRepository } from '../../infrastructure/sqlite/better-sqlite-metadata.repository';
import { BetterSqliteKnowledgeGraphRepository } from '../../graph/infrastructure/better-sqlite-knowledge-graph.repository';
import { QdrantRepositoryImpl } from '../../infrastructure/QdrantRepositoryImpl';
import { QdrantAdapter } from '../../infrastructure/vector-store';
import type { SearchParams, SearchResult } from '../../infrastructure/vector-store/types';
import { FileSotRepository } from '../../infrastructure/sotRepository';
import { createDocument } from '../../domain/document';
import { KnowledgeBaseNotFoundError } from '../../definitions/knowledgeBaseErrors';
import { KnowledgeIndexRebuildRequiredError } from '../../index-rebuild/definitions/knowledgeIndex';
import { DefaultSearchService } from './defaultSearchService';
import { searchAcrossKnowledgeBases } from './searchAcrossKnowledgeBases';

/** 每个集合按配置回答：默认给一条命中；可设为没有命中，或像损坏的索引那样报错。 */
class ScriptedQdrantAdapter extends QdrantAdapter {
  readonly failures = new Map<string, Error>();
  readonly withoutHits = new Set<string>();
  override async searchPoints(collectionName: string, _params: SearchParams): Promise<SearchResult[]> {
    const failure = this.failures.get(collectionName);
    if (failure) throw failure;
    if (this.withoutHits.has(collectionName)) return [];
    return [{
      id: `${collectionName}-block`,
      score: 0.9,
      payload: { doc_id: `${collectionName}-doc`, block_id: `${collectionName}-block`, document: '季度营收增长', doc_title: '季度报告.md', block_type: 'paragraph' },
    }];
  }
}

let root: string;
let database: DatabaseService;
let metadata: BetterSqliteMetadataRepository;
let adapter: ScriptedQdrantAdapter;
let search: DefaultSearchService;
let sot: FileSotRepository;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'linnya-kb-search-failures-'));
  database = new DatabaseService(path.join(root, 'workspace.sqlite'));
  database.initialize();
  initialKnowledgeSchema.up(database.getDb());
  metadata = new BetterSqliteMetadataRepository(database.getDb());
  adapter = new ScriptedQdrantAdapter({ url: 'http://127.0.0.1:1' });
  sot = new FileSotRepository(path.join(root, 'sot'));
  search = new DefaultSearchService({
    metadataRepository: metadata,
    sotRepository: sot,
    qdrantRepository: new QdrantRepositoryImpl(async () => adapter),
    embedding: { embed: async request => ({ vectors: request.values.map(() => [1, 0]), spaceId: 'fixture-space' }) },
    reranking: { rerank: async () => ({ ranking: [] }) },
  });
});

afterEach(async () => {
  database.close();
  await rm(root, { recursive: true, force: true });
});

/** 建一个有资料的库；indexed=false 表示资料已在库里、检索索引还没建好（需要重建）。 */
async function addKnowledgeBase(id: string, name: string, indexed: boolean): Promise<void> {
  await metadata.createKnowledgeBase({ id, name });
  await metadata.addDocument(createDocument(`${id}-doc`, id, '季度报告.md', 20));
  if (indexed) metadata.indexState.publishRebuilt(id, { modelId: 'embedding-model', spaceId: 'fixture-space' });
}

function searchAcross(kbIds: string[]) {
  return searchAcrossKnowledgeBases(
    {
      searchService: search,
      sotRepository: sot,
      knowledgeGraphRepository: new BetterSqliteKnowledgeGraphRepository(database.getDb()),
      metadataRepository: metadata,
    },
    {
      kbIds,
      query: '营收',
      // 引用编号须是 Host 规定的 6 位格式。
      citationRefAllocator: { allocate: async anchors => anchors.map((_anchor, index) => `Refab${'cdefgh'[index]}`) },
    }
  );
}

describe('知识库检索的其余失败不再吞成空结果', () => {
  it('向量库检索报错：原样上抛，不当成“没有匹配”', async () => {
    await addKnowledgeBase('kb', '资料', true);
    adapter.failures.set('kb', new Error('Qdrant 返回 500'));
    await expect(search.search({ kbId: 'kb', query: '营收' })).rejects.toThrow('Qdrant 返回 500');
    await expect(search.searchRawResults('kb', '营收')).rejects.toThrow('Qdrant 返回 500');
  });

  it('找不到知识库：用正式错误类型，界面才能按语言显示', async () => {
    await expect(search.search({ kbId: 'missing', query: '营收' })).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
  });

  it('多库检索部分失败：交出其余库的命中，并写明哪个库没查到、为什么', async () => {
    await addKnowledgeBase('kb', '资料', true);
    await addKnowledgeBase('kb-unindexed', '第二季度资料', false);
    await addKnowledgeBase('kb-broken', '归档', true);
    adapter.failures.set('kb-broken', new Error('Qdrant 返回 500'));

    const output = await searchAcross(['kb', 'kb-unindexed', 'kb-broken']);

    expect(output.hits.map(hit => hit.docId)).toEqual(['kb-doc']);
    expect(output.observation).toContain('some linked knowledge bases could not be searched, so these results may be incomplete');
    // 已知原因给英文说明与恢复办法；未知失败只能给诊断原文。
    expect(output.observation).toMatch(/- "第二季度资料": Knowledge search failed: the search index of this knowledge base must be rebuilt\./u);
    expect(output.observation).toContain('- "归档": Qdrant 返回 500');
  });

  it('其余库都检索成功但没有命中时，仍说明有库没查到，而不是整次失败', async () => {
    await addKnowledgeBase('kb', '资料', true);
    await addKnowledgeBase('kb-unindexed', '第二季度资料', false);
    adapter.withoutHits.add('kb');

    const output = await searchAcross(['kb', 'kb-unindexed']);

    expect(output.hits).toEqual([]);
    expect(output.observation).toMatch(/"第二季度资料": Knowledge search failed: the search index/u);
  });

  it('所有库都失败：整次检索失败并带上原因', async () => {
    await addKnowledgeBase('kb-unindexed', '第二季度资料', false);
    await expect(searchAcross(['kb-unindexed', 'missing'])).rejects.toBeInstanceOf(KnowledgeIndexRebuildRequiredError);
  });
});
