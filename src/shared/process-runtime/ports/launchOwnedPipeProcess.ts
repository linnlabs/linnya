import type {
  OwnedPipeProcess,
  OwnedPipeProcessLaunch,
  OwnedPipeProcessLaunchOptions,
} from '../definitions/ownedPipeProcess';

/**
 * 调用方只负责提供已经冻结的启动事实；平台 adapter 独占 spawn、进程树和资源句柄。
 * 这条方向可以让 Commands 与 Sandbox 复用 owner，而不互相依赖业务实现。
 */
export type LaunchOwnedPipeProcess = (
  launch: OwnedPipeProcessLaunch,
  options?: OwnedPipeProcessLaunchOptions,
) => Promise<OwnedPipeProcess>;
