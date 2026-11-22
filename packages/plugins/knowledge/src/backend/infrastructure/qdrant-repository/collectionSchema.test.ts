import { describe, expect, it } from 'vitest';
import { decideExistingCollection, incompatibleCollectionError, readDenseVectorSize } from './collectionSchema';

const named = (size: number, bm25 = true) => ({
  params: { vectors: { default: { size, distance: 'Cosine' } }, ...(bm25 ? { sparse_vectors: { bm25: {} } } : {}) },
});
const unnamed = (size: number) => ({ params: { vectors: { size, distance: 'Cosine' } } });

describe('已存在集合能否承接本次写入', () => {
  it('读取命名与未命名向量的维度；缺失或非法时为 null', () => {
    expect(readDenseVectorSize(named(1024))).toBe(1024);
    expect(readDenseVectorSize(unnamed(64))).toBe(64);
    expect(readDenseVectorSize(undefined)).toBeNull();
    expect(readDenseVectorSize({ params: {} })).toBeNull();
    expect(readDenseVectorSize({ params: { vectors: { default: { size: 0 } } } })).toBeNull();
    expect(readDenseVectorSize({ params: { vectors: { default: { size: 1.5 } } } })).toBeNull();
  });

  it('维度与格式一致时直接使用', () => {
    expect(decideExistingCollection({ config: named(64), pointsCount: 10, vectorSize: 64, supportSparse: true }))
      .toEqual({ kind: 'compatible' });
    expect(decideExistingCollection({ config: unnamed(64), pointsCount: 0, vectorSize: 64, supportSparse: false }))
      .toEqual({ kind: 'compatible' });
  });

  it('旧版按默认维度预建的空集合：重建', () => {
    expect(decideExistingCollection({ config: named(1024), pointsCount: 0, vectorSize: 64, supportSparse: true }))
      .toEqual({ kind: 'recreate-empty', reason: '向量维度 1024，当前嵌入模型为 64' });
    expect(decideExistingCollection({ config: unnamed(64), pointsCount: 0, vectorSize: 64, supportSparse: true }).kind)
      .toBe('recreate-empty');
    expect(decideExistingCollection({ config: named(64, false), pointsCount: 0, vectorSize: 64, supportSparse: true }).kind)
      .toBe('recreate-empty');
    expect(decideExistingCollection({ config: undefined, pointsCount: 0, vectorSize: 64, supportSparse: false }).kind)
      .toBe('recreate-empty');
  });

  it('已有一个向量也不能改动：给出可操作的提示', () => {
    const decision = decideExistingCollection({ config: named(1024), pointsCount: 1, vectorSize: 64, supportSparse: true });
    expect(decision).toEqual({ kind: 'incompatible', reason: '向量维度 1024，当前嵌入模型为 64' });
    expect(decideExistingCollection({ config: named(64, false), pointsCount: 3, vectorSize: 64, supportSparse: true }).kind)
      .toBe('incompatible');
    expect(incompatibleCollectionError('向量维度 1024，当前嵌入模型为 64').message)
      .toMatch(/建立索引时的嵌入模型.*重建索引/u);
  });

  it('不需要关键词检索时，不因缺 bm25 重建或拒绝', () => {
    expect(decideExistingCollection({ config: named(64, false), pointsCount: 5, vectorSize: 64, supportSparse: false }))
      .toEqual({ kind: 'compatible' });
  });
});
