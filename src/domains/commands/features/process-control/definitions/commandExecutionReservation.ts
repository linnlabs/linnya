import type {
  CommandExecutionOwnerBindingV1,
  CommandExecutionTerminalV1,
  CommandOwnerGenerationId,
  CommandOwnerTerminationCause,
} from '@app/schemas/commands';

import type {
  CommandProcessOutputObservationPort,
} from '../../../definitions/processOutputObservation';
import type { CommandSettledTextOutput } from '../../../definitions/commandSettledTextOutput';
import type { ProcessOwnerLifecycle } from './processOwnerState';
import type { CommandExecutionInteractionCapability } from './processInput';

/** Validation 109 在 8 GiB Windows 普通用户环境冻结的 App 活跃命令保护线。 */
export const COMMAND_MAXIMUM_ACTIVE_EXECUTIONS = 4;

export type CommandExecutionActivityState =
  | 'reserved'
  | 'starting'
  | 'running'
  | 'stopping';

export type CommandExecutionReservationRejectionCode =
  | 'owner_ending'
  | 'owner_ended'
  | 'scope_mismatch'
  | 'conversation_stopping'
  | 'duplicate_execution'
  | 'capacity_unavailable';

export type CommandExecutionStartRejectionCode =
  | 'owner_ending'
  | 'owner_ended'
  | 'scope_mismatch'
  | 'conversation_stopping'
  | 'unknown_reservation'
  | 'incompatible_state';

export type CommandExecutionReleaseRejectionCode =
  | 'scope_mismatch'
  | 'unknown_reservation'
  | 'incompatible_state';

export type CommandExecutionReservationResult =
  | {
      readonly status: 'reserved';
      readonly binding: CommandExecutionOwnerBindingV1;
    }
  | {
      readonly status: 'rejected';
      readonly code: CommandExecutionReservationRejectionCode;
    };

export type CommandExecutionReservationReleaseResult =
  | { readonly status: 'released' }
  | {
      readonly status: 'rejected';
      readonly code: CommandExecutionReleaseRejectionCode;
    };

/** 仅用于 runtime 内部收口，不能投影成用户取消、超时或 owner 结束。 */
export type CommandExecutionRuntimeStopCause =
  | CommandOwnerTerminationCause
  | 'runtime_start_failed';

/**
 * 平台 runtime 只向 owner 暴露“自然终态”和“按原因停止后收口”两项能力。
 * PID、Job、进程组、pipe 和 reader 都留在平台实现内部，不能穿过 Commands port。
 * terminal 必须 resolve 可信终态，runtime/helper 丢失应转换为 runtime_lost，不能裸 reject。
 */
export interface CommandExecutionRuntimeControl {
  readonly interaction: CommandExecutionInteractionCapability;
  readonly terminal: Promise<CommandExecutionTerminalV1>;
  stopAndWait(cause: CommandExecutionRuntimeStopCause): Promise<CommandExecutionTerminalV1>;
}

export type CommandExecutionPreparedRuntimeStartResult =
  | {
      readonly status: 'running';
      readonly startedAtMs: number;
    }
  | {
      readonly status: 'terminal';
      readonly terminal: CommandExecutionTerminalV1;
      readonly startedAtMs?: number;
    };

/**
 * prepareRuntime 同步返回本对象时不得创建 OS 资源。owner 保存本对象后才会调用 start，
 * 因此 start 内真正 spawn 后的任何失败都仍有 stopAndWait 和 terminal 可以收口。
 * start pending 时 owner 可以并发调用 stopAndWait；平台实现必须立即接受停止，不能等待 start
 * 先完成，否则对话删除或 App 关闭会与启动握手互相等待。
 */
export interface PreparedCommandExecutionRuntime extends CommandExecutionRuntimeControl {
  /** prepare 阶段只建立有界内存观察口，不得因此 open 文件、fork helper 或持有原生资源。 */
  readonly outputObservation: CommandProcessOutputObservationPort;
  /** 永不 reject；存储故障必须结算为 unavailable，不能改写命令终因。 */
  readonly settledTextOutput: Promise<CommandSettledTextOutput>;
  start(): Promise<CommandExecutionPreparedRuntimeStartResult>;
}

export type CommandExecutionStartResult =
  | {
      readonly status: 'running';
      readonly binding: CommandExecutionOwnerBindingV1;
      readonly startedAtMs: number;
      readonly terminal: Promise<CommandExecutionTerminalV1>;
    }
  | {
      readonly status: 'terminal';
      readonly terminal: CommandExecutionTerminalV1;
      readonly startedAtMs?: number;
    }
  | {
      readonly status: 'rejected';
      readonly code: CommandExecutionStartRejectionCode;
    };

export interface CommandExecutionOwnerActivitySnapshot {
  readonly generationId: CommandOwnerGenerationId;
  readonly lifecycle: ProcessOwnerLifecycle;
  readonly reservedCount: number;
  readonly startingCount: number;
  readonly runningCount: number;
  readonly stoppingCount: number;
  /** 不持有平台资源；只统计仍在阻止迟到 tool call 的 Agent run 停止屏障。 */
  readonly agentRunStopBarrierCount: number;
  /** 不属于活动进程计数；只含等待 shell 决定是否公开 handle 的无资源终态。 */
  readonly pendingHandleDecisionCount: number;
  /** 不属于活动进程计数；只含当前 owner 内已发布 handle 的无资源终态记录。 */
  readonly terminalReplayCount: number;
  /** 不含输出或平台资源；只让近期被淘汰的真实 handle 返回明确过期。 */
  readonly expiredHandleCount: number;
}
