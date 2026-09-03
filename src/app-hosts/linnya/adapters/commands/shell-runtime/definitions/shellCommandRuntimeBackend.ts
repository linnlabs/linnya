import type {
  CommandLaunchSnapshotV1,
  ProcessPtySizeV1,
} from '@app/schemas/commands';
import type {
  PreparedCommandExecutionRuntime,
} from '../../../../../../domains/commands';
import type { LocalCommandOwnerPort } from '../../process-owner';
import type { ShellLaunchRuntimePolicyContext } from '../../../../../../domains/commands';

export interface ShellCommandToolOutputScope {
  readonly instanceId: string;
}

/**
 * 生产组合根只向用例层暴露冻结的启动快照和两条互斥 prepared-runtime 工厂。
 * PTY projection 尚可替换，但 PTY 不可用时必须明确失败，不能回退普通 pipe。
 */
export interface ShellCommandRuntimeBackend {
  readonly owner: LocalCommandOwnerPort;
  readLaunchRuntimeContext(): ShellLaunchRuntimePolicyContext;
  readonly initialPtySize: ProcessPtySizeV1;
  preparePipe(
    launch: Extract<CommandLaunchSnapshotV1, { readonly mode: 'pipe' }>,
    toolOutputScope: ShellCommandToolOutputScope,
  ): PreparedCommandExecutionRuntime;
  preparePty(
    launch: Extract<CommandLaunchSnapshotV1, { readonly mode: 'pty' }>,
    toolOutputScope: ShellCommandToolOutputScope,
  ): PreparedCommandExecutionRuntime;
}
