import { z } from 'zod';

import {
  COMMAND_RUNTIME_PROTOCOL_VERSION,
  CommandExecutionIdentitySchema,
} from './commandExecution';
import { CommandLaunchSnapshotV1Schema } from './commandLaunch';
import {
  CommandOutputBytesSchema,
  CommandOutputInterruptionReasonSchema,
  CommandOutputSequenceSchema,
  CommandPipeOutputChannelSchema,
  CommandPtyOutputChannelSchema,
} from './commandOutput';
import {
  CommandExecutionTerminalV1Schema,
  CommandOwnerTerminationCauseSchema,
} from './commandOutcome';
import {
  ProcessInteractionActionV1Schema,
  ProcessInteractionRejectionCodeSchema,
} from './processControl';

export const CommandRunnerInteractionIdSchema = z.number().int().nonnegative().safe()
  .brand<'CommandRunnerInteractionId'>();
export type CommandRunnerInteractionId = z.infer<
  typeof CommandRunnerInteractionIdSchema
>;

const CommandRunnerInternalEnvironmentNameSchema = z.string()
  .regex(/^LINNYA_INTERNAL_[A-Z0-9_]+$/)
  .max(128);

/**
 * 只在 Main -> 一次性 runner wire 中传递的宿主私有环境。
 *
 * 它刻意不属于 CommandLaunchSnapshot：Host 不把这些短期凭证写入用户环境快照、审批、
 * 审计或 Renderer。子 Shell 本身仍能读取自己的真实进程环境；安全边界依赖短生命周期和窄能力。
 * 固定前缀也防止 adapter 借这个口覆盖 PATH、HOME 或用户变量。
 */
export const CommandRunnerInternalEnvironmentV1Schema = z.record(
  CommandRunnerInternalEnvironmentNameSchema,
  z.string().max(8_192).refine(value => !value.includes('\0'), 'value must not contain NUL'),
).superRefine((environment, context) => {
  if (Object.keys(environment).length > 16) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'command runner internal environment exceeds the entry limit',
    });
  }
});
export type CommandRunnerInternalEnvironmentV1 = z.infer<
  typeof CommandRunnerInternalEnvironmentV1Schema
>;

const CommandRunnerStartRequestV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_runner_start'),
  launch: CommandLaunchSnapshotV1Schema,
  internal_environment: CommandRunnerInternalEnvironmentV1Schema.optional(),
}).strict();

const CommandRunnerStopRequestV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_runner_stop'),
  identity: CommandExecutionIdentitySchema,
  cause: CommandOwnerTerminationCauseSchema,
}).strict();

const CommandRunnerInteractionRequestV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_runner_interaction'),
  identity: CommandExecutionIdentitySchema,
  interaction_id: CommandRunnerInteractionIdSchema,
  action: ProcessInteractionActionV1Schema,
}).strict();

export const CommandRunnerRequestV1Schema = z.discriminatedUnion('kind', [
  CommandRunnerStartRequestV1Schema,
  CommandRunnerStopRequestV1Schema,
  CommandRunnerInteractionRequestV1Schema,
]);
export type CommandRunnerRequestV1 = z.infer<typeof CommandRunnerRequestV1Schema>;

const CommandRunnerStartedEventV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_runner_started'),
  identity: CommandExecutionIdentitySchema,
  started_at_ms: z.number().int().nonnegative().safe(),
}).strict();

const CommandRunnerOutputEventV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_runner_output'),
  identity: CommandExecutionIdentitySchema,
  channel: CommandPipeOutputChannelSchema,
  sequence: CommandOutputSequenceSchema,
  bytes: CommandOutputBytesSchema,
}).strict();

/** 旧 pipe frame 保持原样；PTY 使用独立 kind，不能把 terminal 混进 stdout/stderr。 */
const CommandRunnerPtyOutputEventV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_runner_pty_output'),
  identity: CommandExecutionIdentitySchema,
  channel: CommandPtyOutputChannelSchema,
  sequence: CommandOutputSequenceSchema,
  bytes: CommandOutputBytesSchema,
}).strict();

const CommandRunnerOutputStreamCompleteV1Schema = z.object({
  source_completion: z.literal('complete'),
  next_sequence: CommandOutputSequenceSchema,
  observed_bytes: z.number().int().nonnegative().safe(),
}).strict();

const CommandRunnerOutputStreamInterruptedV1Schema = z.object({
  source_completion: z.literal('interrupted'),
  next_sequence: CommandOutputSequenceSchema,
  observed_bytes: z.number().int().nonnegative().safe(),
  interruption_reason: CommandOutputInterruptionReasonSchema,
}).strict();

export const CommandRunnerOutputStreamSettlementV1Schema = z.discriminatedUnion(
  'source_completion',
  [
    CommandRunnerOutputStreamCompleteV1Schema,
    CommandRunnerOutputStreamInterruptedV1Schema,
  ],
);
export type CommandRunnerOutputStreamSettlementV1 = z.infer<
  typeof CommandRunnerOutputStreamSettlementV1Schema
