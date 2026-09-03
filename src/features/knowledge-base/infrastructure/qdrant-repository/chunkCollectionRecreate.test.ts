import { describe, expect, it, vi } from 'vitest';

import { Logger } from '@shared/logger';

import { recreateChunkCollectionIfNeeded } from './chunkCollectionRecreate';

describe('chunkCollectionRecreate', () => {
  it('collection 不存在时应跳过', async () => {
    const result = await recreateChunkCollectionIfNeeded({
      collectionName: 'kb-missing',
      logger: new Logger('chunk-recreate-test'),
      collectionExists: async () => false,
      getCollectionInfo: async () => ({ points_count: 0, segments_count: 0, config: {} }),
      scrollPointsPageWithVector: async () => ({ points: [], nextOffset: undefined }),
      deleteCollection: async () => undefined,
      createCollection: async () => undefined,
      upsertPoints: async () => undefined,
      countPoints: async () => 0,
    });

    expect(result.action).toBe('skipped_missing');
  });

  it('空 collection 应直接删除', async () => {
    const deleteCollection = vi.fn(async () => undefined);

    const result = await recreateChunkCollectionIfNeeded({
      collectionName: 'kb-empty',
      logger: new Logger('chunk-recreate-test'),
      collectionExists: async () => true,
      getCollectionInfo: async () => ({
        points_count: 0,
        segments_count: 6,
        config: {
          optimizer_config: {
            default_segment_number: 1,
          },
        },
      }),
      scrollPointsPageWithVector: async () => ({ points: [], nextOffset: undefined }),
      deleteCollection,
      createCollection: async () => undefined,
      upsertPoints: async () => undefined,
      countPoints: async () => 0,
    });

    expect(result.action).toBe('deleted_empty');
    expect(deleteCollection).toHaveBeenCalledOnce();
  });

  it('segments 已收敛时应跳过', async () => {
    const result = await recreateChunkCollectionIfNeeded({
      collectionName: 'kb-compact',
      logger: new Logger('chunk-recreate-test'),
      collectionExists: async () => true,
      getCollectionInfo: async () => ({
        points_count: 500,
        segments_count: 1,
        config: {
          optimizer_config: {
            default_segment_number: 1,
          },
        },
      }),
      scrollPointsPageWithVector: async () => ({ points: [], nextOffset: undefined }),
      deleteCollection: async () => undefined,
      createCollection: async () => undefined,
      upsertPoints: async () => undefined,
      countPoints: async () => 500,
    });

    expect(result.action).toBe('skipped_already_compact');
    expect(result.targetSegmentCount).toBe(1);
  });

  it('segments 仅比目标多 1 时不应重复重建', async () => {
    const deleteCollection = vi.fn(async () => undefined);
    const createCollection = vi.fn(async () => undefined);
    const upsertPoints = vi.fn(async () => undefined);

    const result = await recreateChunkCollectionIfNeeded({
      collectionName: 'kb-qdrant-stable-two-segments',
      logger: new Logger('chunk-recreate-test'),
      collectionExists: async () => true,
      getCollectionInfo: async () => ({
        points_count: 5_597,
        segments_count: 2,
        config: {
          optimizer_config: {
            default_segment_number: 1,
          },
        },
      }),
      scrollPointsPageWithVector: async () => ({ points: [], nextOffset: undefined }),
      deleteCollection,
      createCollection,
      upsertPoints,
      countPoints: async () => 5_597,
    });

    expect(result.action).toBe('skipped_already_compact');
    expect(result.targetSegmentCount).toBe(1);
    expect(deleteCollection).not.toHaveBeenCalled();
    expect(createCollection).not.toHaveBeenCalled();
    expect(upsertPoints).not.toHaveBeenCalled();
  });

  it('points 跨阈值后应在下次启动按新目标段数重建', async () => {
    const deleteCollection = vi.fn(async () => undefined);
    const createCollection = vi.fn(async () => undefined);
    const upsertPoints = vi.fn(async () => undefined);
    const totalPoints = 25_000;

    const result = await recreateChunkCollectionIfNeeded({
      collectionName: 'kb-grow-target',
      logger: new Logger('chunk-recreate-test'),
      collectionExists: async () => true,
      getCollectionInfo: async () => ({
        points_count: 25_000,
        segments_count: 1,
        config: {
          optimizer_config: {
            default_segment_number: 1,
          },
        },
      }),
      scrollPointsPageWithVector: async (_limit, offset) => {
        const start = typeof offset === 'number' && Number.isFinite(offset) ? offset : 0;
        const remaining = totalPoints - start;
        const pageSize = Math.min(1000, remaining);
        const points = Array.from({ length: pageSize }, (_, index) => {
          const current = start + index;
          return {
            id: `p-${current}`,
            payload: {
              doc_id: `d-${current}`,
              block_id: `b-${current}`,
              document: `document-${current}`,
              doc_title: `title-${current}`,
              block_type: 'paragraph',
            },
            vector: {
              default: [0.1, 0.2],
            },
          };
        });
        const nextOffset = start + pageSize < totalPoints ? start + pageSize : undefined;
        return {
          points,
          nextOffset,
        };
      },
      deleteCollection,
      createCollection,
      upsertPoints,
      countPoints: async () => totalPoints,
    });

    expect(result.action).toBe('recreated');
    expect(result.configuredTargetSegmentCountBefore).toBe(1);
    expect(result.targetSegmentCount).toBe(2);
    expect(createCollection).toHaveBeenCalledWith({
      vectorSize: 2,
      defaultSegmentNumber: 2,
    });
  });

  it('segments 过多时应执行导出、重建和回灌', async () => {
    const deleteCollection = vi.fn(async () => undefined);
    const createCollection = vi.fn(async () => undefined);
    const upsertPoints = vi.fn(async () => undefined);

    const result = await recreateChunkCollectionIfNeeded({
      collectionName: 'kb-recreate',
      logger: new Logger('chunk-recreate-test'),
      collectionExists: async () => true,
      getCollectionInfo: async () => ({
        points_count: 2,
        segments_count: 6,
        config: {
          optimizer_config: {
            default_segment_number: 1,
          },
        },
      }),
      scrollPointsPageWithVector: async (limit, offset) => {
        expect(limit).toBe(1000);
        if (offset === undefined) {
          return {
            points: [
              {
                id: 'p1',
                payload: {
                  doc_id: 'd1',
                  block_id: 'b1',
                  document: 'doc-1',
                  doc_title: 'title-1',
                  block_type: 'paragraph',
                },
                vector: {
                  default: [0.1, 0.2],
                  bm25: {
                    indices: [1],
                    values: [0.5],
                  },
                },
              },
              {
                id: 'p2',
                payload: {
                  doc_id: 'd2',
                  block_id: 'b2',
                  document: 'doc-2',
                  doc_title: 'title-2',
                  block_type: 'paragraph',
                },
                vector: {
                  default: [0.3, 0.4],
                },
              },
            ],
            nextOffset: undefined,
          };
        }

        return {
          points: [],
          nextOffset: undefined,
        };
      },
      deleteCollection,
      createCollection,
      upsertPoints,
      countPoints: async () => 2,
    });

    expect(result.action).toBe('recreated');
    expect(result.configuredTargetSegmentCountBefore).toBe(1);
    expect(deleteCollection).toHaveBeenCalledOnce();
    expect(createCollection).toHaveBeenCalledWith({
      vectorSize: 2,
      defaultSegmentNumber: 1,
    });
    expect(upsertPoints).toHaveBeenCalledOnce();
    expect(upsertPoints).toHaveBeenCalledWith([
      {
        id: 'p1',
        payload: {
          doc_id: 'd1',
          block_id: 'b1',
          document: 'doc-1',
          doc_title: 'title-1',
          block_type: 'paragraph',
        },
        vector: {
          default: [0.1, 0.2],
          bm25: {
            indices: [1],
            values: [0.5],
          },
        },
      },
      {
        id: 'p2',
        payload: {
          doc_id: 'd2',
          block_id: 'b2',
          document: 'doc-2',
          doc_title: 'title-2',
          block_type: 'paragraph',
        },
        vector: {
          default: [0.3, 0.4],
        },
      },
    ]);
  });
});
