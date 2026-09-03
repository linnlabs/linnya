/**
 * @file src/shared/types.ts
 * 
 * @brief 定义跨模块共享的 Zod schema、类型和枚举。
 *
 * @description
 * 该文件定义了在整个应用中通用的类型和枚举。这些类型将被多个模块引用，
 * 因此它们被放置在 `shared` 模块中以避免循环依赖。
 * 
 * TypeScript 类型负责静态约束，Zod schema 负责运行时输入验证。
 */

import { z } from 'zod';

/**
 * 品牌类型工具，用于创建名义类型（Nominal Types）
 * 这使我们可以区分结构相同但语义不同的类型，如 DocId 和 BlockId
 */
export type Brand<K, T> = K & { __brand: T };

/**
 * 文档ID类型，格式为 "doc-{hash}"
 */
export type DocId = Brand<string, 'DocId'>;

/**
 * 块ID类型，为符合 Qdrant 要求的 UUID 字符串
 */
export type BlockId = Brand<string, 'BlockId'>;

/**
 * 任务ID类型，格式为 "task-{uuid}"
 */
export type TaskId = Brand<string, 'TaskId'>;

/**
 * 任务状态枚举
 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

/**
 * 任务阶段枚举
 */
export enum TaskStage {
  INITIALIZED = 'initialized',
  PARSING = 'parsing',
  CHUNKING = 'chunking',
  EMBEDDING = 'embedding',
  INDEXING = 'indexing',
  COMPLETED = 'completed',
}

/**
 * 基础任务状态 Schema，用于验证任务状态数据
 */
export const TaskStateSchema = z.object({
  id: z.string(),
  status: z.nativeEnum(TaskStatus),
  stage: z.nativeEnum(TaskStage).optional(),
  progress: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

/**
 * 任务状态类型，从 Schema 中推导
 */
export type TaskState = z.infer<typeof TaskStateSchema>;

/**
 * 知识库文档状态枚举
 */
export enum DocumentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DELETED = 'deleted',
}

/**
 * 模型能力枚举，定义了不同AI模型可能具备的能力
 */
export enum ModelCapability {
  CHAT = 'chat',
  EMBEDDING = 'embedding',
  RERANK = 'rerank',
  VISION = 'vision',
  AUDIO_TRANSCRIPTION = 'audio_transcription',
}

/**
 * 模型提供商枚举
 */
export enum ModelProvider {
  OPENAI = 'openai',
  OLLAMA = 'ollama',
  FEIAI = 'feiai',
  DEEPSEEK = 'deepseek',
  GITEE = 'gitee',
  CUSTOM_API = 'custom_api',
  SYSTEM_DEFAULT = 'system_default',
}
