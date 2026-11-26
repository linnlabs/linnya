import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingFailure } from '@plugin/backend/inferenceFailures';
import type { EmbeddingPort } from '@plugin/backend/inferenceRuntime';
import { DatabaseService } from 'src/electron-main/services/database';
import { initialKnowledgeSchema } from '../../database/migrations/initialKnowledgeSchema';
import { BetterSqliteMetadataRepository } from '../../infrastructure/sqlite/better-sqlite-metadata.repository';
import { QdrantRepositoryImpl } from '../../infrastructure/QdrantRepositoryImpl';
import { QdrantAdapter } from '../../infrastructure/vector-store';
import type { SearchParams, SearchResult } from '../../infrastructure/vector-store/types';
import { FileSotRepository } from '../../infrastructure/sotRepository';
import { createDocument } from '../../domain/document';
import { KnowledgeIndexSpaceMismatchError } from '../../index-rebuild/definitions/knowledgeIndex';
import { DefaultSearchService } from './defaultSearchService';
import { KnowledgeSearchEmbeddingError } from './knowledgeSearchEmbeddingError';

/** 向量库只回答“没有命中”，用来区分真的没有匹配与嵌入失败。 */
class NoMatchQdrantAdapter extends QdrantAdapter {
  readonly searches: SearchParams[] = [];
  override async searchPoints(_collectionName: string, params: SearchParams): Promise<SearchResult[]> {
    this.searches.push(params);
    return [];
  }
}

let root: string;
let database: DatabaseService;
let metadata: BetterSqliteMetadataRepository;
let adapter: NoMatchQdrantAdapter;
let embed: ReturnType<typeof vi.fn<EmbeddingPort['embed']>>;
let search: DefaultSearchService;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'linnya-kb-search-embedding-'));
  database = new DatabaseService(path.join(root, 'workspace.sqlite'));
  database.initialize();
  initialKnowledgeSchema.up(database.getDb());
  metadata = new BetterSqliteMetadataRepository(database.getDb());
  adapter = new NoMatchQdrantAdapter({ url: 'http://127.0.0.1:1' });
  embed = vi.fn<EmbeddingPort['embed']>(async request => ({ vectors: request.values.map(() => [1, 0]), spaceId: 'fixture-space' }));
  search = new DefaultSearchService({
    metadataRepository: metadata,
    sotRepository: new FileSotRepository(path.join(root, 'sot')),
    qdrantRepository: new QdrantRepositoryImpl(async () => adapter),
    embedding: { embed },
    reranking: { rerank: async () => ({ ranking: [] }) },
  });
  await metadata.createKnowledgeBase({ id: 'kb', name: '资料' });
});

afterEach(async () => {
  database.close();
  await rm(root, { recursive: true, force: true });
});

async function addIndexedDocument(): Promise<void> {
  await metadata.addDocument(createDocument('doc-1', 'kb', '资料.md', 20));
  metadata.indexState.publishRebuilt('kb', { modelId: 'embedding-model', spaceId: 'fixture-space' });
}

describe('检索时嵌入模型失败', () => {
  it('还没有资料的库：直接返回空结果，不调用嵌入模型', async () => {
    expect((await search.search({ kbId: 'kb', query: '资料' })).results).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });

  it('嵌入成功但向量库没有命中：仍是空结果，不是失败', async () => {
    await addIndexedDocument();
    const response = await search.search({ kbId: 'kb', query: '资料' });
    expect(response.results).toEqual([]);
    expect(response.meta.totalResults).toBe(0);
    expect(embed).toHaveBeenCalledOnce();
    expect(adapter.searches.length).toBeGreaterThan(0);
  });

  it('按 Host 失败码给出原因：模型不可用、凭据、请求失败；不再吞成 0 条结果', async () => {
    await addIndexedDocument();
    const cases = [
      { failure: new EmbeddingFailure('protocol', 'model_not_found', false, '诊断原文 A'), reason: 'model-unavailable', tool: /embedding model used for this knowledge base is unavailable.*Retrying will not help/u },
      { failure: new EmbeddingFailure('protocol', 'route_missing', false, '诊断原文 B'), reason: 'model-unavailable', tool: /unavailable/u },
      { failure: new EmbeddingFailure('provider', 'provider_http_404', false, '诊断原文 C'), reason: 'model-unavailable', tool: /unavailable/u },
      { failure: new EmbeddingFailure('protocol', 'credential_missing', false, '诊断原文 D'), reason: 'credential', tool: /no API key, or the provider rejected the key.*Retrying will not help/u },
      { failure: new EmbeddingFailure('provider', 'provider_http_401', false, '诊断原文 E'), reason: 'credential', tool: /API key/u },
      { failure: new EmbeddingFailure('transport', 'provider_transport_error', true, '诊断原文 F'), reason: 'request-failed', tool: /did not succeed \(provider_transport_error\)\. Retrying later may help/u },
      { failure: new EmbeddingFailure('provider', 'provider_http_500', false, '诊断原文 G'), reason: 'request-failed', tool: /did not succeed \(provider_http_500\)\. Retrying will not help/u },
    ] as const;
    for (const { failure, reason, tool } of cases) {
      embed.mockRejectedValueOnce(failure);
      const error = await search.search({ kbId: 'kb', query: '资料' }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(KnowledgeSearchEmbeddingError);
      expect(error).toMatchObject({ reason, cause: failure });
      expect(error).toHaveProperty('toolMessage', expect.stringMatching(tool));
      // 工具说明只用英文和失败码，不夹带 Host 的中文诊断。
      expect(error).not.toHaveProperty('toolMessage', expect.stringMatching(/[一-鿿]/u));
    }
    // 嵌入失败发生在检索之前，向量库一次都没被问到。
    expect(adapter.searches).toEqual([]);
  });

  it('Agent 单库与多库共用的原始检索同样报出原因', async () => {
    await addIndexedDocument();
    embed.mockRejectedValueOnce(new EmbeddingFailure('protocol', 'model_not_found', false, 'missing'));
    await expect(search.searchRawResults('kb', '资料')).rejects.toMatchObject({ reason: 'model-unavailable' });
    embed.mockRejectedValueOnce(new EmbeddingFailure('protocol', 'credential_missing', false, 'no key'));
    await expect(search.searchForAgent('kb', '资料', { allocate: async () => [] })).rejects.toMatchObject({ reason: 'credential' });
  });

  it('向量空间不一致仍是“需要重建索引”，不算嵌入模型故障', async () => {
    await addIndexedDocument();
    embed.mockRejectedValueOnce(new EmbeddingFailure('protocol', 'embedding_space_mismatch', false, 'space'));
    await expect(search.search({ kbId: 'kb', query: '资料' })).rejects.toBeInstanceOf(KnowledgeIndexSpaceMismatchError);
  });
});
