import { z } from 'zod';

import {
  COMMAND_RUNTIME_PROTOCOL_VERSION,
  hasSameCommandExecutionIdentity,
} from './commandExecution';
import { CommandOutputTextEncodingSchema } from './commandOutput';
import { CommandPermissionSnapshotV1Schema } from './commandPermission';
import {
  ShellCommandProposalV1Schema,
  ShellWorkingDirectorySchema,
} from './shellCommandProposal';
import { ProcessPtySizeV1Schema } from './processControl';

const NonEmptyLaunchStringSchema = z.string().min(1).refine(
  value => !value.includes('\0'),
  'command launch strings must not contain NUL',
);

export const CommandRuntimePlatformSchema = z.enum(['macos', 'windows']);
export type CommandRuntimePlatform = z.infer<typeof CommandRuntimePlatformSchema>;

export const CommandInvocationProfileIdSchema = z.enum([
  'plain-v1',
  'powershell-utf8-v1',
]);
export type CommandInvocationProfileId = z.infer<
  typeof CommandInvocationProfileIdSchema
>;

export const CommandResolvedShellV1Schema = z.object({
  platform: CommandRuntimePlatformSchema,
  shell_semantics_id: z.string().min(1).max(128),
  shell_version: NonEmptyLaunchStringSchema,
  snapshot_revision: NonEmptyLaunchStringSchema,
  output_text_encoding: CommandOutputTextEncodingSchema,
  command_invocation_profile_id: CommandInvocationProfileIdSchema,
  executable_path: NonEmptyLaunchStringSchema,
  argv_prefix: z.array(z.string().refine(
    value => !value.includes('\0'),
    'command launch arguments must not contain NUL',
  )).min(1),
}).strict().superRefine((shell, context) => {
  const supported = shell.platform === 'macos'
    ? shell.shell_semantics_id === 'zsh'
    : shell.shell_semantics_id === 'powershell-5.1'
      || shell.shell_semantics_id === 'powershell-7';
  if (!supported) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['shell_semantics_id'],
      message: 'resolved Shell semantics must match the frozen platform',
    });
  }
  const supportedProfile = shell.platform === 'macos'
    ? shell.command_invocation_profile_id === 'plain-v1'
    : shell.command_invocation_profile_id === 'powershell-utf8-v1';
  if (!supportedProfile) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['command_invocation_profile_id'],
      message: 'command invocation profile must match the frozen platform',
    });
  }
  if (
    shell.command_invocation_profile_id === 'powershell-utf8-v1'
    && shell.output_text_encoding !== 'utf-8'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['output_text_encoding'],
      message: 'PowerShell UTF-8 invocation profile requires UTF-8 output decoding',
    });
  }
});
export type CommandResolvedShellV1 = z.infer<typeof CommandResolvedShellV1Schema>;

/**
 * runner 必须拿到本次启动的完整环境，但 revision 仍用于诊断来源和防止把裸 map
 * 当成可随时读取的 process.env。环境正文不得进入普通日志或 Agent observation。
 */
export const CommandLaunchEnvironmentV1Schema = z.object({
  revision: NonEmptyLaunchStringSchema,
  entries: z.record(z.string().refine(
    value => !value.includes('\0'),
    'command environment values must not contain NUL',
  )).superRefine((entries, context) => {
    for (const key of Object.keys(entries)) {
      if (key.length === 0 || key.includes('=') || key.includes('\0')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'command environment keys must be non-empty and exclude equals or NUL',
        });
      }
    }
  }),
}).strict();
export type CommandLaunchEnvironmentV1 = z.infer<
  typeof CommandLaunchEnvironmentV1Schema
>;

const CommandLaunchSnapshotBaseV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  proposal: ShellCommandProposalV1Schema,
  conversation_root: ShellWorkingDirectorySchema,
  permission: CommandPermissionSnapshotV1Schema,
  shell: CommandResolvedShellV1Schema,
  environment: CommandLaunchEnvironmentV1Schema,
  lifecycle_policy: z.literal('terminate_with_run'),
  hard_timeout_ms: z.number().int().positive().safe(),
});

