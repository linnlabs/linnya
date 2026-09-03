import { describe, expect, it } from 'vitest';
import { measureJsonBytes } from '../jsonValue.js';
import { SandboxProfileRegistry } from '../SandboxProfileRegistry.js';
import { registerDefaultSandboxProfiles, SandboxService } from '../SandboxService.js';
import type {
  SandboxRunnerExecutionOptions,
  SandboxRunnerRequest,
  SandboxRunnerResult,
} from '../definitions/sandboxRunner.js';
import type { SandboxRunnerPort } from '../ports/sandboxRunnerPort.js';
import { createSandboxEvaluatorTestRunner } from '../testing/createSandboxEvaluatorTestRunner.js';
import type {
  ResourceLimits,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxPolicy,
  SandboxPreparedExecution,
  SandboxProfile,
  SandboxUsage,
} from '../types.js';

const TEST_PROFILE_ID = 'test_execute';
const DEFAULT_LIMITS: Required<ResourceLimits> = {
  timeoutMs: 10_000,
  maxLogLines: 200,
  maxLogLineLength: 2000,
  maxResultBytes: 256 * 1024,
  maxSourceBytes: 128 * 1024,
  maxCapabilityPayloadBytes: 256 * 1024,
  maxHeapMb: 128,
  idleTimeoutMs: 12_000,
};

function createService(
  profile: SandboxProfile = createTestProfile(),
  runner: SandboxRunnerPort = createSandboxEvaluatorTestRunner(),
): SandboxService {
  const registry = new SandboxProfileRegistry();
  registry.register(profile);
  return new SandboxService(registry, runner);
}

