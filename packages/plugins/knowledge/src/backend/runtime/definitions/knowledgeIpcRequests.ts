import { z } from 'zod';

const id = z.string().trim().min(1);
const nullableModel = id.nullable().optional();
export const kbTarget = z.object({ kbId: id });
export const documentTarget = kbTarget.extend({ docId: id });
export const settingsRequest = kbTarget.extend({ settings: z.object({
  name: id.optional(), description: z.string().nullable().optional(), tags: z.array(z.string()).optional(),
  embeddingModelId: nullableModel, rerankModelId: nullableModel, pdfOcrModelId: nullableModel,
  imageVisionModelId: nullableModel, visionModelId: nullableModel, enableGraphIndexing: z.boolean().optional(),
}) });
export const searchRequest = kbTarget.extend({ projectId: id.nullable().optional(), request: z.object({
  query: id, topK: z.number().int().positive().optional(), useReranking: z.boolean().optional(),
  embeddingModelId: nullableModel, rerankModelId: nullableModel,
  filter: z.object({ docIds: z.array(id).optional(), blockTypes: z.array(id).optional(),
    pageRange: z.object({ min: z.number(), max: z.number() }).optional(),
  }).optional(),
}) });
export const uploadFields = z.object({
  kbId: id, embedding_model_id: id, pdf_ocr_model_id: id.optional(), image_vision_model_id: id.optional(),
  vision_model_id: id.optional(), rerank_model_id: id.optional(), graph_extraction_model_id: id.optional(),
  force_vision_mode: z.enum(['true', 'false']).optional(),
});
