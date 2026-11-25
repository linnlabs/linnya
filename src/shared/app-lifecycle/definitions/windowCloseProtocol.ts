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

// ---- 退出前要用户决定的几件事：先在应用内问，界面不可靠时由主进程改用系统框 ----

export const WINDOW_CLOSE_DECISION_REQUEST_CHANNEL = 'window-close-decision-request';
export const WINDOW_CLOSE_DECISION_PRESENTED_CHANNEL = 'window-close-decision-presented';
export const WINDOW_CLOSE_DECISION_RESULT_CHANNEL = 'window-close-decision-result';
export const WINDOW_CLOSE_DECISION_DISMISS_CHANNEL = 'window-close-decision-dismiss';

export const WindowClosePromptSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('running_tasks'),
    has_executing_commands: z.boolean(),
    scheduled_running_count: z.number().int().nonnegative(),
  }).strict(),
  z.object({ kind: z.literal('activity_unknown') }).strict(),
  z.object({
    kind: z.literal('save_failed'),
    intent: z.enum(['ordinary_exit', 'install_update']),
  }).strict(),
]);
export type WindowClosePrompt = z.infer<typeof WindowClosePromptSchema>;

export const WindowCloseDecisionSchema = z.enum(['return', 'proceed']);
export type WindowCloseDecision = z.infer<typeof WindowCloseDecisionSchema>;

const WindowCloseDecisionIdentity = {
  schema_version: z.literal(1),
  renderer_session_id: WindowCloseRendererSessionIdSchema,
  request_id: WindowCloseRequestIdSchema,
};

export const WindowCloseDecisionRequestMessageSchema = z.object({
  ...WindowCloseDecisionIdentity,
  kind: z.literal('window_close_decision_request'),
  prompt: WindowClosePromptSchema,
}).strict();
export type WindowCloseDecisionRequestMessage = z.infer<typeof WindowCloseDecisionRequestMessageSchema>;

/** 弹窗已经画出来；没有这条回应就不能指望用户看到了它。 */
export const WindowCloseDecisionPresentedMessageSchema = z.object({
  ...WindowCloseDecisionIdentity,
  kind: z.literal('window_close_decision_presented'),
}).strict();
export type WindowCloseDecisionPresentedMessage = z.infer<typeof WindowCloseDecisionPresentedMessageSchema>;

export const WindowCloseDecisionResultMessageSchema = z.object({
  ...WindowCloseDecisionIdentity,
  kind: z.literal('window_close_decision_result'),
  decision: WindowCloseDecisionSchema,
}).strict();
export type WindowCloseDecisionResultMessage = z.infer<typeof WindowCloseDecisionResultMessageSchema>;

/** 主进程已经改用系统框，收起应用内的弹窗。 */
export const WindowCloseDecisionDismissMessageSchema = z.object({
  ...WindowCloseDecisionIdentity,
  kind: z.literal('window_close_decision_dismiss'),
}).strict();
export type WindowCloseDecisionDismissMessage = z.infer<typeof WindowCloseDecisionDismissMessageSchema>;
