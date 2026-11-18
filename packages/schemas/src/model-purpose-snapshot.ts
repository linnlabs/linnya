import * as z from 'zod';

/** 本轮运行实际采用的用途选择；这里只保存模型身份，不保存端点、凭据或调用权限。 */
export const ModelPurposeSnapshotSchema = z.strictObject({
  embeddingModelId: z.string().min(1).nullable(),
  pdfOcrModelId: z.string().min(1).nullable(),
  imageVisionModelId: z.string().min(1).nullable(),
  graphExtractionModelId: z.string().min(1).nullable(),
}).readonly();

export type ModelPurposeSnapshot = z.infer<typeof ModelPurposeSnapshotSchema>;
