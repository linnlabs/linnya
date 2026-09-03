import type {
  CommandLaunchEnvironmentV1,
  CommandResolvedShellV1,
} from '@app/schemas/commands';
import type {
  LocalProcessPlatformRuntime,
} from 'src/infra/adapters/local-process-runtime/platform-runtime';

/** 在 App owner 启动期冻结、供 Commands production composition 消费的平台事实。 */
export interface CommandRuntimeFacts {
  readonly shell: CommandResolvedShellV1;
  readonly environment: CommandLaunchEnvironmentV1;
  readonly platformRuntime: LocalProcessPlatformRuntime;
}
