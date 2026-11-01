import type { AppServerProcessLaunch } from '../../../../infra/adapters/app-server-process';
import type { LocalProcessPlatformRuntime } from '../../../../infra/adapters/local-process-runtime/platform-runtime';

/** Host 与 child 共用一次验出的平台事实，不能各自再次探测同一 App 的签名。 */
export interface ResolvedAppServerProcessLaunch {
  readonly launch: AppServerProcessLaunch;
  readonly localProcessPlatformRuntime: LocalProcessPlatformRuntime;
}
