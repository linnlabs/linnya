import { z } from 'zod';

import { ConversationOriginSchema } from './history';

export const EXTERNAL_EXECUTOR_NAME_MAX_LENGTH = 40;

/**
 * 外部调用方自报的执行者名称，例如 "Claude Code"、"Codex"。
 *
 * 只是给人看的标签：外部 Agent 不是 Linnya 启动的，Host 核实不了它是谁。
 * 任何权限、审批或准入判断都不得读取这个值。
 * 不收换行、控制字符和不可见的格式字符，免得一个标签在界面上冒充成别的内容。
 */
export const ExternalExecutorNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(EXTERNAL_EXECUTOR_NAME_MAX_LENGTH)
  .regex(/^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u, 'Executor name must be a single line of visible text');
export type ExternalExecutorName = z.infer<typeof ExternalExecutorNameSchema>;

/**
 * 经外部入口送达的用户消息的发件人。
 * `entry` 由接纳请求的 Host 入口确定；`name` 是调用方自报，没报时界面只显示入口。
 */
export const ConversationExternalSenderSchema = z
  .object({
    entry: ConversationOriginSchema,
    name: ExternalExecutorNameSchema.optional(),
  })
  .strict();
export type ConversationExternalSender = z.infer<typeof ConversationExternalSenderSchema>;
