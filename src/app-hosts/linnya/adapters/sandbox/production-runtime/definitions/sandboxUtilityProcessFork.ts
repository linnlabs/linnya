import type { SandboxUtilityProcessLike } from './sandboxUtilityProcessTransport';

export interface SandboxUtilityProcessForkRequest {
  readonly utilityPath: string;
  readonly argv: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
}

/**
 * 一次性 Sandbox Utility 的窄物理创建口。App Host 编排只消费这份合同，Electron
 * UtilityProcess 与 headless Node child_process 各自在最外层提供实现。
 */
export interface SandboxUtilityProcessForkPort {
  fork(request: SandboxUtilityProcessForkRequest): SandboxUtilityProcessLike;
}
