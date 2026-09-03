/**
 * @file src/infra/adapters/vector-store/qdrant/index.ts
 *
 * @brief Qdrant 适配器模块统一出口（barrel）
 *
 * @description
 * 该目录按能力拆分（collections/search/scroll/points），本文件只做统一导出，
 * 以保持外部 import 路径稳定。
 */

export { QdrantAdapter } from './QdrantAdapter';
export type { QdrantProcessRuntime } from './process-runtime/qdrantProcessRuntime';
export { resolveQdrantProcessRuntime } from './process-runtime/resolveQdrantProcessRuntime';
export {
  QdrantProcessCleanupError,
  type OwnedQdrantProcess,
} from './process-runtime/definitions/ownedQdrantProcess';
export { createOwnedQdrantProcess } from './process-runtime/orchestration/createOwnedQdrantProcess';
export type {
  DeleteParams,
  Distance,
  MultiVector,
  MultiVectorCollectionConfig,
  QdrantCollectionInfo,
  QdrantConfig,
  QdrantScrollOffset,
  SearchParams,
  SearchResult,
  SparseVector,
  UpsertResult,
  UpsertVector,
  VectorPoint
} from './types';
