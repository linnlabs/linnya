import { z } from 'zod';

import {
  COMMAND_RUNTIME_PROTOCOL_VERSION,
  CommandExecutionIdentitySchema,
} from './commandExecution';
import { CommandOutputInterruptionReasonSchema } from './commandOutput';

/**
 * 这里只保留跨平台稳定分类。原始 errno、HRESULT、stack 和 helper 文案只进入内部诊断，
 * 否则 UI、Agent 和持久记录会被某个平台或某个依赖的错误字符串绑死。
 */
export const CommandRuntimeFailureCodeSchema = z.enum([
  'environment_unavailable',
  'sandbox_denied',
  'sandbox_unavailable',
  'process_owner_unavailable',
  'runtime_unavailable',
  'launch_payload_too_large',
  'launch_failed',
  'runtime_lost',
  'internal_failure',
]);
export type CommandRuntimeFailureCode = z.infer<
  typeof CommandRuntimeFailureCodeSchema
>;

export const CommandRuntimeFailureSchema = z.object({
  code: CommandRuntimeFailureCodeSchema,
}).strict();
export type CommandRuntimeFailure = z.infer<typeof CommandRuntimeFailureSchema>;

/** 这些失败发生在业务 child 成功启动前，不能附带伪造的 exit/drain 事实。 */
const PRE_LAUNCH_RUNTIME_FAILURE_CODES: ReadonlySet<CommandRuntimeFailureCode> = new Set([
  'environment_unavailable',
  'sandbox_denied',
  'sandbox_unavailable',
  'runtime_unavailable',
  'launch_payload_too_large',
  'launch_failed',
]);

const ProcessExitNotStartedSchema = z.object({
  status: z.literal('not_started'),
}).strict();

const ProcessExitObservedSchema = z.object({
  status: z.literal('observed'),
  exit_code: z.number().int().safe().nullable(),
  signal: z.string().min(1).max(128).nullable(),
}).strict().superRefine((exit, context) => {
  if (exit.exit_code === null && exit.signal === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'observed process exit must include an exit code or signal',
    });
  }
});

const ProcessExitUnavailableSchema = z.object({
  status: z.literal('unavailable'),
  reason: z.enum(['runtime_lost', 'platform_not_reported']),
}).strict();

/** raw exit 事实不根据 124/130 等数字反推 timeout 或 cancel。 */
export const CommandProcessExitSchema = z.union([
  ProcessExitNotStartedSchema,
  ProcessExitObservedSchema,
  ProcessExitUnavailableSchema,
]);
export type CommandProcessExit = z.infer<typeof CommandProcessExitSchema>;

export const CommandOutputDrainResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not_started') }).strict(),
  z.object({ status: z.literal('complete') }).strict(),
  z.object({
    status: z.literal('failed'),
    code: z.literal('output_drain_failed'),
    reason: CommandOutputInterruptionReasonSchema,
  }).strict(),
]);
export type CommandOutputDrainResult = z.infer<typeof CommandOutputDrainResultSchema>;

export const CommandTreeCleanupResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not_required') }).strict(),
  z.object({ status: z.literal('succeeded') }).strict(),
  z.object({
    status: z.literal('failed'),
    code: z.literal('tree_cleanup_failed'),
  }).strict(),
]);
export type CommandTreeCleanupResult = z.infer<typeof CommandTreeCleanupResultSchema>;

export const CommandResourceReleaseResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not_required') }).strict(),
  z.object({ status: z.literal('succeeded') }).strict(),
  z.object({
    status: z.literal('failed'),
    code: z.literal('resource_release_failed'),
  }).strict(),
]);
export type CommandResourceReleaseResult = z.infer<
  typeof CommandResourceReleaseResultSchema
>;

export const CommandOwnerTerminationCauseSchema = z.enum([
  'user_cancelled',
  'hard_timeout',
  'owner_ended',
]);
export type CommandOwnerTerminationCause = z.infer<
  typeof CommandOwnerTerminationCauseSchema
>;

export const CommandTerminationCauseSchema = z.union([
  z.literal('natural_exit'),
  CommandOwnerTerminationCauseSchema,
]);
export type CommandTerminationCause = z.infer<typeof CommandTerminationCauseSchema>;

const CommandExecutionTerminalBaseSchema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_execution_terminal'),
  identity: CommandExecutionIdentitySchema,
  settled_at_ms: z.number().int().nonnegative().safe(),
  process_exit: CommandProcessExitSchema,
  output_drain: CommandOutputDrainResultSchema,
  tree_cleanup: CommandTreeCleanupResultSchema,
  resource_release: CommandResourceReleaseResultSchema,
});

/** execution_ended 是中性完成词，既包含自然 exit，也包含 owner 主动结束。 */
const TerminatedCommandExecutionSchema = CommandExecutionTerminalBaseSchema.extend({
  outcome: z.literal('execution_ended'),
  termination_cause: CommandTerminationCauseSchema,
}).strict();

const FailedCommandExecutionSchema = CommandExecutionTerminalBaseSchema.extend({
  outcome: z.literal('runtime_failure'),
  failure: CommandRuntimeFailureSchema,
}).strict();

/**
 * 主终态与收尾结果故意分开：例如 hard timeout 已经获胜后，即使收树失败，
 * 仍保留 hard_timeout，同时明确 tree_cleanup_failed，不能改写成模糊 failed。
 */
export const CommandExecutionTerminalV1Schema = z.discriminatedUnion('outcome', [
  TerminatedCommandExecutionSchema,
  FailedCommandExecutionSchema,
]).superRefine((terminal, context) => {
  if (
    terminal.outcome === 'execution_ended'
    && terminal.termination_cause === 'natural_exit'
    && terminal.process_exit.status !== 'observed'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['process_exit'],
      message: 'natural exit requires an observed process exit fact',
    });
  }
  if (
    terminal.outcome === 'execution_ended'
    && terminal.termination_cause === 'natural_exit'
    && terminal.output_drain.status === 'not_started'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['output_drain'],
      message: 'natural exit requires output drain completion or an explicit drain failure',
    });
  }
  if (
    terminal.process_exit.status === 'not_started'
    && terminal.output_drain.status !== 'not_started'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['output_drain'],
      message: 'a command without a process cannot report output drain completion',
    });
  }
  if (
    terminal.process_exit.status === 'not_started'
    && terminal.tree_cleanup.status !== 'not_required'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tree_cleanup'],
      message: 'a command without a process cannot report process tree cleanup',
    });
  }
  if (
    terminal.process_exit.status === 'not_started'
    && terminal.resource_release.status !== 'not_required'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resource_release'],
      message: 'a command without a process cannot report runtime resource release',
    });
  }
  if (terminal.outcome === 'runtime_failure') {
    if (
      PRE_LAUNCH_RUNTIME_FAILURE_CODES.has(terminal.failure.code)
      && terminal.process_exit.status !== 'not_started'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['process_exit'],
        message: 'a pre-launch runtime failure cannot report a started process',
      });
    }
    if (
      terminal.failure.code === 'runtime_lost'
      && terminal.process_exit.status === 'not_started'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['process_exit'],
        message: 'runtime loss cannot claim that no process was started',
      });
    }
  }
});
export type CommandExecutionTerminalV1 = z.infer<
  typeof CommandExecutionTerminalV1Schema
>;

export function parseCommandExecutionTerminal(value: unknown): CommandExecutionTerminalV1 {
  return CommandExecutionTerminalV1Schema.parse(value);
}
