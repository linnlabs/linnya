import { z } from 'zod';
import {
  CommandExecutionIdentitySchema,
  CommandOutputSourceCompletionSchema,
  type CommandExecutionIdentity,
  type CommandExecutionMode,
  type CommandOutputSequence,
  type CommandOutputSourceCompletion,
} from '@app/schemas/commands';

export {
  CommandOutputBytesSchema,
  CommandOutputSequenceSchema,
  CommandOutputSourceCompletionSchema,
  MAX_COMMAND_OUTPUT_EVENT_BYTES,
} from '@app/schemas/commands';

export const CommandArtifactInstanceIdSchema = z.string()
  .min(1)
  .refine(
    value => value === value.trim(),
    'command artifact instance identity must not contain surrounding whitespace',
  )
  .brand<'CommandArtifactInstanceId'>();
export type CommandArtifactInstanceId = z.infer<typeof CommandArtifactInstanceIdSchema>;

export const CommandOutputArtifactOwnerSchema = z.object({
  identity: CommandExecutionIdentitySchema,
  instance_id: CommandArtifactInstanceIdSchema,
}).strict();
export type CommandOutputArtifactOwner = z.infer<typeof CommandOutputArtifactOwnerSchema>;

export const CommandOutputArtifactFailureCodeSchema = z.enum([
  'storage_full',
  'quota_exceeded',
  'permission_denied',
  'path_unavailable',
  'io_failure',
  'sink_overloaded',
]);
export type CommandOutputArtifactFailureCode = z.infer<
  typeof CommandOutputArtifactFailureCodeSchema
>;

export const CommandOutputArtifactFailureSchema = z.object({
  code: CommandOutputArtifactFailureCodeSchema,
  stage: z.enum(['open', 'append', 'finalize', 'discard']),
  occurred_at_ms: z.number().int().nonnegative().safe(),
  last_persisted_offset: z.number().int().nonnegative().safe(),
}).strict();
export type CommandOutputArtifactFailure = z.infer<
  typeof CommandOutputArtifactFailureSchema
>;

const ByteCountSchema = z.number().int().nonnegative().safe();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const CompleteCommandOutputStreamSchema = z.object({
  status: z.literal('complete'),
  source_completion: z.literal('complete'),
  observed_bytes: ByteCountSchema,
  persisted_bytes: ByteCountSchema,
  last_persisted_offset: ByteCountSchema,
  sha256: Sha256Schema,
}).strict();

const StorageIncompleteCommandOutputStreamSchema = z.object({
  status: z.literal('incomplete'),
  source_completion: CommandOutputSourceCompletionSchema,
  observed_bytes: ByteCountSchema,
  persisted_bytes: ByteCountSchema,
  last_persisted_offset: ByteCountSchema,
  first_error: CommandOutputArtifactFailureSchema,
}).strict();

const SourceIncompleteCommandOutputStreamSchema = z.object({
  status: z.literal('incomplete'),
  source_completion: z.literal('interrupted'),
  observed_bytes: ByteCountSchema,
  persisted_bytes: ByteCountSchema,
  last_persisted_offset: ByteCountSchema,
  /** 来源虽不完整，但已经收到的 byte 仍可能全部可靠落盘。 */
  sha256: Sha256Schema,
}).strict();

export const CommandOutputStreamSummarySchema = z.union([
  CompleteCommandOutputStreamSchema,
  StorageIncompleteCommandOutputStreamSchema,
  SourceIncompleteCommandOutputStreamSchema,
]).superRefine((summary, context) => {
  if (summary.persisted_bytes > summary.observed_bytes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['persisted_bytes'],
      message: 'persisted command output bytes cannot exceed observed bytes',
    });
  }
  if (summary.last_persisted_offset !== summary.persisted_bytes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['last_persisted_offset'],
      message: 'command output is append-only, so the persisted offset must equal persisted bytes',
    });
  }
  if (summary.status === 'complete' && summary.persisted_bytes !== summary.observed_bytes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: 'complete command output must persist every observed byte',
    });
  }
  if (
    summary.status === 'incomplete'
    && 'sha256' in summary
    && summary.persisted_bytes !== summary.observed_bytes
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['persisted_bytes'],
      message: 'source-interrupted output must persist every observed byte or record a storage error',
    });
  }
  if (
    summary.status === 'incomplete'
    && 'first_error' in summary
    && summary.first_error.last_persisted_offset !== summary.last_persisted_offset
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['first_error', 'last_persisted_offset'],
      message: 'the first artifact error must retain the last successful byte offset',
    });
  }
});
export type CommandOutputStreamSummary = z.infer<
  typeof CommandOutputStreamSummarySchema