describe('SandboxService', () => {
  it('默认 profile 注册保持平台通用，不内置业务 profile', () => {
    const registry = new SandboxProfileRegistry();

    registerDefaultSandboxProfiles(registry);

    expect(registry.listIds()).toEqual([]);
  });

  it('通过唯一 evaluator 执行已注册 profile，并返回测试 runner 诊断', async () => {
    const service = createService();

    const result = await service.execute({
      profileId: TEST_PROFILE_ID,
      language: 'javascript',
      source: `
        console.log('hello from runner');
        return ANSWER + 1;
      `,
      inputs: {
        ANSWER: 41,
      },
      telemetry: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
      },
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe(42);
    expect(result.logs).toEqual(['hello from runner']);
    expect(result.telemetry.profileId).toBe(TEST_PROFILE_ID);
    expect(result.telemetry.diagnostics.runnerKind).toBe('test-evaluator');
    expect(result.telemetry.diagnostics.startConfirmed).toBe(true);
    expect(result.telemetry.diagnostics.protocolEvents).toContain('started');
  });

  it('未知 profile 返回结构化错误', async () => {
    const runner = new RecordingSandboxRunner(createRunnerResult());
    const service = createService(createTestProfile(), runner);

    const result = await service.execute({
      profileId: 'missing_profile',
      language: 'javascript',
      source: 'return 1;',
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('compile');
    expect(result.error?.message).toContain('未知 sandbox profile');
    expect(result.telemetry.profileId).toBe('missing_profile');
    expect(runner.requests).toHaveLength(0);
  });

  it('dispatch 前拒绝 profile 白名单外的 capability，不进入 runner', async () => {
    const runner = new RecordingSandboxRunner(createRunnerResult());
    const service = createService(createTestProfile(), runner);

    await expect(service.execute({
      profileId: TEST_PROFILE_ID,
      language: 'javascript',
      source: 'return emit({ ok: true });',
      capabilities: [{ name: 'unknown.capability', maxBytes: 256 * 1024 }],
    })).rejects.toThrow('sandbox.capability.unknown: unknown.capability');
    expect(runner.requests).toHaveLength(0);
  });

  it('prepareExecution 返回业务结果时不启动 runner，也不调用 finalizeExecution', async () => {
    let finalizeCallCount = 0;
    const profile: SandboxProfile = {
      ...createTestProfile(),
      prepareExecution(_request, policy, runId): SandboxExecutionResult {
        return createExecutionResult(policy, runId, createRunnerResult({
          success: false,
          error: { type: 'policy_denied', message: 'preflight denied' },
        }));
      },
      finalizeExecution(request, policy, runId, runnerResult): SandboxExecutionResult {
        finalizeCallCount += 1;
        return createTestProfile().finalizeExecution(request, policy, runId, runnerResult);
      },
    };
    const runner = new RecordingSandboxRunner(createRunnerResult());
    const service = createService(profile, runner);

    const result = await service.execute({
      profileId: TEST_PROFILE_ID,
      language: 'javascript',
      source: 'return 1;',
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('policy_denied');
    expect(runner.requests).toHaveLength(0);
    expect(finalizeCallCount).toBe(0);
  });

  it('通过窄 runner port 转发请求和取消信号，并由 profile 完成结果收口', async () => {
    const runner = new RecordingSandboxRunner(createRunnerResult({
      success: false,
      error: { type: 'transport', message: 'runner cancelled' },
    }));
    const service = createService(createTestProfile(), runner);
    const abortController = new AbortController();

    const result = await service.execute({
      profileId: TEST_PROFILE_ID,
      language: 'javascript',
      source: 'return ANSWER;',
      inputs: { ANSWER: 42 },
    }, { abortSignal: abortController.signal });

    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]?.globals).toEqual({ ANSWER: 42 });
    expect(runner.options[0]?.abortSignal).toBe(abortController.signal);
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('runner cancelled');
    expect(result.telemetry.runId).toBe(runner.requests[0]?.runId);
  });

  it('已授权 capability 可以通过 runner 记录调用', async () => {
    const service = createService();

    const result = await service.execute({
      profileId: TEST_PROFILE_ID,
      language: 'javascript',
      source: `
        emit({ ok: true });
        return 'done';
      `,
      capabilities: [{ name: 'test.emit', maxBytes: 256 * 1024 }],
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe('done');
    expect(result.usage.capabilityCallCount).toBe(1);
    expect(result.usage.capabilityCallsByName['test.emit']).toBe(1);
  });
});

function createTestProfile(): SandboxProfile {
  return {
    id: TEST_PROFILE_ID,
    policyVersion: 'test-v1',
    allowedCapabilities: new Set(['test.emit']),

    buildPolicy(request: SandboxExecutionRequest): SandboxPolicy {
      return {
        profileId: TEST_PROFILE_ID,
        policyVersion: 'test-v1',
        limits: {
          ...DEFAULT_LIMITS,
          ...request.limits,
        },
        capabilities: request.capabilities ?? [],
      };
    },

    prepareExecution(
      request: SandboxExecutionRequest,
      policy: SandboxPolicy,
      runId: string,
    ): SandboxPreparedExecution {
      return {
        runnerRequest: {
          runId,
          profileId: policy.profileId,
          language: request.language,
          source: request.source,
          globals: request.inputs ?? {},
          bindings: [
            {
              kind: 'capability',
              globalName: 'emit',
              capability: 'test.emit',
            },
          ],
          limits: policy.limits,
          capabilities: policy.capabilities,
          telemetry: request.telemetry,
        },
      };
    },

    finalizeExecution(
      _request: SandboxExecutionRequest,
      policy: SandboxPolicy,
      runId: string,
      runnerResult: SandboxRunnerResult,
    ): SandboxExecutionResult {
      return createExecutionResult(policy, runId, runnerResult);
    },
  };
}

function createExecutionResult(
  policy: SandboxPolicy,
  runId: string,
  runnerResult: SandboxRunnerResult,
): SandboxExecutionResult {
  return {
    success: runnerResult.success,
    ...(runnerResult.value !== undefined ? { value: runnerResult.value } : {}),
    logs: runnerResult.logs,
    ...(runnerResult.error ? { error: runnerResult.error } : {}),
    usage: buildUsage(runnerResult),
    telemetry: {
      runId,
      profileId: policy.profileId,
      policyVersion: policy.policyVersion,
      limits: policy.limits,
      diagnostics: runnerResult.diagnostics,
    },
    artifacts: [],
  };
}

function createRunnerResult(
  overrides: Partial<Pick<SandboxRunnerResult, 'success' | 'error'>> = {},
): SandboxRunnerResult {
  const resultWithoutValue: Omit<SandboxRunnerResult, 'value'> = {
    success: true,
    logs: [],
    elapsedMs: 1,
    capabilityCalls: [],
    deniedActions: [],
    stderr: '',
    diagnostics: {
      runnerKind: 'recording',
      startConfirmed: true,
      heartbeatCount: 0,
      protocolEvents: ['started', 'result'],
      stderrBytes: 0,
      idleTimeoutTriggered: false,
      cleanupStatus: 'succeeded',
    },
    ...overrides,
  };

  return overrides.success === false
    ? resultWithoutValue
    : { ...resultWithoutValue, value: 42 };
}

class RecordingSandboxRunner implements SandboxRunnerPort {
  readonly requests: SandboxRunnerRequest[] = [];
  readonly options: Array<SandboxRunnerExecutionOptions | undefined> = [];

  constructor(private readonly result: SandboxRunnerResult) {}

  async execute(
    request: SandboxRunnerRequest,
    options?: SandboxRunnerExecutionOptions,
  ): Promise<SandboxRunnerResult> {
    this.requests.push(request);
    this.options.push(options);
    return this.result;
  }
}

function buildUsage(runnerResult: SandboxRunnerResult): SandboxUsage {
  const capabilityCallsByName: Record<string, number> = {};
  for (const call of runnerResult.capabilityCalls) {
    capabilityCallsByName[call.name] = (capabilityCallsByName[call.name] ?? 0) + 1;
  }

  return {
    elapsedMs: runnerResult.elapsedMs,
    logLines: runnerResult.logs.length,
    logBytes: measureJsonBytes(runnerResult.logs),
    resultBytes: measureJsonBytes(runnerResult.value),
    capabilityCallCount: runnerResult.capabilityCalls.length,
    capabilityCallsByName,
    deniedActions: [...runnerResult.deniedActions],
  };
}
