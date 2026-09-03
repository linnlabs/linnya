import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SandboxExecutionResult,
  SandboxJsonValue,
  SandboxPolicy,
  SandboxProfile,
} from '../types.js';
import type {
  SandboxRunnerRequest,
  SandboxRunnerResult,
} from '../definitions/sandboxRunner.js';
import type { SandboxRunnerPort } from '../ports/sandboxRunnerPort.js';

function createProfile(): SandboxProfile {
  const limits = {
    timeoutMs: 1_000,
    maxLogLines: 10,
    maxLogLineLength: 100,
    maxResultBytes: 1_000,
    maxSourceBytes: 1_000,
    maxCapabilityPayloadBytes: 1_000,
    maxHeapMb: 64,
    idleTimeoutMs: 1_000,
  };
  return {
    id: 'installation-boundary',
    policyVersion: 'test-v1',
    allowedCapabilities: new Set(),
    buildPolicy(): SandboxPolicy {
      return { profileId: 'installation-boundary', policyVersion: 'test-v1', limits, capabilities: [] };
    },
    prepareExecution(_request, policy, runId) {
      return {
        runnerRequest: {
          runId,
          profileId: policy.profileId,
          language: 'javascript',
          source: 'return 1;',
          globals: {},
          bindings: [],
          limits,
          capabilities: [],
        },
      };
    },
    finalizeExecution(_request, policy, runId, runnerResult): SandboxExecutionResult {
      return {
        success: runnerResult.success,
        ...(runnerResult.value !== undefined ? { value: runnerResult.value } : {}),
        logs: runnerResult.logs,
        ...(runnerResult.error ? { error: runnerResult.error } : {}),
        usage: {
          elapsedMs: runnerResult.elapsedMs,
          logLines: runnerResult.logs.length,
          logBytes: 0,
          resultBytes: 0,
          capabilityCallCount: runnerResult.capabilityCalls.length,
          capabilityCallsByName: {},
          deniedActions: [...runnerResult.deniedActions],
        },
        telemetry: {
          runId,
          profileId: policy.profileId,
          policyVersion: policy.policyVersion,
          limits: policy.limits,
          diagnostics: runnerResult.diagnostics,
        },
        artifacts: [],
      };
    },
  };
}

function createSuccessfulResult(value: SandboxJsonValue): SandboxRunnerResult {
  return {
    success: true,
    value,
    logs: [],
    elapsedMs: 1,
    capabilityCalls: [],
    deniedActions: [],
    stderr: '',
    diagnostics: {
      runnerKind: 'installed-test-runner',
      startConfirmed: true,
      heartbeatCount: 0,
      protocolEvents: ['started', 'result'],
      stderrBytes: 0,
      idleTimeoutTriggered: false,
      cleanupStatus: 'succeeded',
    },
  };
}

describe('default Sandbox runner installation boundary', () => {
  beforeEach(() => {
    // 生产模块没有 reset；测试通过重新加载模块取得独立 App 生命周期。
    vi.resetModules();
  });

  it('允许先注册 profile，但未安装正式 runner 时明确拒绝执行', async () => {
    const { getDefaultSandboxService } = await import('../sandboxCompositionRoot.js');
    const service = getDefaultSandboxService();
    service.registerProfile(createProfile());
    expect(getDefaultSandboxService()).toBe(service);

    const result = await service.execute({
      profileId: 'installation-boundary',
      language: 'javascript',
      source: 'return 1;',
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'transport',
        message: 'Sandbox 正式 runner 尚未安装，当前执行已拒绝。',
      },
      telemetry: {
        diagnostics: {
          runnerKind: 'uninstalled',
          startConfirmed: false,
          lastEvent: 'runner_not_installed',
        },
      },
    });
  });

  it('首次安装可接管已创建的 service，重复安装被拒绝且原 runner 不变', async () => {
    const {
      getDefaultSandboxService,
      installDefaultSandboxRunner,
    } = await import('../sandboxCompositionRoot.js');
    const service = getDefaultSandboxService();
    service.registerProfile(createProfile());
    const requests: SandboxRunnerRequest[] = [];
    const installedRunner: SandboxRunnerPort = {
      async execute(request) {
        requests.push(request);
        return createSuccessfulResult(42);
      },
    };
    const replacementRunner: SandboxRunnerPort = {
      async execute() {
        return createSuccessfulResult(99);
      },
    };

    installDefaultSandboxRunner(installedRunner);
    expect(() => installDefaultSandboxRunner(replacementRunner))
      .toThrow('Default sandbox runner 已安装，当前 App 生命周期内禁止替换。');

    const result = await service.execute({
      profileId: 'installation-boundary',
      language: 'javascript',
      source: 'return 1;',
    });
    expect(result).toMatchObject({ success: true, value: 42 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      profileId: 'installation-boundary',
      source: 'return 1;',
    });
  });

  it('先安装 runner 再创建 service 时仍由首次安装的同一 runner 执行', async () => {
    const {
      getDefaultSandboxService,
      installDefaultSandboxRunner,
    } = await import('../sandboxCompositionRoot.js');
    const requests: SandboxRunnerRequest[] = [];
    const installedRunner: SandboxRunnerPort = {
      async execute(request) {
        requests.push(request);
        return createSuccessfulResult(73);
      },
    };

    installDefaultSandboxRunner(installedRunner);
    const service = getDefaultSandboxService();
    service.registerProfile(createProfile());

    const firstResult = await service.execute({
      profileId: 'installation-boundary',
      language: 'javascript',
      source: 'return 1;',
    });
    const secondResult = await getDefaultSandboxService().execute({
      profileId: 'installation-boundary',
      language: 'javascript',
      source: 'return 2;',
    });

    expect(firstResult).toMatchObject({ success: true, value: 73 });
    expect(secondResult).toMatchObject({ success: true, value: 73 });
    expect(requests).toHaveLength(2);
  });
});
