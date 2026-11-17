/**
 * @file src/infra/adapters/vector-store/qdrant/types.ts
 *
 * @brief Qdrant 适配器对外暴露的类型定义
 *
 * @description
 * 这些类型属于“基础设施适配器层”的公共契约：
 * - 被 `src/infra/adapters/vector-store/index.ts` 二次导出
 * - 被业务仓储（如 `QdrantRepositoryImpl`）依赖
 *
 * 设计原则：
 * - 高内聚：只放与 Qdrant 适配器交互强相关的类型
 * - 低耦合：不向上层泄漏第三方 SDK 的复杂类型
 */
 
/**
 * Qdrant 配置
 */
export interface QdrantConfig {
  url: string;
  apiKey?: string;
  timeout?: number;
  /**
   * 是否启用 client-server 版本兼容性检查。
   *
   * 背景：
   * - 我们的 Qdrant 可能由 Electron 内置进程提供（版本受打包资源影响）；
   * - `@qdrant/js-client-rest` 默认会做版本兼容检查，若 minor 差距过大会直接拒绝请求；
   * - 开发场景下，我们更关注“可用性”，因此默认关闭该检查（由调用方显式开启）。
   */
  checkCompatibility?: boolean;
}

/**
 * 稀疏向量结构（用于关键词检索等）
 */
export interface SparseVector {
  indices: number[];
  values: number[];
}

/**
 * 多向量结构：default 为稠密向量；bm25 为稀疏向量（可选）
 */
export interface MultiVector {
  /** 稠密向量（语义检索） */
  default: number[];
  /** 稀疏向量（关键词检索） */
  bm25?: SparseVector;
}

/**
 * Upsert 支持的向量形态：
 * - 旧：单稠密向量数组
 * - 新：命名向量（default + 可选 bm25）
 */
export type UpsertVector = number[] | MultiVector;

/**
 * 向量点结构（用于 upsert）
 *
 * 注意：这里统一使用 `vector` 字段，避免 `vector/vectors` 双字段导致的类型不一致问题。
 */
export interface VectorPoint {
  id: string;
  vector: UpsertVector;
  payload: Record<string, unknown>;
}

/**
 * 搜索结果结构
 */
export interface SearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

/**
 * Upsert 操作结果
 */
export interface UpsertResult {
  operation_id: number;
  status: string;
}

/**
 * Qdrant scroll 的 offset 类型（由服务返回，结构可能随版本变化）
 * 这里保持宽松，只做透传，上层不得做业务假设。
 */
export type QdrantScrollOffset = string | number | Record<string, unknown> | null;

/**
 * 搜索参数（适配器层）
 */
export interface SearchParams {
  /**
   * 查询向量：
   * - 允许直接传稠密向量数组（会被封装为命名向量）
   * - 或传入形如 { name, vector } 的结构（dense 或 sparse）
   */
  vector: unknown;
  /** 命名向量名称，默认 "default" */
  vectorName?: string;
  /** 返回结果数量 */
  limit: number;
  /** 分数阈值 */
  scoreThreshold?: number;
  /** 过滤器（Qdrant 原生 filter 结构） */
  filter?: QdrantFilter;
}

/**
 * 删除参数（适配器层）
 */
export type DeleteParams =
  | {
      /**
       * 指定要删除的点 ID 列表。
       *
       * 说明：
       * - 本项目的点 ID 统一使用 string（与 `VectorPoint.id` 保持一致）
       * - Qdrant 支持 number|string，这里收窄为 string，避免上层传入不一致的 ID 形态
       */
      points: string[];
      /** 按 points 删除时，不允许同时传 filter（避免语义不清） */
      filter?: undefined;
    }
  | {
      /**
       * 按过滤条件删除点。
       *
       * 重要：这里必须是“Qdrant 原生 Filter”结构的子集，
       * 否则无法满足 `@qdrant/js-client-rest` 的 `PointsSelector` 类型约束。
       */
      filter: QdrantFilter;
      /** 按 filter 删除时，不允许同时传 points（避免语义不清） */
      points?: undefined;
    };

/**
 * 距离度量
 */
export type Distance = 'Cosine' | 'Euclidean' | 'Dot';

/**
 * Qdrant 过滤器（本项目用到的最小子集）
 *
 * 设计目标：
 * - **不向上层暴露第三方 SDK 的复杂类型**
 * - 但在结构上必须能被 `@qdrant/js-client-rest` 识别为合法的 Filter/Condition，
 *   以便在 delete 等严格场景通过 TypeScript 校验。
 *
 * 备注：
 * - 当前项目主要使用 `must: [{ key, match/range }]` 这种形式
 * - 如后续需要支持更多 Condition（如 geo_*、nested 等），可在此处扩展
 */
export type QdrantFilter = {
  should?: QdrantCondition | QdrantCondition[];
  must?: QdrantCondition | QdrantCondition[];
  must_not?: QdrantCondition | QdrantCondition[];
  min_should?: {
    /** 至少满足的条件集合 */
    conditions: QdrantCondition | QdrantCondition[];
    /** 最少满足数量 */
    min_count: number;
  };
};

export type QdrantCondition = QdrantFieldCondition | QdrantFilter;

export type QdrantMatch =
  | { value: string | number | boolean }
  | { text: string }
  | { phrase: string }
  | { any: string[] | number[] }
  | { except: string[] | number[] };

export type QdrantRange = {
  lt?: number | null;
  gt?: number | null;
  gte?: number | null;
  lte?: number | null;
};

export type QdrantFieldCondition = {
  /** payload 字段名 */
  key: string;
  /** 匹配条件 */
  match?: QdrantMatch | null;
  /** 数值范围条件 */
  range?: QdrantRange | null;
  /** 字段为空 */
  is_empty?: boolean | null;
  /** 字段为 null */
  is_null?: boolean | null;
};

/**
 * 集合稠密向量配置
 */
export interface DenseVectorParams {
  size: number;
  distance: Distance;
}

/**
 * collection 优化器配置（创建时）
 */
export interface CollectionOptimizerConfig {
  /**
   * 目标 segment 数。
   *
   * 说明：
   * - `0` 表示回退到 Qdrant 自动策略；
   * - 正整数表示显式目标值；
   * - 这里只暴露当前项目真正会用到的字段，避免把 Qdrant 全量 schema 泄漏到上层。
   */
  defaultSegmentNumber?: number;
}

/**
 * collection 创建附加选项
 */
export interface CreateCollectionOptions {
  optimizerConfig?: CollectionOptimizerConfig;
}

/**
 * 多向量集合配置（当前项目仅用到 default + bm25）
 */
export interface MultiVectorCollectionConfig {
  default: DenseVectorParams;
  /**
   * 是否启用 bm25 稀疏向量：
   * - Qdrant 服务端只关心是否存在该 key
   * - modifier 等细节属于更上层的检索策略，不强耦合在适配器层
   */
  bm25?: Record<string, unknown>;
}

/**
 * 获取集合信息的最小形态（只暴露本项目会用到的字段）
 */
export interface QdrantCollectionInfo {
  vectors_count?: number;
  indexed_vectors_count?: number;
  points_count?: number;
  segments_count?: number;
  config?: Record<string, unknown>;
}


