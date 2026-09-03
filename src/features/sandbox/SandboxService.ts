import { randomUUID } from 'node:crypto';
import { SandboxProfileRegistry, type SandboxProfileRegistrationOptions } from './SandboxProfileRegistry.js';
import type { SandboxRunnerExecutionOptions } from './definitions/sandboxRunner.js';
import type { SandboxRunnerPort } from './ports/sandboxRunnerPort.js';
import type { SandboxExecutionRequest, SandboxExecutionResult, SandboxJsonValue, SandboxProfile, SandboxRunnerDiagnostics } from './types.js';

export class SandboxService {
  constructor(
    private readonly registry: SandboxProfileRegistry,
    private readonly runner: SandboxRunnerPort,
  ) {}

  registerProfile<TValue extends SandboxJsonValue | undefined>(
    profile: SandboxProfile<TValue>,
    options?: SandboxProfileRegistrationOptions,
  ): void {
    this.registry.register(profile, options);
  }

  unregisterProfile(profileId: string): boolean {
    return this.registry.unregister(profileId);
  }

  hasProfile(profileId: string): boolean {
    return this.registry.has(profileId);
  }

  getProfile<TValue extends SandboxJsonValue | undefined>(profileId: string): SandboxProfile<TValue> | null {
    return this.registry.get<TValue>(profileId);
  }

  listProfiles(): readonly SandboxProfile<SandboxJsonValue | undefined>[] {
    return this.registry.list();
  }

  listProfileIds(): readonly string[] {
    return this.registry.listIds();
  }

  async execute<TValue extends SandboxJsonValue | undefined = SandboxJsonValue | undefined>(
    request: SandboxExecutionRequest,
    options?: SandboxRunnerExecutionOptions,
  ): Promise<SandboxExecutionResult<TValue>> {
    const requestError = validateSandboxExecutionRequest(request);
    if (requestError) {
      return this.buildUnknownProfileResult<TValue>(request.profileId, {
        type: 'compile',
        message: requestError,
      });
    }

    const profile = this.registry.get<TValue>(request.profileId);
    if (!profile) {
      return this.buildUnknownProfileResult<TValue>(request.profileId, {
        type: 'compile',
        message: `未知 sandbox profile: ${request.profileId}`,
      });
    }

    validateCapabilityGrants(request, profile);

    const runId = randomUUID();
    const policy = profile.buildPolicy(request);
    const prepared = profile.prepareExecution(request, policy, runId);
    if ('success' in prepared) {
      return prepared;
    }

    const runnerResult = await this.runner.execute(prepared.runnerRequest, options);
    return profile.finalizeExecution(request, policy, runId, runnerResult);
  }

  private buildUnknownProfileResult<TValue extends SandboxJsonValue | undefined>(
    profileId: string,
    error: { type: 'compile'; message: string },
  ): SandboxExecutionResult<TValue> {
    return {
      success: false,
      logs: [],
      error,
      usage: {
        elapsedMs: 0,
        logLines: 0,
        logBytes: 0,
        resultBytes: 0,
        capabilityCallCount: 0,
        capabilityCallsByName: {},
        deniedActions: [],
      },
      telemetry: {
        runId: randomUUID(),
        profileId,
        policyVersion: 'unknown',
        limits: {
          timeoutMs: 0,
          maxLogLines: 0,
          maxLogLineLength: 0,
          maxResultBytes: 0,
          maxSourceBytes: 0,
          maxCapabilityPayloadBytes: 0,
          maxHeapMb: 0,
          idleTimeoutMs: 0,
        },
        diagnostics: emptyDiagnostics(),
      },
      artifacts: [],
    };
  }
}

export function registerDefaultSandboxProfiles(registry: SandboxProfileRegistry): void {
  // 中文说明：默认沙箱服务必须保持平台通用；业务 profile 由插件运行态按 enabled 状态挂载。
  void registry;
}

function validateSandboxExecutionRequest(request: SandboxExecutionRequest): string | null {
  if (typeof request.profileId !== 'string' || request.profileId.trim().length === 0) {
    return 'SandboxExecutionRequest.profileId 不能为空。';
  }
  if (request.language !== 'javascript' && request.language !== 'typescript') {
    return `不支持的 sandbox language: ${String(request.language)}`;
  }
  if (typeof request.source !== 'string' || request.source.trim().length === 0) {
    return 'SandboxExecutionRequest.source 不能为空。';
  }
  return null;
}

function validateCapabilityGrants(
  request: SandboxExecutionRequest,
  profile: Pick<SandboxProfile, 'allowedCapabilities'>,
): void {
  for (const grant of request.capabilities ?? []) {
    if (!profile.allowedCapabilities.has(grant.name)) {
      throw new Error(`sandbox.capability.unknown: ${grant.name}`);
    }
  }
}

function emptyDiagnostics(): SandboxRunnerDiagnostics {
  return {
    runnerKind: 'unknown',
    startConfirmed: false,
    heartbeatCount: 0,
    protocolEvents: [],
    stderrBytes: 0,
    idleTimeoutTriggered: false,
    cleanupStatus: 'succeeded',
  };
}