>;

export const CommandRunnerPipeOutputSettlementV1Schema = z.object({
  mode: z.literal('pipe'),
  stdout: CommandRunnerOutputStreamSettlementV1Schema,
  stderr: CommandRunnerOutputStreamSettlementV1Schema,
}).strict();
export type CommandRunnerPipeOutputSettlementV1 = z.infer<
  typeof CommandRunnerPipeOutputSettlementV1Schema
>;

export const CommandRunnerPtyOutputSettlementV1Schema = z.object({
  mode: z.literal('pty'),
  terminal: CommandRunnerOutputStreamSettlementV1Schema,
}).strict();
export type CommandRunnerPtyOutputSettlementV1 = z.infer<
  typeof CommandRunnerPtyOutputSettlementV1Schema
>;

export const CommandRunnerOutputSettlementV1Schema = z.discriminatedUnion('mode', [
  CommandRunnerPipeOutputSettlementV1Schema,
  CommandRunnerPtyOutputSettlementV1Schema,
]);
export type CommandRunnerOutputSettlementV1 = z.infer<
  typeof CommandRunnerOutputSettlementV1Schema
>;

const CommandRunnerInteractionAcceptedV1Schema = z.object({
  status: z.literal('accepted'),
}).strict();

const CommandRunnerInteractionRejectedV1Schema = z.object({
  status: z.literal('rejected'),
  code: ProcessInteractionRejectionCodeSchema,
}).strict();

export const CommandRunnerInteractionResultV1Schema = z.discriminatedUnion('status', [
  CommandRunnerInteractionAcceptedV1Schema,
  CommandRunnerInteractionRejectedV1Schema,
]);
export type CommandRunnerInteractionResultV1 = z.infer<
  typeof CommandRunnerInteractionResultV1Schema
>;

const CommandRunnerInteractionResultEventV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_runner_interaction_result'),
  identity: CommandExecutionIdentitySchema,
  interaction_id: CommandRunnerInteractionIdSchema,
  result: CommandRunnerInteractionResultV1Schema,
}).strict();

const CommandRunnerTerminalEventV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_runner_terminal'),
  terminal: CommandExecutionTerminalV1Schema,
  output_sources: CommandRunnerOutputSettlementV1Schema.optional(),
}).strict();

/** disposable runner 一次只服务一条 execution；所有事件必须回显 host 冻结的完整 identity。 */
export const CommandRunnerEventV1Schema = z.discriminatedUnion('kind', [
  CommandRunnerStartedEventV1Schema,
  CommandRunnerOutputEventV1Schema,
  CommandRunnerPtyOutputEventV1Schema,
  CommandRunnerInteractionResultEventV1Schema,
  CommandRunnerTerminalEventV1Schema,
]).superRefine((event, context) => {
  if (event.kind !== 'command_runner_terminal') return;
  // process_exit 表达“能否观察根进程终态”，output_drain 才表达 pipe observer
  // 是否真正开始。启动回滚可能已经创建进程、却尚未把输出源交给 runner；两者不能混用。
  if (event.terminal.output_drain.status === 'not_started') {
    if (event.output_sources) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['output_sources'],
        message: 'a runner terminal without output observation cannot report output sources',
      });
    }
    return;
  }
  if (!event.output_sources) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['output_sources'],
      message: 'a started runner terminal must report both output sources',
    });
    return;
  }
  const sources = event.output_sources.mode === 'pipe'
    ? [event.output_sources.stdout, event.output_sources.stderr]
    : [event.output_sources.terminal];
  const allComplete = sources.every(source => source.source_completion === 'complete');
  if (event.terminal.output_drain.status === 'complete' && !allComplete) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['terminal', 'output_drain'],
      message: event.output_sources.mode === 'pipe'
        ? 'complete output drain requires both runner output sources to be complete'
        : 'complete output drain requires the terminal output source to be complete',
    });
  }
  if (event.terminal.output_drain.status === 'failed') {
    const failureReason = event.terminal.output_drain.reason;
    if (allComplete) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['output_sources'],
        message: 'failed output drain requires at least one interrupted runner output source',
      });
    }
    if (!sources.some(source => (
      source.source_completion === 'interrupted'
      && source.interruption_reason === failureReason
    ))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terminal', 'output_drain', 'reason'],
        message: 'output drain failure reason must match an interrupted runner output source',
      });
    }
  }
});
export type CommandRunnerEventV1 = z.infer<typeof CommandRunnerEventV1Schema>;

export function parseCommandRunnerRequest(value: unknown): CommandRunnerRequestV1 {
  return CommandRunnerRequestV1Schema.parse(value);
}

export function parseCommandRunnerEvent(value: unknown): CommandRunnerEventV1 {
  return CommandRunnerEventV1Schema.parse(value);
}
