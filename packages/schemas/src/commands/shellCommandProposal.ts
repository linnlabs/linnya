import { z } from 'zod';

import {
  COMMAND_RUNTIME_PROTOCOL_VERSION,
  CommandExecutionIdentitySchema,
  hasSameCommandExecutionIdentity,
} from './commandExecution';
import { CommandPermissionSnapshotV1Schema } from './commandPermission';

export const SHELL_COMMAND_MAX_LENGTH = 12_000;

export function countShellCommandCharacters(value: string): number {
  return Array.from(value).length;
}

export const ShellCommandTextSchema = z.string().min(1).refine(
  value => !value.includes('\0'),
  'shell command must not contain NUL',
).refine(
  value => countShellCommandCharacters(value) <= SHELL_COMMAND_MAX_LENGTH,
  `shell command must not exceed ${SHELL_COMMAND_MAX_LENGTH} Unicode characters`,
);

export const ShellWorkingDirectorySchema = z.string().min(1).refine(
  value => value.trim().length > 0 && !value.includes('\0'),
  'shell cwd must not be blank or contain NUL',
);

/**
 * 风险判断、审批卡、审计和最终执行共同引用这一份提案。
 * renderer 的审批回复不会再次携带这些字段，因此不能在批准时替换命令或 cwd。
 */
export const ShellCommandProposalV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('shell_command_proposal'),
  identity: CommandExecutionIdentitySchema,
  command: ShellCommandTextSchema,
  cwd: ShellWorkingDirectorySchema,
  permission: CommandPermissionSnapshotV1Schema,
}).strict().superRefine((proposal, context) => {
  if (!hasSameCommandExecutionIdentity(proposal.identity, proposal.permission.identity)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['permission', 'identity'],
      message: 'permission snapshot must belong to the same command execution',
    });
  }
});
export type ShellCommandProposalV1 = z.infer<typeof ShellCommandProposalV1Schema>;

export function parseShellCommandProposal(value: unknown): ShellCommandProposalV1 {
  return ShellCommandProposalV1Schema.parse(value);
}
