import { z } from 'zod';

import { COMMAND_RUNTIME_PROTOCOL_VERSION } from './commandExecution';
import {
  CommandAgentRunIdSchema,
  CommandConversationIdSchema,
  CommandControlToolCallIdSchema,
  CommandOwnerGenerationIdSchema,
  CommandProcessHandleSchema,
} from './commandIdentity';

export const ProcessOutputCursorSchema = z.number().int().nonnegative().safe()
  .brand<'ProcessOutputCursor'>();
export type ProcessOutputCursor = z.infer<typeof ProcessOutputCursorSchema>;

/** Node timer 的最大可靠毫秒值；这是 wire 技术边界，不是产品默认等待时间。 */
export const MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS = 2_147_483_647;
/** 单次 Agent 交互输入的 UTF-8 byte 上限；不能用 JavaScript 字符数代替。 */
export const MAX_PROCESS_INTERACTION_INPUT_BYTES = 64 * 1_024;
/** Windows ConPTY COORD 与 Unix PTY 都能稳定表达的统一坐标上限。 */
export const MAX_PROCESS_PTY_DIMENSION = 32_767;

const PROCESS_INTERACTION_INPUT_ENCODER = new TextEncoder();
const ProcessInteractionInputSchema = z.string().refine(
  value => PROCESS_INTERACTION_INPUT_ENCODER.encode(value).byteLength
    <= MAX_PROCESS_INTERACTION_INPUT_BYTES,
  { message: `input must not exceed ${MAX_PROCESS_INTERACTION_INPUT_BYTES} UTF-8 bytes` },
);

export const ProcessPtySizeV1Schema = z.object({
  columns: z.number().int().positive().max(MAX_PROCESS_PTY_DIMENSION),
  rows: z.number().int().positive().max(MAX_PROCESS_PTY_DIMENSION),
}).strict();
export type ProcessPtySizeV1 = z.infer<typeof ProcessPtySizeV1Schema>;

export const ProcessControlScopeV1Schema = z.object({
  conversation_id: CommandConversationIdSchema,
  agent_run_id: CommandAgentRunIdSchema,
  control_tool_call_id: CommandControlToolCallIdSchema,
  owner_generation_id: CommandOwnerGenerationIdSchema,
}).strict();
export type ProcessControlScopeV1 = z.infer<typeof ProcessControlScopeV1Schema>;

const ProcessWriteActionV1Schema = z.object({
  type: z.literal('write'),
  input: ProcessInteractionInputSchema.pipe(z.string().min(1)),
}).strict();

const ProcessSubmitActionV1Schema = z.object({
  type: z.literal('submit'),
  input: ProcessInteractionInputSchema,
}).strict();

const ProcessEofActionV1Schema = z.object({
  type: z.literal('eof'),
}).strict();

const ProcessResizeActionV1Schema = ProcessPtySizeV1Schema.extend({
  type: z.literal('resize'),
}).strict();

/**
 * owner 与 disposable runner 共用同一份交互动作准入。runner 不接收 poll、wait 或
 * cancel，避免把观察、整树停止与 PTY 输入错误地塞进同一个串行队列。
 */
export const ProcessInteractionActionV1Schema = z.discriminatedUnion('type', [
  ProcessWriteActionV1Schema,
  ProcessSubmitActionV1Schema,
  ProcessEofActionV1Schema,
  ProcessResizeActionV1Schema,
]);
export type ProcessInteractionActionV1 = z.infer<
  typeof ProcessInteractionActionV1Schema
>;

export const ProcessControlActionV1Schema = z.union([
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('poll'),
      cursor: ProcessOutputCursorSchema,
    }).strict(),
    z.object({
      type: z.literal('wait'),
      cursor: ProcessOutputCursorSchema,
      wait_timeout_ms: z.number().int().positive()
        .max(MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS),
    }).strict(),
    z.object({
      type: z.literal('cancel'),
    }).strict(),
  ]),
  ProcessInteractionActionV1Schema,
]);
export type ProcessControlActionV1 = z.infer<typeof ProcessControlActionV1Schema>;

/**
 * 这是 host 补齐 owner generation 后发送的内部控制请求，不是 Agent 工具的直接入参。
 * Agent 只能提供 handle 和 action，不能自行声明 generation 来绕过当前 owner。
 */
export const ProcessControlRequestV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('process_control_request'),
  process_handle: CommandProcessHandleSchema,
  scope: ProcessControlScopeV1Schema,
  action: ProcessControlActionV1Schema,
}).strict();
export type ProcessControlRequestV1 = z.infer<typeof ProcessControlRequestV1Schema>;

export const PROCESS_INTERACTION_REJECTION_CODES = [
  'stdin_closed',
  'input_budget_exceeded',
  'action_not_supported',
  'interaction_failed',
] as const;
export const ProcessInteractionRejectionCodeSchema = z.enum(
  PROCESS_INTERACTION_REJECTION_CODES,
);
export type ProcessInteractionRejectionCode = z.infer<
  typeof ProcessInteractionRejectionCodeSchema
>;

/** 已经通过 wire 校验，但不满足当前 owner/handle 业务状态。 */
export const ProcessControlRejectionCodeSchema = z.enum([
  'unknown_handle',
  'handle_expired',
  'owner_ended',
  'scope_mismatch',
  'incompatible_state',
  'owner_ending',
  'action_conflict',
  'invalid_cursor',
  ...PROCESS_INTERACTION_REJECTION_CODES,
]);
export type ProcessControlRejectionCode = z.infer<
  typeof ProcessControlRejectionCodeSchema
>;

/**
 * 仅供 runner 与 host 核对控制回复。Agent/UI projection 不得携带 scope 或 generation，
 * 并必须把 scope_mismatch 投影成与 unknown_handle 不可区分的用户结果。
 */
export const ProcessControlRejectedV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('process_control_rejected'),
  process_handle: CommandProcessHandleSchema,
  scope: ProcessControlScopeV1Schema,
  code: ProcessControlRejectionCodeSchema,
}).strict();
export type ProcessControlRejectedV1 = z.infer<typeof ProcessControlRejectedV1Schema>;

export function parseProcessControlRequest(value: unknown): ProcessControlRequestV1 {
  return ProcessControlRequestV1Schema.parse(value);
}

export function parseProcessControlRejected(value: unknown): ProcessControlRejectedV1 {
  return ProcessControlRejectedV1Schema.parse(value);
}
