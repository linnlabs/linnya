import { z } from 'zod';

import { SerializableJsonRecord, SerializableJsonValue } from './json';
import { Status, ToolCallPhase } from './runtime-status';
import { FinalAnswerCompletionReason } from './final-answer';
import { RuntimeResourceRefs } from './resource-ref';
import {
  AnswerSegmentIdSchema,
  HistoryMessageReferenceIdSchema,
  SourceEventIdSchema,
  SubrunIdSchema,
  ToolCallIdSchema,
} from './identity';

/**
 * Child trace 事件类别的唯一 Runtime 合同。
 *
 * Host 查询、持久化读取、SSE 与插件公开类型都必须从这里派生；禁止在消费层
 * 重列 enum 或用 switch 维护另一份“可读取 kind”清单。
 */
export const SubRunTraceKind = z.enum([
  'thought_delta',
  'thought_complete',
  'tool_call_decision',
  'tool_process',
  'tool_output',
  'final_answer_chunk',
  'final_answer',
  'history_summary',
]);
export type SubRunTraceKind = z.infer<typeof SubRunTraceKind>;

export const SubRunTraceToolCallDecision = z.object({
  tool_call_id: ToolCallIdSchema,
  tool_name: z.string().trim().min(1),
  args: SerializableJsonRecord,
}).strict();
export type SubRunTraceToolCallDecision = z.infer<typeof SubRunTraceToolCallDecision>;

export const SubRunTracePayload = z.object({
  parent_tool_call_id: ToolCallIdSchema,
  subrun_id: SubrunIdSchema,
  subrun_parent_id: SubrunIdSchema.optional(),
  source_event_id: SourceEventIdSchema,
  kind: SubRunTraceKind,
  delta: z.string().optional(),
  content: z.string().optional(),
  answer_id: AnswerSegmentIdSchema.optional(),
  seq: z.number().int().nonnegative().optional(),
  is_last: z.boolean().optional(),
  completion_reason: FinalAnswerCompletionReason.optional(),
  tool_name: z.string().optional(),
  tool_call_id: ToolCallIdSchema.optional(),
  phase: ToolCallPhase.optional(),
  status: Status.optional(),
  args: SerializableJsonRecord.optional(),
  tool_calls: z.array(SubRunTraceToolCallDecision).min(1).optional(),
  output: SerializableJsonValue.optional(),
  attachments: RuntimeResourceRefs.optional(),
  duration_ms: z.number().optional(),
  original_message_count: z.number().int().nonnegative().optional(),
  compression_ratio: z.number().min(0).max(1).optional(),
  included_old_summary: z.boolean().optional(),
  replaced_message_ids: z.array(HistoryMessageReferenceIdSchema).optional(),
  meta: SerializableJsonRecord.optional(),
});

export type SubRunTracePayload = z.infer<typeof SubRunTracePayload>;

/**
 * trace 的归并字段必须由共享协议校验，不能留给 Host 或 Renderer 各自猜测。
 * 这里单独保留语义校验，是因为 RuntimeEvent 与 SSEEvent 共享 payload，基础 envelope 不同。
 */
export function validateSubRunTracePayloadSemantics(
  payload: SubRunTracePayload,
  ctx: z.RefinementCtx,
): void {
  if (payload.kind === 'thought_delta' && payload.delta === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['delta'], message: 'thought_delta requires delta' });
  }
  if (payload.kind === 'thought_complete' && payload.content === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: 'thought_complete requires content' });
  }
  if (payload.kind === 'final_answer_chunk') {
    if (payload.answer_id === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['answer_id'], message: 'final_answer_chunk requires answer_id' });
    }
    if (payload.seq === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['seq'], message: 'final_answer_chunk requires seq' });
    }
    if (payload.delta === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['delta'], message: 'final_answer_chunk requires delta' });
    }
  }
  if (payload.kind === 'final_answer') {
    if (payload.answer_id === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['answer_id'], message: 'final_answer requires answer_id' });
    }
    if (payload.content === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: 'final_answer requires content' });
    }
    if (payload.completion_reason === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completion_reason'],
        message: 'final_answer requires completion_reason',
      });
    }
  }
  if (payload.kind === 'history_summary') {
    if (payload.original_message_count === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['original_message_count'],
        message: 'history_summary requires original_message_count',
      });
    }
    if (payload.replaced_message_ids === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replaced_message_ids'],
        message: 'history_summary requires replaced_message_ids',
      });
    }
  }
  if (payload.kind === 'tool_call_decision') {
    if (payload.tool_calls === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tool_calls'],
        message: 'tool_call_decision requires canonical tool_calls',
      });
    }
    for (const field of ['tool_name', 'tool_call_id', 'phase', 'status', 'args'] as const) {
      if (payload[field] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `tool_call_decision forbids legacy scalar ${field}`,
        });
      }
    }
  } else if (payload.tool_calls !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tool_calls'],
      message: `${payload.kind} forbids tool_calls`,
    });
  }
  if (payload.kind === 'tool_process' || payload.kind === 'tool_output') {
    if (payload.tool_name === undefined || payload.tool_name.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tool_name'], message: `${payload.kind} requires tool_name` });
    }
    if (payload.tool_call_id === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tool_call_id'], message: `${payload.kind} requires tool_call_id` });
    }
  }
  if (payload.kind === 'tool_process') {
    if (payload.phase === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phase'], message: `${payload.kind} requires phase` });
    }
    if (payload.status === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: `${payload.kind} requires status` });
    }
    if (payload.args === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['args'],
        message: 'tool_process requires owner-admitted args',
      });
    }
  }
  if (
    payload.kind === 'tool_output'
    && payload.status !== 'success'
    && payload.status !== 'error'
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: 'tool_output requires success or error status',
    });
  }
  if (payload.kind === 'tool_output' && payload.output === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['output'],
      message: 'tool_output requires structured output',
    });
  }
  if (payload.attachments !== undefined) {
    if (payload.kind !== 'tool_output') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachments'],
        message: `${payload.kind} forbids attachments`,
      });
    } else if (payload.status !== 'success') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachments'],
        message: 'attachments require successful tool_output',
      });
    }
  }
}
