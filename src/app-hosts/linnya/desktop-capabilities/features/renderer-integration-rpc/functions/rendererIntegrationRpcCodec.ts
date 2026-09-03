import { JsonValueSchema, WorkspaceMutationEventSchema } from '@app/schemas';
import { z } from 'zod';
import {
  FrontendStatus,
  InternalStage,
} from '../../../../../../features/knowledge-base/ingestion/definitions/state';

const InternalStageSchema = z.nativeEnum(InternalStage);
const FrontendStatusSchema = z.nativeEnum(FrontendStatus);
const LEGACY_INGESTION_ID_FIELD = resolveLegacyIngestionIdField();

function resolveLegacyIngestionIdField(): 'taskId' {
  return 'taskId';
}

const StoreResultSchema = z.object({
  vectorCount: z.number().int().nonnegative(),
  storageTimestamp: z.number().finite(),
  success: z.literal(true),
}).strict();

export const RendererIntegrationVoidRpcSchema = z.null();

export const RendererIntegrationIngestionStatusRpcSchema = z.object({
  [LEGACY_INGESTION_ID_FIELD]: z.string(),
  docId: z.string(),
  filename: z.string(),
  stage: InternalStageSchema,
  errorMessage: z.string().optional(),
  frontendState: z.object({
    status: FrontendStatusSchema,
    stage: InternalStageSchema,
    progress: z.number().finite(),
    stage_progress: z.number().finite(),
    message: z.string(),
    error: z.string().optional(),
    doc_id: z.string(),
    filename: z.string(),
    updated_at: z.number().finite(),
  }).strict(),
  storeResult: StoreResultSchema.optional(),
}).strict();

export const RendererIntegrationQueueProgressRpcSchema = z.object({
  jobId: z.string(),
  progress: z.number().finite(),
  data: JsonValueSchema,
}).strict();

export const RendererIntegrationQueueCompletionRpcSchema = z.object({
  jobId: z.string(),
  result: JsonValueSchema,
}).strict();

export const RendererIntegrationQueueFailureRpcSchema = z.object({
  jobId: z.string(),
  jobData: JsonValueSchema,
  errorMessage: z.string().optional(),
  failedMessage: z.string(),
}).strict();

export const RendererIntegrationKnowledgeGraphProgressRpcSchema = z.object({
  kbId: z.string(),
  percent: z.number().finite(),
  totalUnits: z.number().finite(),
  doneUnits: z.number().finite(),
  updatedAtSeconds: z.number().finite().nullable(),
}).strict();

export const RendererIntegrationTranscriptionProgressRpcSchema = z.object({
  stage: z.string(),
  percent: z.number().finite(),
  message: z.string(),
  timestamp: z.number().finite(),
}).strict();

export const RendererIntegrationWorkspaceMutationRpcSchema = WorkspaceMutationEventSchema;

export const RendererIntegrationPluginPushRpcSchema = z.object({
  pluginId: z.string().min(1),
  channel: z.string().min(1),
  payload: z.record(z.string(), JsonValueSchema),
}).strict();

export const RendererIntegrationTodosChangedRpcSchema = z.object({
  projectId: z.string().min(1),
}).strict();
