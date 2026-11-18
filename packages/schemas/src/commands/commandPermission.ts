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

const baseGrantSources = ['global_setting', 'conversation_setting'] as const;
export const CommandBasePermissionSourceSchema = z.enum(baseGrantSources);
export type CommandBasePermissionSource = z.infer<typeof CommandBasePermissionSourceSchema>;

export const CommandPermissionGrantSourceSchema = z.enum([
  ...baseGrantSources,
  'allow_once',
  'conversation_approval',
]);
export type CommandPermissionGrantSource = z.infer<
  typeof CommandPermissionGrantSourceSchema
>;

export function isCommandBasePermissionSource(
  source: CommandPermissionGrantSource,
): source is CommandBasePermissionSource {
  return source === 'global_setting' || source === 'conversation_setting';
}

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
    isCommandBasePermissionSource(snapshot.grant_source)
    && snapshot.base_level !== snapshot.effective_level
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effective_level'],
      message: 'a base permission snapshot cannot change the selected level',
    });
  }

  if (
    !isCommandBasePermissionSource(snapshot.grant_source)
    && !(
      (snapshot.effective_level === 'standard'
        || (snapshot.base_level === 'read_only'
          && snapshot.effective_level === 'read_only'))
      && (snapshot.base_level === 'read_only' || snapshot.base_level === 'standard')
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effective_level'],
      message: 'an approval may grant standard access or preserve read-only access',
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