type CommandLaunchSnapshotBaseV1 = z.infer<typeof CommandLaunchSnapshotBaseV1Schema>;

function validateCommandLaunchSnapshot(
  snapshot: CommandLaunchSnapshotBaseV1,
  context: z.RefinementCtx,
): void {
  if (snapshot.shell.snapshot_revision !== snapshot.environment.revision) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['environment', 'revision'],
      message: 'Shell and environment must come from the same runtime snapshot',
    });
  }
  if (snapshot.shell.platform === 'windows') {
    const normalizedKeys = new Set<string>();
    for (const key of Object.keys(snapshot.environment.entries)) {
      const normalized = key.toLowerCase();
      if (normalizedKeys.has(normalized)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['environment', 'entries', key],
          message: 'Windows command environment keys must be unique ignoring case',
        });
        break;
      }
      normalizedKeys.add(normalized);
    }
  }
  if (!hasSameCommandExecutionIdentity(
    snapshot.proposal.identity,
    snapshot.permission.identity,
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['permission', 'identity'],
      message: 'launch permission must belong to the same command execution',
    });
  }
  if (snapshot.permission.base_level !== snapshot.proposal.permission.base_level) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['permission', 'base_level'],
      message: 'authorization must not replace the selected permission level',
    });
  }
  if (
    snapshot.permission.internal_data_access
      !== snapshot.proposal.permission.internal_data_access
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['permission', 'internal_data_access'],
      message: 'authorization must not replace the internal-data setting',
    });
  }
}

/**
 * 普通 pipe 与 PTY 共享已经批准的命令、权限和运行环境，但启动能力必须互斥。
 * 这样普通命令不会因为 PTY 接线而意外获得 stdin，也不会伪造 terminal 单流。
 */
const PipeCommandLaunchSnapshotV1ObjectSchema = CommandLaunchSnapshotBaseV1Schema.extend({
  kind: z.literal('pipe_command_launch_snapshot'),
  mode: z.literal('pipe'),
  stdin: z.literal('closed'),
}).strict();
export const PipeCommandLaunchSnapshotV1Schema =
  PipeCommandLaunchSnapshotV1ObjectSchema.superRefine(validateCommandLaunchSnapshot);
export type PipeCommandLaunchSnapshotV1 = z.infer<
  typeof PipeCommandLaunchSnapshotV1Schema
>;

const PtyCommandLaunchSnapshotV1ObjectSchema = CommandLaunchSnapshotBaseV1Schema.extend({
  kind: z.literal('pty_command_launch_snapshot'),
  mode: z.literal('pty'),
  stdin: z.literal('pty'),
  terminal_size: ProcessPtySizeV1Schema,
}).strict();
export const PtyCommandLaunchSnapshotV1Schema =
  PtyCommandLaunchSnapshotV1ObjectSchema.superRefine(validateCommandLaunchSnapshot);
export type PtyCommandLaunchSnapshotV1 = z.infer<
  typeof PtyCommandLaunchSnapshotV1Schema
>;

export const CommandLaunchSnapshotV1Schema = z.discriminatedUnion('kind', [
  PipeCommandLaunchSnapshotV1ObjectSchema,
  PtyCommandLaunchSnapshotV1ObjectSchema,
]).superRefine(validateCommandLaunchSnapshot);
export type CommandLaunchSnapshotV1 = z.infer<typeof CommandLaunchSnapshotV1Schema>;

export function parsePipeCommandLaunchSnapshot(
  value: unknown,
): PipeCommandLaunchSnapshotV1 {
  return PipeCommandLaunchSnapshotV1Schema.parse(value);
}

export function parsePtyCommandLaunchSnapshot(
  value: unknown,
): PtyCommandLaunchSnapshotV1 {
  return PtyCommandLaunchSnapshotV1Schema.parse(value);
}

export function parseCommandLaunchSnapshot(
  value: unknown,
): CommandLaunchSnapshotV1 {
  return CommandLaunchSnapshotV1Schema.parse(value);
}
