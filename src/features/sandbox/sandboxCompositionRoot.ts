import type { SandboxRunnerResult } from './definitions/sandboxRunner.js';
import type { SandboxRunnerPort } from './ports/sandboxRunnerPort.js';
import { SandboxProfileRegistry } from './SandboxProfileRegistry.js';
import { registerDefaultSandboxProfiles, SandboxService } from './SandboxService.js';

let defaultSandboxService: SandboxService | null = null;
let installedDefaultSandboxRunner: SandboxRunnerPort | null = null;

const defaultSandboxRunnerPort: SandboxRunnerPort = {
  execute(request, options) {
    const runner = installedDefaultSandboxRunner;
    if (!runner) return Promise.resolve(buildRunnerNotInstalledResult());
    return runner.execute(request, options);
  },
};

/**
 * App composition 只能安装一次正式 runner。禁止重装是为了让已取得默认 service 的
 * profile、执行请求和后续调用始终落到同一个 runtime owner，而不是运行中切换实现。
 */
export function installDefaultSandboxRunner(runner: SandboxRunnerPort): void {
  if (installedDefaultSandboxRunner) {
    throw new Error('Default sandbox runner 已安装，当前 App 生命周期内禁止替换。');
  }
  installedDefaultSandboxRunner = runner;
}

export function getDefaultSandboxService(): SandboxService {
  if (defaultSandboxService) return defaultSandboxService;

  const registry = new SandboxProfileRegistry();
  registerDefaultSandboxProfiles(registry);
  // profile 注册可以早于平台 runtime 装配；执行则通过 install-once port fail closed，
  // 不能因 App composition 遗漏而静默回到旧 LocalProcess runner。
  defaultSandboxService = new SandboxService(registry, defaultSandboxRunnerPort);
  return defaultSandboxService;
}

function buildRunnerNotInstalledResult(): SandboxRunnerResult {
  return {
    success: false,
    logs: [],
    error: {
      type: 'transport',
      message: 'Sandbox 正式 runner 尚未安装，当前执行已拒绝。',
    },
    elapsedMs: 0,
    capabilityCalls: [],
    deniedActions: [],
    stderr: '',
    diagnostics: {
      runnerKind: 'uninstalled',
      startConfirmed: false,
      heartbeatCount: 0,
      protocolEvents: ['runner_not_installed'],
      lastEvent: 'runner_not_installed',
      stderrBytes: 0,
      idleTimeoutTriggered: false,
      cleanupStatus: 'succeeded',
    },
  };
}
