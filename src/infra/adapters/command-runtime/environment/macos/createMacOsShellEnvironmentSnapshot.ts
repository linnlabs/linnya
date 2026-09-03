import type { LaunchOwnedPipeProcess } from '../../../../../shared/process-runtime';
import type {
  HostProcessEnvironment,
  ShellEnvironmentSnapshot,
} from '../definitions';
import {
  buildShellEnvironmentSnapshot,
  createMacOsLoginProbeHelperEnvironment,
  createUserLoginEnvironmentCandidate,
} from '../functions';
import {
  probeMacOsLoginEnvironment,
  type MacOsLoginEnvironmentProbeFailure,
} from './probeMacOsLoginEnvironment';

export interface MacOsShellEnvironmentResolution {
  readonly snapshot: ShellEnvironmentSnapshot;
  readonly probe: {
    readonly status: 'succeeded';
    readonly variableCount: number;
  } | {
    readonly status: 'failed';
    readonly reason: MacOsLoginEnvironmentProbeFailure;
  };
}

/** App owner 只调用一次；失败只降级到启动时已冻结的 host 候选，不读取运行中 process.env。 */
export async function createMacOsShellEnvironmentSnapshot(input: {
  readonly host: HostProcessEnvironment;
  readonly revision: string;
  readonly launchOwnedPipeProcess?: LaunchOwnedPipeProcess;
  readonly timeoutMs?: number;
}): Promise<MacOsShellEnvironmentResolution> {
  // `-ilc` 会有意执行用户登录/交互 profile，才能恢复 Finder/Dock 缺失的 PATH 与
  // CLI 登录环境。副作用被限制在这次 App 启动探针，并由独立进程组、超时和协议隔离；
  // 正式命令仍使用 `zsh -f -c`，整个 App 生命周期也绝不再次运行 profile。
  const probe = await probeMacOsLoginEnvironment({
    helperEnvironment: createMacOsLoginProbeHelperEnvironment(input.host),
    ...(input.launchOwnedPipeProcess
      ? { launchOwnedPipeProcess: input.launchOwnedPipeProcess }
      : {}),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });
  const candidate = probe.status === 'succeeded'
    ? probe.candidate
    : createUserLoginEnvironmentCandidate({
        source: 'host_process',
        entries: input.host.entries,
      });
  return Object.freeze({
    snapshot: buildShellEnvironmentSnapshot({
      host: input.host,
      candidate,
      revision: input.revision,
    }),
    probe: probe.status === 'succeeded'
      ? Object.freeze({ status: 'succeeded', variableCount: probe.variableCount })
      : probe,
  });
}
