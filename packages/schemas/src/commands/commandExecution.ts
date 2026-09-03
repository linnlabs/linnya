import { z } from 'zod';

import {
  CommandAgentRunIdSchema,
  CommandConversationIdSchema,
  CommandExecutionIdSchema,
  CommandOriginToolCallIdSchema,
  CommandOwnerGenerationIdSchema,
  CommandProcessHandleSchema,
} from './commandIdentity';

export const COMMAND_RUNTIME_PROTOCOL_VERSION = 1 as const;

export const CommandExecutionModeSchema = z.enum(['pipe', 'pty']);
export type CommandExecutionMode = z.infer<typeof CommandExecutionModeSchema>;

/**
 * Host 在启动前冻结的执行身份。它不携带 PID，也不把某个 Agent run 当成命令执行本身。
 */
export const CommandExecutionIdentitySchema = z.object({
  conversation_id: CommandConversationIdSchema,
  agent_run_id: CommandAgentRunIdSchema,
  origin_tool_call_id: CommandOriginToolCallIdSchema,
  command_execution_id: CommandExecutionIdSchema,
  owner_generation_id: CommandOwnerGenerationIdSchema,
  created_at_ms: z.number().int().nonnegative().safe(),
}).strict();
export type CommandExecutionIdentity = z.infer<typeof CommandExecutionIdentitySchema>;

export function hasSameCommandExecutionIdentity(
  left: CommandExecutionIdentity,
  right: CommandExecutionIdentity,
): boolean {
  return left.conversation_id === right.conversation_id
    && left.agent_run_id === right.agent_run_id
    && left.origin_tool_call_id === right.origin_tool_call_id
    && left.command_execution_id === right.command_execution_id
    && left.owner_generation_id === right.owner_generation_id
    && left.created_at_ms === right.created_at_ms;
}

/**
 * Electron owner 与短命 runner 之间的逻辑绑定。process_handle 是连接内凭据，不是 OS PID。
 */
export const CommandExecutionOwnerBindingV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_execution_owner_binding'),
  identity: CommandExecutionIdentitySchema,
  process_handle: CommandProcessHandleSchema,
  mode: CommandExecutionModeSchema,
}).strict();
export type CommandExecutionOwnerBindingV1 = z.infer<
  typeof CommandExecutionOwnerBindingV1Schema
>;

export function parseCommandExecutionOwnerBinding(
  value: unknown,
): CommandExecutionOwnerBindingV1 {
  return CommandExecutionOwnerBindingV1Schema.parse(value);
}
