import { z } from 'zod';

import { CommandExecutionIdentitySchema, hasSameCommandExecutionIdentity } from './commandExecution';
import { CommandPermissionSnapshotV1Schema } from './commandPermission';
import { ShellWorkingDirectorySchema } from './shellCommandProposal';

/** 文件工具共享审批交互，但保留真实文件操作身份，不能伪造成一条待执行的 Shell。 */
export const InternalFileReadProposalV1Schema = z.object({
  protocol_version: z.literal(1),
  kind: z.literal('internal_file_read_proposal'),
  identity: CommandExecutionIdentitySchema,
  file_path: ShellWorkingDirectorySchema,
  cwd: ShellWorkingDirectorySchema,
  permission: CommandPermissionSnapshotV1Schema,
  requests_internal_storage_access: z.literal(true),
}).strict().superRefine((proposal, context) => {
  if (!hasSameCommandExecutionIdentity(proposal.identity, proposal.permission.identity)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['permission', 'identity'],
      message: 'file access permission must belong to the same operation',
    });
  }
});

export type InternalFileReadProposalV1 = z.infer<typeof InternalFileReadProposalV1Schema>;
