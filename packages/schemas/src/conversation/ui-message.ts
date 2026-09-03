import { z } from 'zod';

import { ConversationAttachmentRefSchema } from './attachment-ref';
import { ConversationMessageIdSchema } from './message-identity';
import { ConversationToolMessagePayloadSchema } from './tool-message';
import { ConversationHistorySummaryPayloadSchema } from './summary-message';
import { ConversationUiPresentationSchema } from './presentation';
import {
  ConversationPartialAnswerPayloadSchema,
  ConversationTerminalAnswerPayloadSchema,
  ConversationThoughtMessagePayloadSchema,
  ConversationToolPreamblePayloadSchema,
  ConversationUserMessagePayloadSchema,
} from './message-metadata';

/**
 * Conversation UI read model 允许持久化和传输的展示方式。
 *
 * `card` 不属于 timeline 消息合同：卡片头是客户端从正式消息派生的 presentation entity，
 * 不能写入 durable message，也不能通过 HTTP 冒充一条 conversation message。
 */
export const ConversationUiMessageRoleSchema = z.enum(['user', 'assistant', 'system']);
export type ConversationUiMessageRole = z.infer<typeof ConversationUiMessageRoleSchema>;

export const ConversationTimelineMessageTypeSchema = z.enum([
  'user_input',
  'thought',
  'tool_calls',
  'final_answer',
  'tool_preamble',
  'partial_answer',
  'history_summary',
]);
export type ConversationTimelineMessageType = z.infer<typeof ConversationTimelineMessageTypeSchema>;

/**
 * role 与 message_type 是一个不可拆分的身份合同。
 *
 * 这里刻意使用判别联合，避免各消费层分别维护字符串列表，也避免出现
 * `role=user + message_type=tool_calls` 这类每个字段单独合法、组合却无意义的数据。
 */
export const ConversationUiMessageIdentitySchema = z.discriminatedUnion('message_type', [
  z.object({ role: z.literal('user'), message_type: z.literal('user_input') }),
  z.object({ role: z.literal('assistant'), message_type: z.literal('thought') }),
  z.object({ role: z.literal('assistant'), message_type: z.literal('tool_calls') }),
  z.object({ role: z.literal('assistant'), message_type: z.literal('final_answer') }),
  z.object({ role: z.literal('assistant'), message_type: z.literal('tool_preamble') }),
  z.object({ role: z.literal('assistant'), message_type: z.literal('partial_answer') }),
  z.object({ role: z.literal('system'), message_type: z.literal('history_summary') }),
]);
export type ConversationUiMessageIdentity = z.infer<typeof ConversationUiMessageIdentitySchema>;

/** Host 内部 camelCase row 从同一份判别联合派生，禁止再次手写枚举。 */
export type ConversationUiMessageKind = ConversationUiMessageIdentity extends infer Identity
  ? Identity extends {
      readonly role: infer Role;
      readonly message_type: infer MessageType;
    }
    ? { readonly role: Role; readonly messageType: MessageType }
    : never
  : never;

/** Renderer message 从同一份判别联合派生，`type` 只改字段名，不改变语义。 */
export type ConversationUiMessageVariant = ConversationUiMessageIdentity extends infer Identity
  ? Identity extends {
      readonly role: infer Role;
      readonly message_type: infer MessageType;
    }
    ? { role: Role; type: MessageType }
    : never
  : never;

/**
 * 把外部/测试夹具中的两个字符串收敛为合法 Renderer identity。
 * 该函数只做合同校验和字段名映射，不推断、不改写 role。
 */
export function parseConversationUiMessageVariant(input: {
  readonly role: unknown;
  readonly type: unknown;
}): ConversationUiMessageVariant {
  const identity = ConversationUiMessageIdentitySchema.parse({
    role: input.role,
    message_type: input.type,
  });
  switch (identity.message_type) {
    case 'user_input':
      return { role: identity.role, type: identity.message_type };
    case 'thought':
      return { role: identity.role, type: identity.message_type };
    case 'tool_calls':
      return { role: identity.role, type: identity.message_type };
    case 'final_answer':
      return { role: identity.role, type: identity.message_type };
    case 'tool_preamble':
      return { role: identity.role, type: identity.message_type };
    case 'partial_answer':
      return { role: identity.role, type: identity.message_type };
    case 'history_summary':
      return { role: identity.role, type: identity.message_type };
  }
}

