/**
 * @file src/features/knowledge-base/infrastructure/qdrant-repository/sparseVector.ts
 *
 * @brief 文本 -> 稀疏向量（BM25 侧使用的稀疏表示）
 */

import type { Logger } from '@shared/logger';
import adler32 from 'adler-32';
import { getSharedJieba, STOPWORDS } from '@shared/utils/tokenization';
import type { SparseVector } from '../qdrantRepository';

/**
 * 功能：使用 jieba 进行中文分词（search 模式）
 * - 分词失败时降级到简易分词，保证流程可继续，但会降低检索质量
 */
function jiebaTokenize(text: string, logger: Logger): string[] {
  try {
    const jieba = getSharedJieba();
    const tokens = jieba.cutForSearch(text, true);
    return tokens.filter((token: string) =>
      token &&
      token.length > 1 &&
      !STOPWORDS.has(token.toLowerCase().trim()) &&
      token.trim().length > 0 &&
      // 过滤纯数字和纯符号
      !/^\d+$/.test(token) &&
      !/^[^\w\u4e00-\u9fff]+$/.test(token)
    );
  } catch (error) {
    logger.error(`jieba 分词失败: ${String(error)}`);
    return fallbackTokenize(text, logger);
  }
}

/**
 * 降级分词：英文按词，中文按单字
 */
function fallbackTokenize(text: string, logger: Logger): string[] {
  logger.debug('使用降级分词（jieba 不可用）');

  const cleanText = text.toLowerCase().trim();
  const tokens: string[] = [];

  // 英文单词分割
  const englishTokens = cleanText.match(/[a-zA-Z]+/g) ?? [];
  tokens.push(...englishTokens);

  // 中文按字符分割（降级方案）
  const chineseChars = cleanText.match(/[\u4e00-\u9fff]/g) ?? [];
  tokens.push(...chineseChars);

  return tokens.filter((token) => token.length > 0);
}

/**
 * Adler32 哈希（使用 adler-32 库）
 */
function adler32Hash(data: string, logger: Logger): number {
  try {
    const hash = adler32.str(data);
    // 转无符号 32 位
    return hash >>> 0;
  } catch (error) {
    logger.error(`adler32 哈希计算失败: ${String(error)}`);
    return fallbackHash(data, logger);
  }
}

/**
 * 降级哈希（仅在 adler-32 库不可用时）
 */
function fallbackHash(data: string, logger: Logger): number {
  logger.debug('使用降级哈希（adler-32 不可用）');

  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转换为 32 位整数
  }
  return Math.abs(hash);
}

/**
 * 功能：文本转稀疏向量（只负责“稀疏表示”，不涉及检索调用）
 */
export async function textToSparseVector(text: string, logger: Logger): Promise<SparseVector> {
  try {
    const tokens = jiebaTokenize(text, logger);
    if (tokens.length === 0) {
      return { indices: [], values: [] };
    }

    // 统计词频
    const tokenCounts: Record<string, number> = {};
    for (const token of tokens) {
      tokenCounts[token] = (tokenCounts[token] ?? 0) + 1;
    }

    // 哈希冲突处理：相同 hash 的词频相加
    const hashCounts: Record<number, number> = {};
    for (const [token, count] of Object.entries(tokenCounts)) {
      const tokenHash = adler32Hash(token, logger);
      hashCounts[tokenHash] = (hashCounts[tokenHash] ?? 0) + count;
    }

    const indices = Object.keys(hashCounts).map((k) => Number(k));
    const values = Object.values(hashCounts).map((v) => Number(v));

    return { indices, values };
  } catch (error) {
    logger.error(`稀疏向量生成失败: ${String(error)}`);
    return { indices: [], values: [] };
  }
}


