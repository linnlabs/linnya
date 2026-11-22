import { describe, expect, it } from 'vitest';
import { releaseStaleEmptyKnowledgeCollections } from './releaseStaleEmptyKnowledgeCollections';

type Library = { id: string; spaceId?: string; documents?: string[]; collection?: { points: number | undefined; exact?: number } };

function fakes(libraries: Library[], options: { failCountFor?: string } = {}) {
  const deleted: string[] = [];
  const byId = new Map(libraries.map(library => [library.id, library]));
  return {
    deleted,
    input: {
      metadata: {
        async getAllKnowledgeBases() { return libraries.map(library => ({ id: library.id, name: library.id })) as never; },
        async getDocumentsInKnowledgeBase(kbId: string) {
          return (byId.get(kbId)?.documents ?? []).map((status, index) => ({ id: `${kbId}-${index}`, kbId, status })) as never;
        },
        indexState: { read: (kbId: string) => ({ spaceId: byId.get(kbId)?.spaceId ?? null }) } as never,
      },
      collections: {
        async collectionExists(name: string) { return Boolean(byId.get(name)?.collection) && !deleted.includes(name); },
        async getCollection(name: string) {
          const points = byId.get(name)?.collection?.points;
          return points === undefined ? {} : { points_count: points };
        },
        async countPoints(name: string) {
          if (name === options.failCountFor) throw new Error('qdrant unavailable');
          const collection = byId.get(name)?.collection;
          return collection?.exact ?? collection?.points ?? 0;
        },
        async deleteCollection(name: string) { deleted.push(name); },
      } as never,
    },
  };
}

describe('移除早期版本预建的空向量集合', () => {
  it('未建立索引、确认为空的集合被删除；没有集合的库不动', async () => {
    const fake = fakes([
      { id: 'legacy', collection: { points: 0 } },
      { id: 'no-collection' },
      { id: 'failed-only', documents: ['failed', 'pending'], collection: { points: 0 } },
    ]);
    expect(await releaseStaleEmptyKnowledgeCollections(fake.input)).toEqual(['legacy', 'failed-only']);
    expect(fake.deleted).toEqual(['legacy', 'failed-only']);
  });

  it('已有向量空间记录或已完成文档的库，即使集合为空也保留', async () => {
    const fake = fakes([
      { id: 'bound', spaceId: 'space-1', collection: { points: 0 } },
      { id: 'completed', documents: ['completed'], collection: { points: 0 } },
    ]);
    expect(await releaseStaleEmptyKnowledgeCollections(fake.input)).toEqual([]);
    expect(fake.deleted).toEqual([]);
  });

  it('只要有一个点、点数读不到或精确计数不为 0，都保留集合', async () => {
    const fake = fakes([
      { id: 'one-point', collection: { points: 1 } },
      { id: 'unknown-count', collection: { points: undefined } },
      { id: 'estimate-wrong', collection: { points: 0, exact: 3 } },
    ]);
    expect(await releaseStaleEmptyKnowledgeCollections(fake.input)).toEqual([]);
    expect(fake.deleted).toEqual([]);
  });

  it('计数失败时停止并抛出，已处理的库保持原样，不猜测为空', async () => {
    const fake = fakes([
      { id: 'first', collection: { points: 0 } },
      { id: 'broken', collection: { points: 0 } },
    ], { failCountFor: 'broken' });
    await expect(releaseStaleEmptyKnowledgeCollections(fake.input)).rejects.toThrow('qdrant unavailable');
    expect(fake.deleted).toEqual(['first']);
  });
});
