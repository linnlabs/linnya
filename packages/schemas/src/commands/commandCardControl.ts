import { z } from 'zod';

import { CommandProcessHandleSchema } from './commandIdentity';
import { ShellToolTerminalSummarySchema } from './commandToolDisplay';
import { MAX_PROCESS_INTERACTION_INPUT_BYTES } from './processControl';

export const COMMAND_CARD_CONTROL_PROTOCOL_VERSION = 1 as const;

export const CommandCardAuditStatusSchema = z.enum(['complete', 'incomplete']);

export const CommandCardControlPageTicketSchema = z.string()
  .regex(/^command_control_page_[0-9a-f-]{36}$/);

export const CommandCardControlTicketSchema = z.string()
  .regex(/^command_control_ticket_[0-9a-f-]{36}$/);

export const CommandProtectedInputTicketSchema = z.string()
  .regex(/^command_protected_input_ticket_[0-9a-f-]{36}$/);

const PROTECTED_INPUT_ENCODER = new TextEncoder();

/**
 * 用户保护输入与 Agent process 参数使用相同的单次 byte 上限，但属于独立 wire 合同。
 * 保持独立可防止未来扩展 Agent action 时把秘密字段意外投影进聊天或工具日志。
 */
export const CommandProtectedInputValueSchema = z.string().refine(
  value => PROTECTED_INPUT_ENCODER.encode(value).byteLength
    <= MAX_PROCESS_INTERACTION_INPUT_BYTES,
  { message: `protected input must not exceed ${MAX_PROCESS_INTERACTION_INPUT_BYTES} UTF-8 bytes` },
);

export const CommandCardExecutionSettlementV1Schema = z.object({
  protocol_version: z.literal(COMMAND_CARD_CONTROL_PROTOCOL_VERSION),
  kind: z.literal('command_card_execution_settlement'),
  conversation_id: z.string().trim().min(1),
  process_handle: CommandProcessHandleSchema,
  /**
   * 用于历史 tool_call_decision 未收到 tool_output 时的 settlement 关联。
   * 旧快照可缺省，新建/重新读取的 settlement 由 host 从 terminal identity 补齐。
   */
  origin_tool_call_id: z.string().trim().min(1).optional(),
  started_at_ms: z.number().int().safe().nonnegative(),
  settled_at_ms: z.number().int().safe().nonnegative(),
  audit_status: CommandCardAuditStatusSchema,
  terminal: ShellToolTerminalSummarySchema,
}).strict().refine(
  value => value.settled_at_ms >= value.started_at_ms,
  { path: ['settled_at_ms'], message: 'command settlement cannot precede start' },
);

export const CommandCardControlCapabilityV1Schema = z.object({
  protocol_version: z.literal(COMMAND_CARD_CONTROL_PROTOCOL_VERSION),
  kind: z.literal('command_card_control_capability'),
  process_handle: CommandProcessHandleSchema,
  control_ticket: CommandCardControlTicketSchema,
  protected_input_ticket: CommandProtectedInputTicketSchema.optional(),
}).strict();

export const CommandCardControlPageSnapshotV1Schema = z.object({
  protocol_version: z.literal(COMMAND_CARD_CONTROL_PROTOCOL_VERSION),
  kind: z.literal('command_card_control_page_snapshot'),
  page_ticket: CommandCardControlPageTicketSchema,
  conversation_id: z.string().trim().min(1),
  capabilities: z.array(CommandCardControlCapabilityV1Schema).readonly(),
  settlements: z.array(CommandCardExecutionSettlementV1Schema).readonly(),
  settlement_failures: z.array(CommandProcessHandleSchema).readonly(),
  audit_failures: z.array(CommandProcessHandleSchema).readonly(),
}).strict();

export const CommandCardControlPageOpenRequestV1Schema = z.object({
  conversation_id: z.string().trim().min(1),
}).strict();

export const CommandCardControlPageOpenResultV1Schema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), snapshot: CommandCardControlPageSnapshotV1Schema }).strict(),
  z.object({ success: z.literal(false), code: z.literal('owner_unavailable') }).strict(),
]);

