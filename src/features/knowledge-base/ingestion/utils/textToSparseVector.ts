/**
 * @file textToSparseVector.ts
 *
 * @description
 * BM25（稀疏向量）生成工具：与 ingestion 的 EmbeddingHandler 保持一致的实现。
 *
 * 设计目标（高内聚、低耦合）：
 * - 图谱向量化（nodes/edges）也需要 BM25 稀疏向量以支持 hybrid search；
 * - 但我们不希望复制/散落同一套分词+哈希逻辑到多个 worker/handler；
 * - 因此把“文本 -> 稀疏向量”抽成一个小工具函数，供 ingestion 与 graph-indexing 复用。
 *
 * 重要一致性：
 * - 分词：jieba.cut_for_search（getSharedJieba）
 * - 停用词过滤：STOPWORDS
 * - 哈希：adler32
 * - 冲突处理：相同 hash 的词频相加
 */

import { tokenizeWithJieba } from '@shared/utils/tokenization';
import adler32 from 'adler-32';
import type { SparseVector } from '../../infrastructure/qdrantRepository';

/**
 * 功能 (What): 文本转稀疏向量（BM25稀疏向量的“词频向量”表达）
 *
 * 注意：
 * - 这里的 SparseVector 只负责生成“稀疏索引+值”，并不在此处计算 IDF；
 * - Qdrant 的 BM25 搜索侧会用查询文本生成稀疏向量，并与点的稀疏向量做匹配。
 */
export async function textToSparseVector(text: string): Promise<SparseVector> {
  const normalized = text.trim();
  if (normalized.length === 0) return { indices: [], values: [] };

  // 与 ingestion 侧保持一致：统一使用 tokenizeWithJieba 的过滤策略
  const tokens = tokenizeWithJieba(normalized);
  if (tokens.length === 0) return { indices: [], values: [] };

  // 统计词频
  const tokenCounts: Record<string, number> = {};
  for (const token of tokens) {
    tokenCounts[token] = (tokenCounts[token] ?? 0) + 1;
  }

  // 使用 adler32 哈希，把 token 映射到稀疏空间索引
  const hashToCount: Record<number, number> = {};
  for (const [token, count] of Object.entries(tokenCounts)) {
    const hash = adler32.str(token) >>> 0; // 转为无符号 32-bit
    hashToCount[hash] = (hashToCount[hash] ?? 0) + count;
  }

  // 排序输出：按 hash 升序（稳定且便于 debug）
  const hashes = Object.keys(hashToCount)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const indices: number[] = [];
  const values: number[] = [];
  for (const h of hashes) {
    indices.push(h);
    values.push(hashToCount[h] ?? 0);
  }

  return { indices, values };
}

/**
 * 功能 (What): 批量生成稀疏向量（保持输入输出一一对应）
 */
export async function textsToSparseVectors(texts: string[]): Promise<SparseVector[]> {
  return await Promise.all(texts.map((t) => textToSparseVector(t)));
}


