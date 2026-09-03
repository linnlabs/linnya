import { z } from 'zod';

export const WINDOW_CLOSE_RENDERER_READY_CHANNEL = 'window-close-renderer-ready';
export const WINDOW_CLOSE_REQUEST_CHANNEL = 'window-close-request';
export const WINDOW_CLOSE_PREPARATION_RESULT_CHANNEL = 'window-close-preparation-result';

export const WindowCloseRendererSessionIdSchema = z.string().uuid().brand<'WindowCloseRendererSessionId'>();
export type WindowCloseRendererSessionId = z.infer<typeof WindowCloseRendererSessionIdSchema>;

export const WindowCloseRequestIdSchema = z.string().uuid().brand<'WindowCloseRequestId'>();
export type WindowCloseRequestId = z.infer<typeof WindowCloseRequestIdSchema>;

export const WindowCloseRendererReadyMessageSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal('window_close_renderer_ready'),
  renderer_session_id: WindowCloseRendererSessionIdSchema,
}).strict();
export type WindowCloseRendererReadyMessage = z.infer<typeof WindowCloseRendererReadyMessageSchema>;

export const WindowCloseRequestMessageSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal('window_close_request'),
  renderer_session_id: WindowCloseRendererSessionIdSchema,
  request_id: WindowCloseRequestIdSchema,
}).strict();
export type WindowCloseRequestMessage = z.infer<typeof WindowCloseRequestMessageSchema>;

export const WindowClosePreparationResultSchema = z.enum(['ready', 'save_failed']);
export type WindowClosePreparationResult = z.infer<typeof WindowClosePreparationResultSchema>;

export const WindowClosePreparationResultMessageSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal('window_close_preparation_result'),
  renderer_session_id: WindowCloseRendererSessionIdSchema,
  request_id: WindowCloseRequestIdSchema,
  result: WindowClosePreparationResultSchema,
}).strict();
export type WindowClosePreparationResultMessage = z.infer<typeof WindowClosePreparationResultMessageSchema>;