export const CommandCardControlPageCloseRequestV1Schema = z.object({
  page_ticket: CommandCardControlPageTicketSchema,
}).strict();

export const CommandCardControlPageCloseResultV1Schema = z.object({
  status: z.enum(['closed', 'stale']),
}).strict();

export const CommandCardCancelSubmissionV1Schema = z.object({
  page_ticket: CommandCardControlPageTicketSchema,
  control_ticket: CommandCardControlTicketSchema,
}).strict();

export const CommandCardCancelResultV1Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('settled'), settlement: CommandCardExecutionSettlementV1Schema }).strict(),
  z.object({ status: z.literal('stale') }).strict(),
  z.object({ status: z.literal('failed'), code: z.enum([
    'owner_unavailable',
    'incompatible_state',
    'owner_ending',
    'owner_ended',
    'action_conflict',
    'persistence_failed',
  ]) }).strict(),
]);

export const CommandProtectedInputSubmissionV1Schema = z.object({
  page_ticket: CommandCardControlPageTicketSchema,
  protected_input_ticket: CommandProtectedInputTicketSchema,
  input: CommandProtectedInputValueSchema,
}).strict();

export const CommandProtectedInputResultV1Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('accepted') }).strict(),
  z.object({ status: z.literal('stale') }).strict(),
  z.object({
    status: z.literal('failed'),
    code: z.enum([
      'owner_unavailable',
      'incompatible_state',
      'owner_ending',
      'owner_ended',
      'stdin_closed',
      'interaction_failed',
    ]),
  }).strict(),
]);

export const CommandCardControlChangedEventV1Schema = z.object({
  protocol_version: z.literal(COMMAND_CARD_CONTROL_PROTOCOL_VERSION),
  kind: z.literal('command_card_control_changed'),
  snapshot: CommandCardControlPageSnapshotV1Schema,
}).strict();

export const COMMAND_CARD_CONTROL_PAGE_OPEN_CHANNEL = 'command-card-control:open-page';
export const COMMAND_CARD_CONTROL_PAGE_CLOSE_CHANNEL = 'command-card-control:close-page';
export const COMMAND_CARD_CANCEL_CHANNEL = 'command-card-control:cancel';
export const COMMAND_PROTECTED_INPUT_CHANNEL = 'command-card-control:protected-input';
export const COMMAND_CARD_CONTROL_CHANGED_CHANNEL = 'command-card-control:changed';

export type CommandCardControlPageTicket = z.infer<typeof CommandCardControlPageTicketSchema>;
export type CommandCardControlTicket = z.infer<typeof CommandCardControlTicketSchema>;
export type CommandProtectedInputTicket = z.infer<typeof CommandProtectedInputTicketSchema>;
export type CommandCardAuditStatus = z.infer<typeof CommandCardAuditStatusSchema>;
export type CommandCardExecutionSettlementV1 = z.infer<typeof CommandCardExecutionSettlementV1Schema>;
export type CommandCardControlPageSnapshotV1 = z.infer<typeof CommandCardControlPageSnapshotV1Schema>;
export type CommandCardCancelSubmissionV1 = z.infer<typeof CommandCardCancelSubmissionV1Schema>;
export type CommandCardCancelResultV1 = z.infer<typeof CommandCardCancelResultV1Schema>;
export type CommandProtectedInputSubmissionV1 = z.infer<
  typeof CommandProtectedInputSubmissionV1Schema
>;
export type CommandProtectedInputResultV1 = z.infer<typeof CommandProtectedInputResultV1Schema>;
export type CommandCardControlChangedEventV1 = z.infer<typeof CommandCardControlChangedEventV1Schema>;
export type CommandCardControlPageOpenResultV1 = z.infer<typeof CommandCardControlPageOpenResultV1Schema>;
export type CommandCardControlPageCloseResultV1 = z.infer<
  typeof CommandCardControlPageCloseResultV1Schema
>;
