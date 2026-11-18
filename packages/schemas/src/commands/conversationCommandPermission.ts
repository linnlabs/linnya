import { z } from 'zod';

import {
  CommandBasePermissionSourceSchema,
  CommandPermissionLevelSchema,
  type CommandPermissionLevel,
} from './commandPermission';

const revision = z.number().int().nonnegative().safe();
const id = z.string().min(1);
const selection = CommandPermissionLevelSchema.nullable();

export const ConversationCommandPermissionSelectionSchema = z.object({
  permission_level: selection,
  revision,
}).strict();
export type ConversationCommandPermissionSelection = z.infer<typeof ConversationCommandPermissionSelectionSchema>;

export function resolveConversationCommandPermission(
  globalLevel: CommandPermissionLevel,
  override: CommandPermissionLevel | null,
) {
  return {
    permission_level: override ?? globalLevel,
    source: override === null ? 'global_setting' : 'conversation_setting',
  } as const;
}

export function compareCommandPermissionLevels(
  left: CommandPermissionLevel,
  right: CommandPermissionLevel,
): number {
  const levels = CommandPermissionLevelSchema.options;
  return levels.indexOf(left) - levels.indexOf(right);
}

export const ConversationCommandPermissionChangeSchema = z.object({
  revision,
  changed_at_ms: revision,
  origin: z.enum(['desktop', 'global_reduction', 'host_initialization']),
  previous_selection: selection,
  next_selection: selection,
  previous_level: CommandPermissionLevelSchema,
  next_level: CommandPermissionLevelSchema,
}).strict();
export type ConversationCommandPermissionChange = z.infer<typeof ConversationCommandPermissionChangeSchema>;

export const ConversationRunCommandPermissionSchema = z.object({
  run_id: id,
  captured_at_ms: revision,
  permission_level: selection,
  source: CommandBasePermissionSourceSchema.nullable(),
}).strict();
export type ConversationRunCommandPermission = z.infer<typeof ConversationRunCommandPermissionSchema>;

const target = z.object({ conversation_id: id, project_id: id.nullable() }).strict();

export const ConversationCommandPermissionViewSchema = z.object({
  selection: ConversationCommandPermissionSelectionSchema,
  permission_level: CommandPermissionLevelSchema,
  source: CommandBasePermissionSourceSchema,
  global_level: CommandPermissionLevelSchema,
  global_revision: revision,
  changes: z.array(ConversationCommandPermissionChangeSchema),
  latest_run: ConversationRunCommandPermissionSchema.nullable(),
}).strict();

export const CommandPermissionReductionPreviewSchema = z.object({
  global_revision: revision,
  target_level: CommandPermissionLevelSchema,
  affected_count: revision,
  fence: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type CommandPermissionReductionPreview = z.infer<typeof CommandPermissionReductionPreviewSchema>;

export const ConversationCommandPermissionRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('read'), target: target.nullable() }).strict(),
  z.object({
    kind: z.literal('set'),
    target,
    expected_revision: revision,
    expected_global_revision: revision,
    permission_level: selection,
    create: z.boolean(),
  }).strict(),
  z.object({
    kind: z.literal('preview_reduction'),
    permission_level: CommandPermissionLevelSchema,
  }).strict(),
  z.object({
    kind: z.literal('reduce'),
    preview: CommandPermissionReductionPreviewSchema,
    include_conversations: z.boolean(),
  }).strict(),
]);
export type ConversationCommandPermissionRequest = z.infer<typeof ConversationCommandPermissionRequestSchema>;

export const ConversationCommandPermissionResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('view'), view: ConversationCommandPermissionViewSchema }).strict(),
  z.object({ kind: z.literal('preview'), preview: CommandPermissionReductionPreviewSchema }).strict(),
  z.object({ kind: z.literal('reduced'), changed_count: revision }).strict(),
  z.object({ kind: z.literal('partial'), changed_count: revision }).strict(),
  z.object({
    kind: z.literal('error'),
    code: z.enum(['conflict', 'not_found', 'unavailable']),
  }).strict(),
]);
export type ConversationCommandPermissionResult = z.infer<typeof ConversationCommandPermissionResultSchema>;
export type ConversationCommandPermissionView = z.infer<typeof ConversationCommandPermissionViewSchema>;

export const CONVERSATION_COMMAND_PERMISSION_CHANNEL = 'command-permission-settings:conversation';
export const CONVERSATION_COMMAND_PERMISSION_CHANGED_CHANNEL = 'command-permission-settings:conversation-changed';
