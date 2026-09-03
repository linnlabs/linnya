import { z } from 'zod';
import {
  ModelEmbeddingRouteSchema,
  ModelImageGenerationRouteSchema,
  ModelInferenceRouteSchema,
  ModelRerankingRouteSchema,
} from '@app/schemas/model-inference';
import { DocumentOcrRouteSchema } from '@app/schemas/document-ocr';
import { TranscriptionRouteSchema } from '@app/schemas/transcription';
const ReasoningEffortSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

const ModelReasoningConfigSchema = z.object({
  supported_efforts: z.array(ReasoningEffortSchema),
  default_effort: ReasoningEffortSchema.optional(),
});

export const ModelCatalogItemSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().optional(),
  name: z.string().optional(),
  model_name: z.string().optional(),
  catalog_source: z.enum(['default', 'cloud', 'account', 'user']),
  inference_endpoint_id: z.string().min(1).optional(),
  inference_route: ModelInferenceRouteSchema.optional(),
  embedding_route: ModelEmbeddingRouteSchema.optional(),
  reranking_route: ModelRerankingRouteSchema.optional(),
  image_generation_route: ModelImageGenerationRouteSchema.optional(),
  document_ocr_route: DocumentOcrRouteSchema.optional(),
  transcription_route: TranscriptionRouteSchema.optional(),
  billing_mode: z.enum(['byok', 'cloud']).optional(),
  ui_visibility: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  reasoning: ModelReasoningConfigSchema.optional(),
});

export type ModelCatalogItem = z.infer<typeof ModelCatalogItemSchema>;

export const ModelCatalogSnapshotSchema = z.object({
  models: z.array(ModelCatalogItemSchema),
  task_defaults: z.record(z.string(), z.string()),
  cloud_models_ready: z.boolean(),
});

export interface ModelCatalogSnapshot {
  readonly models: readonly ModelCatalogItem[];
  readonly purposeDefaults: Readonly<Record<string, string>>;
  readonly cloudModelsReady: boolean;
}

export type ModelCatalogOperation = 'load' | 'update' | 'delete';

export interface ModelCatalogError {
  readonly operation: ModelCatalogOperation;
  readonly detail: string | null;
}

export interface UpdateModelCommand {
  readonly display_name?: string;
  readonly model_name?: string;
  readonly capabilities?: readonly string[];
  readonly inference_route?: ModelCatalogItem['inference_route'];
  readonly embedding_route?: ModelCatalogItem['embedding_route'];
  readonly reranking_route?: ModelCatalogItem['reranking_route'];
  readonly image_generation_route?: ModelCatalogItem['image_generation_route'];
  readonly document_ocr_route?: ModelCatalogItem['document_ocr_route'];
  readonly transcription_route?: ModelCatalogItem['transcription_route'];
}
