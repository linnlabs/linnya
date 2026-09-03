import type {
  CommandExecutionIdentity,
  CommandExecutionTerminalV1,
  CommandOwnerGenerationId,
  CommandProcessHandle,
} from '@app/schemas/commands';

export type ProcessOwnerLifecycle = 'active' | 'ending' | 'ended';

export interface ProcessOwnerSnapshot {
  readonly generationId: CommandOwnerGenerationId;
  readonly lifecycle: ProcessOwnerLifecycle;
}

interface OwnedProcessHandleBase {
  readonly processHandle: CommandProcessHandle;
  readonly identity: CommandExecutionIdentity;
}

export interface RunningProcessHandle extends OwnedProcessHandleBase {
  readonly state: 'running';
}

/**
 * 终态记录不持有 PID、文件描述符或原生对象，因此查询可以幂等，活跃资源也能及时释放。
 */
export interface TerminalProcessHandle extends OwnedProcessHandleBase {
  readonly state: 'terminal';
  readonly terminal: CommandExecutionTerminalV1;
}

/**
 * 完整终态 replay 已释放，但 owner 仍短期保留这一窄标记，让真实旧 handle 与从未
 * 存在的 handle 有稳定区别。它不包含输出、terminal 或任何平台资源。
 */
export interface ExpiredProcessHandle extends OwnedProcessHandleBase {
  readonly state: 'expired';
}

export type OwnedProcessHandle =
  | RunningProcessHandle
  | TerminalProcessHandle
  | ExpiredProcessHandle;
