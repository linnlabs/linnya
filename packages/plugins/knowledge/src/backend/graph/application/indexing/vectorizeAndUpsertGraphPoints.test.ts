import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingPort } from '@plugin/backend/inferenceRuntime';
import type { QdrantRepository } from '../../../infrastructure/qdrantRepository';
import { vectorizeAndUpsertGraphPoints } from './vectorizeAndUpsertGraphPoints';

function createFixture(pointCount: number) {
  const embedding: EmbeddingPort = {
    embed: vi.fn(async request => ({ vectors: request.values.map(() => [0.1, 0.2, 0.3]) })) as EmbeddingPort['embed'],
  };
  const getOrCreateCollection = vi.fn(async () => undefined);
  const addPoints = vi.fn(async () => undefined);
  const qdrantRepository = { getOrCreateCollection, addPoints } as unknown as QdrantRepository;
  const points = Array.from({ length: pointCount }, (_, index) => ({
    id: `point-${index}`,
    blockId: `block-${index}`,
    text: `图谱陈述 ${index}`,
    metadata: {},
  }));
  return { embedding, qdrantRepository, getOrCreateCollection, addPoints, points };
}

describe('vectorizeAndUpsertGraphPoints', () => {
  it('creates the graph collection once with a fixed segment count instead of Qdrant CPU-based defaults', async () => {
    const fixture = createFixture(25);

    await vectorizeAndUpsertGraphPoints({
      embedding: fixture.embedding,
      embeddingModelId: 'embedding-model',
      expectedSpaceId: 'space',
      qdrantRepository: fixture.qdrantRepository,
      collectionName: 'kg_nodes_kb',
      docId: 'doc',
      docTitle: '文档',
      blockType: 'kg_node',
      points: fixture.points,
      onProgress: () => undefined,
    });

    // 25 个点按 5 个一批写入；集合只在第一批创建，段数按全部 25 个点选，不能缺省给 Qdrant 自动分段。
    expect(fixture.getOrCreateCollection).toHaveBeenCalledTimes(1);
    expect(fixture.getOrCreateCollection).toHaveBeenCalledWith('kg_nodes_kb', 3, 'Cosine', true, {
      defaultSegmentNumber: 1,
    });
    expect(fixture.addPoints).toHaveBeenCalledTimes(5);
  });
});
