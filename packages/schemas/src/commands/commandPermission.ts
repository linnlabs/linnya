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
}).strict().superRefine((snapshot, context) => {
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
      snapshot.effective_level === 'standard'
      && (snapshot.base_level === 'read_only' || snapshot.base_level === 'standard')
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effective_level'],
      message: 'an approval can only grant the standard permission level',
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
