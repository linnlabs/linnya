import { z } from 'zod';

import { CommandProcessHandleSchema } from './commandIdentity';
import { ProcessOutputCursorSchema } from './processControl';
import {
  ProcessToolPublicRejectionCodeSchema,
  ShellToolPublicRejectionCodeSchema,
  ShellToolTerminalSummarySchema,
} from './commandToolDisplay';

export const COMMAND_AGENT_MODEL_CONTROL_PROTOCOL_VERSION = 1 as const;

const ShellModelControlBaseSchema = z.object({
  protocol_version: z.literal(COMMAND_AGENT_MODEL_CONTROL_PROTOCOL_VERSION),
  kind: z.literal('shell_model_control'),
});

/** 模型控制首行只含继续执行所需事实；正文由通用 observation 治理独立截断。 */
export const ShellAgentModelControlV1Schema = z.discriminatedUnion('status', [
  ShellModelControlBaseSchema.extend({
    status: z.literal('running'),
    process_handle: CommandProcessHandleSchema,
    next_cursor: ProcessOutputCursorSchema,
  }).strict(),
  ShellModelControlBaseSchema.extend({
    status: z.literal('completed'),
    terminal: ShellToolTerminalSummarySchema,
  }).strict(),
  ShellModelControlBaseSchema.extend({
    status: z.literal('rejected'),
    code: ShellToolPublicRejectionCodeSchema,
  }).strict(),
]);

const ProcessModelControlBaseSchema = z.object({
  protocol_version: z.literal(COMMAND_AGENT_MODEL_CONTROL_PROTOCOL_VERSION),
  kind: z.literal('process_model_control'),
  process_handle: CommandProcessHandleSchema,
});

/** 每轮 process 控制首行都回显 handle，模型只读最新工具消息也能继续控制。 */
export const ProcessAgentModelControlV1Schema = z.discriminatedUnion('status', [
  ProcessModelControlBaseSchema.extend({
    status: z.literal('running'),
    next_cursor: ProcessOutputCursorSchema,
  }).strict(),
  ProcessModelControlBaseSchema.extend({
    status: z.literal('completed'),
    terminal: ShellToolTerminalSummarySchema,
  }).strict(),
  ProcessModelControlBaseSchema.extend({
    status: z.literal('accepted'),
  }).strict(),
  ProcessModelControlBaseSchema.extend({
    status: z.literal('rejected'),
    code: ProcessToolPublicRejectionCodeSchema,
  }).strict(),
]);

export const CommandAgentModelControlV1Schema = z.union([
  ShellAgentModelControlV1Schema,
  ProcessAgentModelControlV1Schema,
]);

export type ShellAgentModelControlV1 = z.infer<typeof ShellAgentModelControlV1Schema>;
export type ProcessAgentModelControlV1 = z.infer<typeof ProcessAgentModelControlV1Schema>;
export type CommandAgentModelControlV1 = z.infer<typeof CommandAgentModelControlV1Schema>;
