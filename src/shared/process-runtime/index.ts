// 该入口包含 Node stream、AbortSignal 和 Error，只允许 backend/runtime 使用，不能进入 wire schema 或 renderer。
export { OwnedPipeProcessStartupCleanupError } from './definitions/ownedPipeProcess';
export type {
  OwnedPipeProcess,
  OwnedPipeProcessLaunch,
  OwnedPipeProcessLaunchOptions,
  OwnedProcessResourceReleaseResult,
  OwnedProcessRootExit,
  OwnedProcessTreeStopResult,
} from './definitions/ownedPipeProcess';
export type { LaunchOwnedPipeProcess } from './ports/launchOwnedPipeProcess';
