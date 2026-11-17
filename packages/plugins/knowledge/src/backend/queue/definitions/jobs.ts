/**
 * src/pipeline/jobs.ts
 *
 * 定义任务队列中各种任务的负载(payload)类型
 * 使用Zod验证确保类型安全和运行时验证
 */

import { z } from 'zod';

/** 仅当前任务所需受管路径；不透传整个 Host 运行根或环境。 */
export const KnowledgeWorkerPathsSchema = z.object({
  sotDirectory: z.string().min(1),
  originalsDirectory: z.string().min(1),
  temporaryDirectory: z.string().min(1),
  qdrantUrl: z.string().url().optional(),
  graphDebugDirectory: z.string().optional(),
});
export type KnowledgeWorkerPaths = z.infer<typeof KnowledgeWorkerPathsSchema>;


/**
 * 知识库文档摄入任务负载的Zod模式
 */
export const IngestionJobPayloadSchema = z.object({
  // 核心标识
  taskId: z.string().min(1),
  docId: z.string().min(1),
  kbId: z.string().min(1),

  // 文件信息
  filename: z.string().min(1),
  filePath: z.string().min(1),
  fileHash: z.string().optional(),
  /** 本任务 OCR 临时素材根，由 Host 入队时冻结。 */
  ocrTemporaryDirectory: z.string().optional(),

  // 模型配置
  embeddingModelId: z.string().min(1),
  pdfOcrModelId: z.string().optional(),
  imageVisionModelId: z.string().optional(),
  visionModelId: z.string().optional(),
  rerankModelId: z.string().optional(),
  graphExtractionModelId: z.string().optional(),

  // 🔥 新增：PDF解析配置
  forceVisionMode: z.boolean().optional().default(false),

  // 任务控制标志
  priority: z.number().int().min(1).max(10).default(5),
  retry: z.boolean().default(true),

  /**
   * Worker 环境变量透传。
   * 目前 ingestion.worker 使用 QDRANT_URL 与 LINNYA_DEV_MODE，避免 worker 内部硬编码 app-host 配置。
   */
  runtime: KnowledgeWorkerPathsSchema,
});

/**
 * 知识库文档摄入任务负载类型
 */
export type IngestionJobPayload = z.infer<typeof IngestionJobPayloadSchema>;

/**
 * 软知识图谱抽取任务负载（Milestone 3）
 *
 * 说明：
 * - 该任务依赖 Level 1 摄入已完成（SoT 文件存在）；
 * - 本阶段只写入 workspace.sqlite 的 knowledge_graph_* 表；
 * - 任务幂等：可重复执行，不会导致 nodes/edges 重复膨胀（由 GraphRepository 的 UPSERT 保证）。
 */
export const GraphExtractionJobPayloadSchema = z.object({
  // 核心标识
  taskId: z.string().min(1),
  kbId: z.string().min(1),
  docId: z.string().min(1),

  /**
   * 使用哪个 LLM 做实体/关系抽取
   * - 必须是 Model Catalog 已登记的模型 ID
   */
  llmModelId: z.string().min(1),

  // 任务控制标志
  priority: z.number().int().min(1).max(10).default(2), // 图谱抽取默认低优先级
  retry: z.boolean().default(true),

  /**
   * Worker 环境变量透传（可选）
   * - 与 ingestion.worker 的 envVars 约定保持一致
   */
  runtime: KnowledgeWorkerPathsSchema,

  /**
   * 抽取上限（可选，避免单 chunk 输出过大）
   * - 这里只做“上限参数透传”，具体裁剪由 service 实现
   */
  maxEntitiesPerChunk: z.number().int().min(1).max(200).default(32),
  maxEdgesPerChunk: z.number().int().min(1).max(300).default(64),

  /**
   * 批量抽取：每次 LLM 调用包含多少个 chunk（block）
   *
   * 背景：
   * - 过去是“一个 chunk 调一次 LLM”，吞吐受网络/模型冷启动/调度开销影响明显；
   * - 改为批量（默认 10 个 chunk 一次）可以显著减少调用次数，提升整体抽取效率；
   * - 通过让模型在输出中携带 chunk_id，我们仍可对每个 chunk 的结果做严格校验后再入库。
   */
  chunksPerCall: z.number().int().min(1).max(50).default(10),
});

/**
 * GraphExtractionJobPayloadInput：入队前的“输入类型”
 * - 允许省略带 default 的字段（retry/priority/max*）
 */
export type GraphExtractionJobPayloadInput = Omit<z.input<typeof GraphExtractionJobPayloadSchema>, 'runtime'>;

/**
 * GraphExtractionJobPayload：Zod parse 之后的“输出类型”
 * - default 已落地，因此字段是必填的 boolean/number
 */
export type GraphExtractionJobPayload = z.output<typeof GraphExtractionJobPayloadSchema>;

/**
 * 图谱向量索引任务负载（M5: Graph Vectorization）
 *
 * 说明：
 * - 该任务依赖图谱抽取（SQLite）已完成；
 * - 目标：把 nodes(name+description) 与 edges(statement) 写入 Qdrant，供后续 Graph Search(full) 使用；
 * - 幂等：Qdrant 点 ID 复用 node.id / edge.id，可重复 upsert，不会产生重复点。
 */
export const GraphIndexingJobPayloadSchema = z.object({
  // 核心标识
  taskId: z.string().min(1),
  kbId: z.string().min(1),
  docId: z.string().min(1),

  /**
   * 使用哪个 embedding 模型做向量化
   * - 与 KB ingestion 的 embeddingModelId 对齐（默认 text-embedding-3-small）
   */
  embeddingModelId: z.string().min(1),

  // 任务控制标志
  priority: z.number().int().min(1).max(10).default(2), // 图谱索引默认低优先级（不抢 UI/搜索）
  retry: z.boolean().default(true),

  /**
   * Worker 环境变量透传（可选）
   * - 与 ingestion/graph-extraction 的 envVars 约定保持一致
   */
  runtime: KnowledgeWorkerPathsSchema,
});

export type GraphIndexingJobPayloadInput = Omit<z.input<typeof GraphIndexingJobPayloadSchema>, 'runtime'>;
export type GraphIndexingJobPayload = z.output<typeof GraphIndexingJobPayloadSchema>;

/**
 * 任务负载验证错误类
 */
export class JobPayloadValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[]
  ) {
    super(message);
    this.name = 'JobPayloadValidationError';
  }
}

/**
 * 验证任务负载并返回类型化结果
 *
 * @param schema Zod验证模式
 * @param payload 要验证的负载对象
 * @returns 验证通过的类型化负载
 * @throws JobPayloadValidationError 如果验证失败
 */
export function validateJobPayload<TSchema extends z.ZodType>(
  schema: TSchema,
  payload: unknown
): z.output<TSchema> {
  try {
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new JobPayloadValidationError(
        `任务负载验证失败: ${error.issues.map(e => e.message).join(', ')}`,
        error.issues
      );
    }
    throw error;
  }
}
