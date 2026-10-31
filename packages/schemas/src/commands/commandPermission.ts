import { z } from 'zod';

import {
  COMMAND_RUNTIME_PROTOCOL_VERSION,
  CommandExecutionIdentitySchema,
} from './commandExecution';

export const CommandPermissionLevelSchema = z.enum([
  'read_only',
  'standard',
  'full_access',
]);
export type CommandPermissionLevel = z.infer<typeof CommandPermissionLevelSchema>;

export const CommandPermissionGrantSourceSchema = z.enum([
  'global_setting',
  'allow_once',
  'conversation_approval',
]);
export type CommandPermissionGrantSource = z.infer<
  typeof CommandPermissionGrantSourceSchema
>;

export const CommandInternalDataAccessSchema = z.enum(['allowed', 'denied']);
export type CommandInternalDataAccess = z.infer<
  typeof CommandInternalDataAccessSchema
>;

export const CommandPermissionSnapshotV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_permission_snapshot'),
  identity: CommandExecutionIdentitySchema,
  base_level: CommandPermissionLevelSchema,
  effective_level: CommandPermissionLevelSchema,
  grant_source: CommandPermissionGrantSourceSchema,
  internal_data_access: CommandInternalDataAccessSchema,
  /** 仅本次操作的原始存储授权；缺省表示未授权，与插件的内部数据开关无关。 */
  internal_storage_access: z.boolean().optional(),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.internal_storage_access && snapshot.grant_source === 'global_setting'
    && snapshot.base_level !== 'full_access') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['internal_storage_access'],
      message: 'internal storage access requires an explicit approval or full access',
    });
  }
  if (
    snapshot.grant_source === 'global_setting'
    && snapshot.base_level !== snapshot.effective_level
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effective_level'],
      message: 'a global permission snapshot cannot change the selected level',
    });
  }

  if (
    snapshot.grant_source !== 'global_setting'
    && !(
      (snapshot.effective_level === 'standard'
        || (snapshot.base_level === 'read_only'
          && snapshot.effective_level === 'read_only'
          && snapshot.internal_storage_access === true))
      && (snapshot.base_level === 'read_only' || snapshot.base_level === 'standard')
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effective_level'],
      message: 'an approval may grant standard access or keep read-only for internal storage access',
    });
  }
});
export type CommandPermissionSnapshotV1 = z.infer<
  typeof CommandPermissionSnapshotV1Schema
>;

export function parseCommandPermissionSnapshot(
  value: unknown,
): CommandPermissionSnapshotV1 {
  return CommandPermissionSnapshotV1Schema.parse(value);
}
