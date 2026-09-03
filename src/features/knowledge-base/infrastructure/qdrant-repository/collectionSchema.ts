/**
 * @file src/features/knowledge-base/infrastructure/qdrant-repository/collectionSchema.ts
 *
 * @brief 集合 schema 兼容性检查（避免“写入/检索 schema 不匹配”这类根因问题）
 */

import type { Logger } from '@shared/logger';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRecordProp(obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = obj[key];
  return isRecord(v) ? v : undefined;
}

/**
 * 功能：当启用稀疏向量（bm25）时，要求集合具备：
 * - 命名向量 `default`
 * - `sparse_vectors.bm25`
 *
 * 若不满足，直接抛错并提示如何处理。
 */
export function assertCollectionSupportsSparseVectors(
  collectionName: string,
  collectionConfig: Record<string, unknown> | undefined,
  logger: Logger
): void {
  const params = collectionConfig ? getRecordProp(collectionConfig, 'params') : undefined;
  const vectorsParam = params ? getRecordProp(params, 'vectors') : undefined;

  // 1) 检查是否为命名向量 default
  const hasNamedDefaultVector = !!(vectorsParam && 'default' in vectorsParam);
  if (!hasNamedDefaultVector) {
    logger.warn(`⚠️  集合 ${collectionName} 为旧的“未命名向量”格式，无法与 default 命名向量写入/检索兼容，需要删除重建`);
    logger.warn('请退出正在进行的知识库任务，执行下列维护命令后重试：');
    logger.warn(
      `pnpm run kb:delete-vector-collection -- --collection ${JSON.stringify(collectionName)} --confirm ${JSON.stringify(collectionName)}`,
    );
    throw new Error(`集合 ${collectionName} 为旧格式（未命名向量），请手动删除后重试。`);
  }

  // 2) 检查 sparse_vectors.bm25
  const sparseVectors = params ? getRecordProp(params, 'sparse_vectors') : undefined;
  const hasSparseSupport = !!(sparseVectors && 'bm25' in sparseVectors);
  if (!hasSparseSupport) {
    logger.warn(`⚠️  集合 ${collectionName} 不支持稀疏向量，需要重新创建`);
    logger.warn('请退出正在进行的知识库任务，执行下列维护命令后重试：');
    logger.warn(
      `pnpm run kb:delete-vector-collection -- --collection ${JSON.stringify(collectionName)} --confirm ${JSON.stringify(collectionName)}`,
    );
    throw new Error(`集合 ${collectionName} 已存在但不支持稀疏向量(bm25)。请手动删除后重试。`);
  }

  logger.info(`✅ 现有集合 ${collectionName} 已支持稀疏向量，直接使用`);
}
