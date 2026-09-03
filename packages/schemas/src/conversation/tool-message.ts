import { z } from 'zod';
import { JsonRecordSchema, JsonValueSchema, type JsonValue } from '../json-value';
import { ConversationActivityBindingSchema } from './message-metadata';

/** Conversation UI 对工具执行状态的唯一命名。 */
export const ConversationToolMessageStatusSchema = z.enum(['loading', 'success', 'error']);
export type ConversationToolMessageStatus = z.infer<typeof ConversationToolMessageStatusSchema>;

export const ConversationToolMessagePhaseSchema = z.enum(['start', 'update', 'complete', 'error']);
export type ConversationToolMessagePhase = z.infer<typeof ConversationToolMessagePhaseSchema>;

/** 仍可恢复的交互卡。恢复凭证只允许存在于 active variant。 */
export const ConversationActiveToolInteractionSchema = z.object({
  status: z.literal('active'),
  interactionId: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  checkpointRevision: z.number().int().nonnegative(),
  resumeToken: z.string().trim().min(1),
}).strict();

/** 已结算的交互卡。它只描述展示结果，不再承载 run 恢复身份。 */
export const ConversationTerminalToolInteractionSchema = z.object({
  status: z.enum(['submitted', 'skipped', 'approved', 'modified']),
  submittedAt: z.number().finite().optional(),
  response: JsonValueSchema.optional(),
}).strict();

export const ConversationToolInteractionSchema = z.discriminatedUnion('status', [
  ConversationActiveToolInteractionSchema,
  ConversationTerminalToolInteractionSchema,
]);

/** Renderer 提交后由 Host 写入 incoming tool_output 的唯一 metadata 形状。 */
export const ConversationInteractionResponseToolMetadataSchema = z.object({
  interaction: ConversationTerminalToolInteractionSchema,
}).strict();

export type ConversationActiveToolInteraction = z.infer<
  typeof ConversationActiveToolInteractionSchema
>;
export type ConversationTerminalToolInteraction = z.infer<
  typeof ConversationTerminalToolInteractionSchema
>;
export type ConversationToolInteraction = z.infer<typeof ConversationToolInteractionSchema>;
export type ConversationInteractionResponseToolMetadata = z.infer<
  typeof ConversationInteractionResponseToolMetadataSchema
>;

const ConversationSubrunTraceSummarySchema = z.object({
  subrun_ids: z.array(z.string().trim().min(1)),
  event_counts: z.record(z.number().int().nonnegative()),
}).strict();

/**
 * Host 持久化并传给 UI client 的工具消息 payload。
 *
 * `tool_calls` 是模型/provider 的批量调用事实，不是 UI 消息字段；`rawPayload`、
 * `displayOptions` 与 `primary_tool_call_id` 也不属于此合同。渲染、查找与交互恢复
 * 只能读取这里声明的直接字段，禁止从旁路载荷反推。
 * `data` 是程序化结果，`content` 是 observation；Renderer 需要完整工具结果时临时重建，
 * 禁止在 durable row 中再次保存 `{ data, observation }` 包装层。
 */
const ConversationToolMessagePayloadFields = {
  tool_call_id: z.string().trim().min(1),
  tool_name: z.string().trim().min(1),
  status: ConversationToolMessageStatusSchema,
  phase: ConversationToolMessagePhaseSchema,
  args: JsonRecordSchema.optional(),
  data: JsonValueSchema.optional(),
  error: z.string().trim().min(1).optional(),
  /** 工具 owner 的稳定业务错误码，仅用于失败展示与可观察性。 */
  error_code: z.string().trim().min(1).optional(),
  /** 仅保存工具声明的展示补充信息，例如图片宽高；不是 timeline presentation。 */
  presentation: JsonRecordSchema.optional(),
  interaction: ConversationToolInteractionSchema.optional(),
  subrun_summary: ConversationSubrunTraceSummarySchema.optional(),
  activity: ConversationActivityBindingSchema.optional(),
  started_at: z.number().finite(),
  completed_at: z.number().finite().optional(),
} as const;

function requireCompletedAt(
  payload: {
    status: ConversationToolMessageStatus;
    phase: ConversationToolMessagePhase;
    completed_at?: number;
    data?: JsonValue;
    error?: string;
    error_code?: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (payload.status === 'loading') {
    if (payload.completed_at !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completed_at'],
        message: 'loading tool message must not have completed_at',
      });
    }
    if (payload.phase !== 'start' && payload.phase !== 'update') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phase'],
        message: 'loading tool message requires start or update phase',
      });
    }
    return;
  }
  if (payload.completed_at === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['completed_at'],
      message: 'completed_at is required when a tool message is complete',
    });
  }
  const expectedPhase = payload.status === 'error' ? 'error' : 'complete';
  if (payload.phase !== expectedPhase) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phase'],
      message: `${payload.status} tool message requires ${expectedPhase} phase`,
    });
  }
  if (payload.status === 'success' && payload.data === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['data'],
      message: 'successful tool message requires data',
    });
  }
  if (payload.status === 'success' && payload.error_code !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['error_code'],
      message: 'successful tool message must not have error_code',
    });
  }
  if (payload.status === 'error' && payload.error === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['error'],
      message: 'failed tool message requires error',
    });
  }
}

export const ConversationToolMessagePayloadSchema = z.object(
  ConversationToolMessagePayloadFields,
).strict().superRefine(requireCompletedAt);

export type ConversationToolMessagePayload = z.infer<typeof ConversationToolMessagePayloadSchema>;

/**
 * Renderer 内工具消息的正式 metadata。
 *
 * DTO 顶层身份在进入 Renderer 后会按本合同展开；live-only subrun trace 也只能使用
 * 这里列出的两个字段。使用 strict 是为了让旧字段和拼写漂移在读取边界立即失败。
 */
export const ConversationToolMessageMetadataSchema = z.object({
  ...ConversationToolMessagePayloadFields,
  turn_id: z.string().trim().min(1),
  run_id: z.string().trim().min(1),
  execution_id: z.string().trim().min(1).optional(),
  merge_key: z.string().trim().min(1).optional(),
  subrunTrace: z.record(z.unknown()).optional(),
  subrunTraceVersion: z.number().int().nonnegative().optional(),
}).strict().superRefine(requireCompletedAt);

export type ConversationToolMessageMetadata = z.infer<typeof ConversationToolMessageMetadataSchema>;

export function parseConversationToolMessageMetadata(value: unknown): ConversationToolMessageMetadata {
  return ConversationToolMessageMetadataSchema.parse(value);
}
