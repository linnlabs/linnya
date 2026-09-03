/**
 * @file src/infra/adapters/vector-store/index.ts
 * 
 * @brief 统一导出所有基础设施服务的适配器。
 *
 * @description
 * 这是基础设施适配器包的统一出口，提供与各种基础设施服务（如 Qdrant 向量数据库）
 * 交互的适配器。这些适配器封装了底层库的细节，提供更高层次的、与业务逻辑紧密集成的 API。
 * @dependency
 * - `@qdrant/js-client-rest` (npm package)
 * 
 * @relationship
 * - **内聚**: 高度内聚，每个适配器只负责一种基础设施服务的交互。
 * - **耦合**:
 *   - **调用**: 第三方库如 `@qdrant/js-client-rest`。
 *   - **被调用**: 主要被 `src/knowledge-base` 调用。
 */

import { 
  QdrantAdapter as QdrantAdapterClass, 
  QdrantConfig, 
  VectorPoint, 
  SearchResult, 
  UpsertResult,
  SearchParams,
  DeleteParams
} from './qdrant';

export const qdrantAdapter = QdrantAdapterClass.getInstance;
export type { QdrantConfig, VectorPoint, SearchResult, UpsertResult, SearchParams, DeleteParams };
export { QdrantAdapterClass as QdrantAdapter };
