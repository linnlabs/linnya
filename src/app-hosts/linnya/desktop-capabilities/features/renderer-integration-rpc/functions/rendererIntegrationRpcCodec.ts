import { JsonValueSchema, WorkspaceMutationEventSchema } from '@app/schemas';
import { z } from 'zod';
export const RendererIntegrationVoidRpcSchema = z.null();
export const RendererIntegrationPluginDataChangedRpcSchema = z.string().min(1);

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