/** Host camelCase row 的对应入口，与 Renderer variant 使用同一份 schema。 */
export function parseConversationUiMessageKind(input: {
  readonly role: unknown;
  readonly messageType: unknown;
}): ConversationUiMessageKind {
  const identity = ConversationUiMessageIdentitySchema.parse({
    role: input.role,
    message_type: input.messageType,
  });
  switch (identity.message_type) {
    case 'user_input':
      return { role: identity.role, messageType: identity.message_type };
    case 'thought':
      return { role: identity.role, messageType: identity.message_type };
    case 'tool_calls':
      return { role: identity.role, messageType: identity.message_type };
    case 'final_answer':
      return { role: identity.role, messageType: identity.message_type };
    case 'tool_preamble':
      return { role: identity.role, messageType: identity.message_type };
    case 'partial_answer':
      return { role: identity.role, messageType: identity.message_type };
    case 'history_summary':
      return { role: identity.role, messageType: identity.message_type };
  }
}

const ConversationUiMessageCommonFields = {
  message_id: ConversationMessageIdSchema,
  conversation_id: z.string().trim().min(1),
  turn_id: z.string().trim().min(1),
  sort_seq: z.number().int().positive(),
  timestamp: z.number().finite(),
  content: z.string().nullable(),
  attachments: z.array(ConversationAttachmentRefSchema).min(1).optional(),
  merge_key: z.string().trim().min(1).nullable(),
  presentation: ConversationUiPresentationSchema.nullable(),
  run_id: z.string().trim().min(1),
} as const;

/**
 * Host -> HTTP -> Renderer 共用的 durable timeline DTO。
 * 所有读取边界必须 parse 这份 schema；不支持旧字段、旧 payload 形状或读取期兼容。
 */
export const ConversationUiMessageSchema = z.discriminatedUnion('message_type', [
  z.object({
    ...ConversationUiMessageCommonFields,
    role: z.literal('user'),
    message_type: z.literal('user_input'),
    payload: ConversationUserMessagePayloadSchema.nullable(),
  }).strict(),
  z.object({
    ...ConversationUiMessageCommonFields,
    role: z.literal('assistant'),
    message_type: z.literal('thought'),
    payload: ConversationThoughtMessagePayloadSchema,
  }).strict(),
  z.object({
    ...ConversationUiMessageCommonFields,
    role: z.literal('assistant'),
    message_type: z.literal('tool_calls'),
    /** 工具展示完全由 Renderer registry/projector 派生，durable row 不携带显隐指令。 */
    presentation: z.null(),
    payload: ConversationToolMessagePayloadSchema,
  }).strict(),
  z.object({
    ...ConversationUiMessageCommonFields,
    role: z.literal('assistant'),
    message_type: z.literal('final_answer'),
    payload: ConversationTerminalAnswerPayloadSchema,
  }).strict(),
  z.object({
    ...ConversationUiMessageCommonFields,
    role: z.literal('assistant'),
    message_type: z.literal('tool_preamble'),
    payload: ConversationToolPreamblePayloadSchema,
  }).strict(),
  z.object({
    ...ConversationUiMessageCommonFields,
    role: z.literal('assistant'),
    message_type: z.literal('partial_answer'),
    payload: ConversationPartialAnswerPayloadSchema,
  }).strict(),
  z.object({
    ...ConversationUiMessageCommonFields,
    role: z.literal('system'),
    message_type: z.literal('history_summary'),
    payload: ConversationHistorySummaryPayloadSchema,
  }).strict(),
]);
export type ConversationUiMessage = z.infer<typeof ConversationUiMessageSchema>;