>;

const CommandOutputArtifactManifestBaseSchema = z.object({
  version: z.literal(1),
  owner: CommandOutputArtifactOwnerSchema,
  sealed_at_ms: z.number().int().nonnegative().safe(),
  retention_until_ms: z.number().int().positive().safe(),
});

const PipeCommandOutputArtifactManifestSchema = CommandOutputArtifactManifestBaseSchema.extend({
  mode: z.literal('pipe'),
  stdout: CommandOutputStreamSummarySchema,
  stderr: CommandOutputStreamSummarySchema,
}).strict();

const PtyCommandOutputArtifactManifestSchema = CommandOutputArtifactManifestBaseSchema.extend({
  mode: z.literal('pty'),
  terminal: CommandOutputStreamSummarySchema,
}).strict();

/**
 * 普通 pipe 与 PTY 的原始 byte 形状互斥。PTY 已在终端层合流，不能伪造 stdout/stderr。
 */
export const CommandOutputArtifactManifestSchema = z.union([
  PipeCommandOutputArtifactManifestSchema,
  PtyCommandOutputArtifactManifestSchema,
]).superRefine((manifest, context) => {
  if (manifest.retention_until_ms <= manifest.sealed_at_ms) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['retention_until_ms'],
      message: 'command output retention must end after the artifact is sealed',
    });
  }
});
export type CommandOutputArtifactManifest = z.infer<
  typeof CommandOutputArtifactManifestSchema
>;

export interface PipeCommandOutputArtifactChunk {
  readonly mode: 'pipe';
  readonly channel: 'stdout' | 'stderr';
  readonly sequence: CommandOutputSequence;
  readonly bytes: Uint8Array;
}

export interface PtyCommandOutputArtifactChunk {
  readonly mode: 'pty';
  readonly channel: 'terminal';
  readonly sequence: CommandOutputSequence;
  readonly bytes: Uint8Array;
}

export type CommandOutputArtifactChunk =
  | PipeCommandOutputArtifactChunk
  | PtyCommandOutputArtifactChunk;

export interface CommandOutputArtifactOpenRequest {
  readonly owner: CommandOutputArtifactOwner;
  readonly mode: CommandExecutionMode;
}

interface CommandOutputArtifactFinalizeRequestBase {
  readonly sealedAtMs: number;
  readonly retentionUntilMs: number;
}

export type CommandOutputArtifactFinalizeRequest =
  | CommandOutputArtifactFinalizeRequestBase & {
      readonly source: {
        readonly mode: 'pipe';
        readonly stdout: CommandOutputSourceCompletion;
        readonly stderr: CommandOutputSourceCompletion;
      };
    }
  | CommandOutputArtifactFinalizeRequestBase & {
      readonly source: {
        readonly mode: 'pty';
        readonly terminal: CommandOutputSourceCompletion;
      };
    };

export type CommandOutputArtifactAppendResult =
  | { readonly status: 'accepted' }
  | {
      readonly status: 'disabled';
      /** 即时结果只暴露稳定原因；最终 byte offset 由 finalize 后的 manifest 给出。 */
      readonly firstFailureCode: CommandOutputArtifactFailureCode;
    };

export type CommandOutputArtifactDiscardResult =
  | { readonly status: 'discarded' }
  | {
      readonly status: 'discard_failed';
      readonly failure: CommandOutputArtifactFailure;
    };

export type CommandOutputArtifactFinalizationResult =
  | {
      readonly status: 'manifest_persisted';
      readonly manifest: CommandOutputArtifactManifest;
    }
  | {
      readonly status: 'manifest_unavailable';
      /** 内存事实仍用于命令卡片标记不完整，不能把它冒充已落盘 manifest。 */
      readonly manifest: CommandOutputArtifactManifest;
      readonly failure: CommandOutputArtifactFailure;
    };

export function parseCommandOutputArtifactManifest(
  value: unknown,
): CommandOutputArtifactManifest {
  return CommandOutputArtifactManifestSchema.parse(value);
}

export type {
  CommandExecutionIdentity,
  CommandExecutionMode,
  CommandOutputSequence,
  CommandOutputSourceCompletion,
};
