import { EmbeddingFailure } from '../definitions/embedding';

export function validateEmbeddingResult(values: readonly string[], vectors: readonly (readonly number[])[]): void {
  if (vectors.length !== values.length) {
    throw new EmbeddingFailure('protocol', 'vector_count_mismatch', false, 'Embedding 向量数量与输入数量不一致');
  }
  if (vectors.length === 0) return;
  const dimension = vectors[0].length;
  if (dimension === 0) throw new EmbeddingFailure('protocol', 'empty_vector', false, 'Embedding 返回空向量');
  for (const vector of vectors) {
    if (vector.length !== dimension) {
      throw new EmbeddingFailure('protocol', 'dimension_mismatch', false, 'Embedding 批次向量维度不一致');
    }
    if (vector.some(value => !Number.isFinite(value))) {
      throw new EmbeddingFailure('protocol', 'non_finite_vector', false, 'Embedding 向量包含非有限数字');
    }
  }
}
