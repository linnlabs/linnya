import { isObjectLike } from '@linnya/foundation';
/**
 * @file packages/plugins/knowledge/src/backend/infrastructure/qdrant-repository/collectionSchema.ts
 *
 * @brief 集合 schema 兼容性检查（避免“写入/检索 schema 不匹配”这类根因问题）
 */

import type { Logger } from '@plugin/backend/loggingRuntime';

function getRecordProp(
  obj: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const v = obj[key];
  return isObjectLike(v) ? v : undefined;
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
    logger.warn(
      `⚠️  集合 ${collectionName} 为旧的“未命名向量”格式，无法与 default 命名向量写入/检索兼容，需要删除重建`
    );
    logger.warn('请退出正在进行的知识库任务，执行下列维护命令后重试：');
    logger.warn(
      `pnpm run kb:delete-vector-collection -- --collection ${JSON.stringify(collectionName)} --confirm ${JSON.stringify(collectionName)}`
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
      `pnpm run kb:delete-vector-collection -- --collection ${JSON.stringify(collectionName)} --confirm ${JSON.stringify(collectionName)}`
    );
    throw new Error(`集合 ${collectionName} 已存在但不支持稀疏向量(bm25)。请手动删除后重试。`);
  }

  logger.info(`✅ 现有集合 ${collectionName} 已支持稀疏向量，直接使用`);
}

export type ExistingCollectionDecision =
  | { readonly kind: 'compatible' }
  | { readonly kind: 'recreate-empty'; readonly reason: string }
  | { readonly kind: 'incompatible'; readonly reason: string };

/** 读取集合稠密向量维度：命名向量 default 或旧的未命名向量；读不到时返回 null。 */
export function readDenseVectorSize(collectionConfig: Record<string, unknown> | undefined): number | null {
  const params = collectionConfig ? getRecordProp(collectionConfig, 'params') : undefined;
  const vectors = params ? getRecordProp(params, 'vectors') : undefined;
  if (!vectors) return null;
  const named = getRecordProp(vectors, 'default');
  const size = (named ?? vectors)['size'];
  return typeof size === 'number' && Number.isSafeInteger(size) && size > 0 ? size : null;
}

/**
 * 已存在的集合能否承接本次写入。旧版本可能在建库时就按当时的默认维度预建了空集合；
 * 空集合不含任何资料，按本次写入的配置重建即可。已有向量时不能改动，交给用户选择原模型或重建索引。
 */
export function decideExistingCollection(input: {
  readonly config: Record<string, unknown> | undefined;
  readonly pointsCount: number;
  readonly vectorSize: number;
  readonly supportSparse: boolean;
}): ExistingCollectionDecision {
  const params = input.config ? getRecordProp(input.config, 'params') : undefined;
  const vectors = params ? getRecordProp(params, 'vectors') : undefined;
  const existingSize = readDenseVectorSize(input.config);
  let reason: string | null = null;
  if (existingSize !== input.vectorSize) {
    reason = `向量维度 ${existingSize ?? '未知'}，当前嵌入模型为 ${input.vectorSize}`;
  } else if (input.supportSparse && !(vectors && 'default' in vectors)) {
    reason = '旧的未命名向量格式';
  } else if (input.supportSparse && !(params && getRecordProp(params, 'sparse_vectors')?.['bm25'] !== undefined)) {
    reason = '不支持关键词（bm25）检索';
  }
  if (reason === null) return { kind: 'compatible' };
  return input.pointsCount === 0 ? { kind: 'recreate-empty', reason } : { kind: 'incompatible', reason };
}

export function incompatibleCollectionError(reason: string): Error {
  return new Error(`知识库索引与当前写入不一致（${reason}）。请改用建立索引时的嵌入模型，或在知识库中重建索引。`);
}
