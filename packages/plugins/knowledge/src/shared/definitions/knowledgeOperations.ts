import { z } from 'zod';
import { KnowledgeDocumentSchema } from './knowledgeDocument';

/** 推送与轮询共享同一任务投影；阶段内进度不能在轮询时丢掉。 */
export const KnowledgeTaskStatusViewSchema = z.object({
  taskId: z.string(),
  docId: z.string(),
  status: z.string(),
  progress: z.number(),
  stage: z.string(),
  stage_progress: z.number().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  updatedAt: z.number(),
  estimatedTimeRemaining: z.number().optional(),
});
export type KnowledgeTaskStatusView = z.infer<typeof KnowledgeTaskStatusViewSchema>;

export const KnowledgeSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      text: z.string(),
      docId: z.string(),
      docTitle: z.string(),
      score: z.number(),
      matchType: z.string(),
      blockType: z.string(),
      blockId: z.string(),
      page: z.number().optional(),
    })
  ),
  meta: z
    .object({
      processingTimeMs: z.number(),
      vectorModel: z.string().optional(),
      rerankModel: z.string().optional(),
      totalResults: z.number(),
    })
    .optional(),
});
export type KnowledgeSearchResponse = z.infer<typeof KnowledgeSearchResponseSchema>;

/** 图谱进度来自持久任务事实，不依赖 Renderer 的计时或缓存。 */
export const KnowledgeGraphProgressSchema = z.object({
  kbId: z.string(),
  percent: z.number(),
  totalUnits: z.number(),
  doneUnits: z.number(),
  updatedAtSeconds: z.number().nullable(),
});
export type KnowledgeGraphProgress = z.infer<typeof KnowledgeGraphProgressSchema>;

/** 上传仅确认已落入受管任务，不能解读为摄入完成。 */
export const KnowledgeUploadResponseSchema = z.object({
  document: KnowledgeDocumentSchema,
  task_id: z.string(),
  message: z.string(),
  timestamp: z.string(),
});
export type KnowledgeUploadResponse = z.infer<typeof KnowledgeUploadResponseSchema>;

export const KnowledgeContinueFailedPagesResultSchema = z.object({
  docId: z.string(),
  attemptedPages: z.array(z.number()),
  recoveredPages: z.array(z.number()),
  remainingFailedPages: z.array(z.number()),
  addedBlocks: z.number(),
});
export type KnowledgeContinueFailedPagesResult = z.infer<
  typeof KnowledgeContinueFailedPagesResultSchema
>;
