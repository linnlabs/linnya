import { z } from 'zod';

/** 知识库索引任务的 UI/HTTP 只读状态；原文内容和模型凭据不跨此合同。 */
export const KnowledgeIndexTaskStatusSchema = z.object({
  taskId: z.string(), kbId: z.string(), modelId: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  progress: z.number(), message: z.string(), updatedAt: z.number(),
}).strict();
export type KnowledgeIndexTaskStatus = z.infer<typeof KnowledgeIndexTaskStatusSchema>;
