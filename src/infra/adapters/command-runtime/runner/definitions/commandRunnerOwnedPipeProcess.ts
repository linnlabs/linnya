import type {
  CommandRunnerInternalEnvironmentV1,
  CommandRuntimeFailureCode,
  PipeCommandLaunchSnapshotV1,
} from '@app/schemas/commands';

import type {
  OwnedPipeProcess,
  OwnedPipeProcessLaunchOptions,
  OwnedProcessResourceReleaseResult,
  OwnedProcessTreeStopResult,
} from '../../../../../shared/process-runtime';

export type CommandRunnerOwnedPipeProcessLaunchSettlement =
  | { readonly status: 'guaranteed_not_started' }
  | {
      readonly status: 'startup_cleanup_observed';
      readonly treeCleanup: OwnedProcessTreeStopResult;
      readonly resourceRelease: OwnedProcessResourceReleaseResult;
    };

/**
 * 平台组合层只能把稳定分类交给 runner。原始 errno、HRESULT、SRT 或 native 文案
 * 留在 utility 诊断中，不能进入 Agent、UI 或持久化终态。
 */
export class CommandRunnerOwnedPipeProcessLaunchError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly failureCode: CommandRuntimeFailureCode,
    message: string,
    readonly settlement: CommandRunnerOwnedPipeProcessLaunchSettlement,
    options?: { readonly cause?: unknown },
  ) {
    super(message);
    this.name = 'CommandRunnerOwnedPipeProcessLaunchError';
    this.cause = options?.cause;
  }
}

/**
 * 一次性 runner 的平台启动端口。它接收 host 已冻结并审批的完整 launch snapshot，
 * 使 macOS 文件权限不必污染底层通用进程 owner，也不把平台分支放进生命周期编排。
 */
export type LaunchCommandRunnerOwnedPipeProcess = (
  launch: PipeCommandLaunchSnapshotV1,
  options?: OwnedPipeProcessLaunchOptions & {
    readonly internalEnvironment?: CommandRunnerInternalEnvironmentV1;
  },
) => Promise<OwnedPipeProcess>;
