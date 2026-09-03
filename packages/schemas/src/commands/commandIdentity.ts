import { z } from 'zod';

const CommandIdentityPartSchema = z.string()
  .min(1)
  .refine(value => value === value.trim(), 'command identity must not contain surrounding whitespace');

/**
 * 这些身份在 wire 上都是字符串，但职责和生命周期不同，因此必须使用不同的名义类型。
 * 共享 schema 不依赖 Linnkit；进入 host 后还要由 mapper 校验为对应的 Runtime 身份。
 */
export const CommandConversationIdSchema = CommandIdentityPartSchema
  .brand<'CommandConversationId'>();
export type CommandConversationId = z.infer<typeof CommandConversationIdSchema>;

export const CommandAgentRunIdSchema = CommandIdentityPartSchema
  .brand<'CommandAgentRunId'>();
export type CommandAgentRunId = z.infer<typeof CommandAgentRunIdSchema>;

export const CommandOriginToolCallIdSchema = CommandIdentityPartSchema
  .brand<'CommandOriginToolCallId'>();
export type CommandOriginToolCallId = z.infer<typeof CommandOriginToolCallIdSchema>;

export const CommandControlToolCallIdSchema = CommandIdentityPartSchema
  .brand<'CommandControlToolCallId'>();
export type CommandControlToolCallId = z.infer<typeof CommandControlToolCallIdSchema>;

const RANDOM_UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

/** 一条 Shell 命令的独立身份，不能复用 Agent run、tool call、Linnkit ExecutionId 或 PID。 */
export const CommandExecutionIdSchema = z.string()
  .regex(new RegExp(`^command_execution_${RANDOM_UUID_PATTERN}$`))
  .brand<'CommandExecutionId'>();
export type CommandExecutionId = z.infer<typeof CommandExecutionIdSchema>;

/** 每次 Electron command owner 建立时生成；旧 generation 的回调不得操作新 owner。 */
export const CommandOwnerGenerationIdSchema = z.string()
  .regex(new RegExp(`^command_owner_${RANDOM_UUID_PATTERN}$`))
  .brand<'CommandOwnerGenerationId'>();
export type CommandOwnerGenerationId = z.infer<typeof CommandOwnerGenerationIdSchema>;

/**
 * Agent 可见的逻辑进程凭据。前缀只标识合同类型，随机 UUID 不编码 PID、对话或执行身份。
 */
export const CommandProcessHandleSchema = z.string()
  .regex(new RegExp(`^command_process_${RANDOM_UUID_PATTERN}$`))
  .brand<'CommandProcessHandle'>();
export type CommandProcessHandle = z.infer<typeof CommandProcessHandleSchema>;

/** 每次审批独立生成，不能复用 execution、tool call 或命令文本作为请求身份。 */
export const CommandApprovalRequestIdSchema = z.string()
  .regex(new RegExp(`^command_approval_${RANDOM_UUID_PATTERN}$`))
  .brand<'CommandApprovalRequestId'>();
export type CommandApprovalRequestId = z.infer<typeof CommandApprovalRequestIdSchema>;
