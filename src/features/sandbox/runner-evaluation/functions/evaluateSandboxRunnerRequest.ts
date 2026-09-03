import { executeInSandbox } from '../../CodeSandbox.js';
import { measureJsonBytes, toTransportJsonValue } from '../../jsonValue.js';
import type {
  SandboxCapabilityCall,
  SandboxRunnerBindingSpec,
  SandboxRunnerRequest,
} from '../../definitions/sandboxRunner.js';
import type {
  SandboxCapabilityGrant,
  SandboxError,
  SandboxJsonValue,
} from '../../types.js';
import type {
  SandboxRunnerEvaluationLifecycle,
  SandboxRunnerEvaluationResult,
} from '../definitions/sandboxRunnerEvaluation.js';

class SandboxPolicyViolation extends Error {
  constructor(message: string) {
    super(`SANDBOX_POLICY_DENIED:${message}`);
  }
}

class SandboxResourceExhaustedError extends Error {
  constructor(message: string) {
    super(`SANDBOX_RESOURCE_EXHAUSTED:${message}`);
  }
}

/**
 * 唯一的 Sandbox evaluator 业务入口。它不接触 IPC、mailbox、PID 或 stderr，internal
 * Helper 只负责 transport，不能复制 capability 和错误规则。
 */
export async function evaluateSandboxRunnerRequest(
  request: SandboxRunnerRequest,
  lifecycle: SandboxRunnerEvaluationLifecycle,
): Promise<SandboxRunnerEvaluationResult> {
  const deniedActions: string[] = [];
  const capabilityCalls: SandboxCapabilityCall[] = [];
  const capabilityState = new Map<string, { grant: SandboxCapabilityGrant; count: number }>();

  for (const grant of request.capabilities) {
    capabilityState.set(grant.name, { grant, count: 0 });
  }

  const globals: Record<string, unknown> = {
    ...request.globals,
  };

  for (const binding of request.bindings) {
    installBinding(
      globals,
      binding,
      capabilityState,
      capabilityCalls,
      deniedActions,
      request.limits.maxCapabilityPayloadBytes,
    );
  }

  // started 必须先于用户代码；否则 transport 可能在代码已经产生副作用后仍报告“尚未启动”。
  await lifecycle.confirmStarted();

  const execution = executeInSandbox(request.source, {
    timeoutMs: request.limits.timeoutMs,
    maxLogLines: request.limits.maxLogLines,
    maxLogLineLength: request.limits.maxLogLineLength,
    globals,
  });

  let value: SandboxJsonValue | undefined;
  if (execution.success) {
    try {
      value = safelySerializeValue(execution.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        logs: execution.logs,
        error: {
          type: 'runtime',
          message,
        },
        elapsedMs: execution.elapsedMs,
        capabilityCalls,
        deniedActions,
      };
    }
  }

  const resultBytes = measureJsonBytes(value);
  if (resultBytes > request.limits.maxResultBytes) {
    return {
      success: false,
      logs: execution.logs,
      error: {
        type: 'resource_exhausted',
        message: `执行结果过大：${resultBytes} bytes，超过上限 ${request.limits.maxResultBytes} bytes。`,
      },
      elapsedMs: execution.elapsedMs,
      capabilityCalls,
      deniedActions,
    };
  }

  return {
    success: execution.success,
    value,
    logs: execution.logs,
    error: execution.error ? normalizeError(execution.error) : undefined,
    elapsedMs: execution.elapsedMs,
    capabilityCalls,
    deniedActions,
  };
}

function installBinding(
  globals: Record<string, unknown>,
  binding: SandboxRunnerBindingSpec,
  capabilityState: Map<string, { grant: SandboxCapabilityGrant; count: number }>,
  capabilityCalls: SandboxCapabilityCall[],
  deniedActions: string[],
  maxCapabilityPayloadBytes: number,
): void {
  if (binding.kind !== 'capability') {
    return;
  }

  globals[binding.globalName] = (payload: unknown) => {
    const state = capabilityState.get(binding.capability);
    if (!state) {
      deniedActions.push(binding.capability);
      throw new SandboxPolicyViolation(`能力 ${binding.capability} 未授权。`);
    }

    if (typeof state.grant.maxCalls === 'number' && state.count >= state.grant.maxCalls) {
      deniedActions.push(binding.capability);
      throw new SandboxPolicyViolation(`能力 ${binding.capability} 超出调用次数限制。`);
    }

    const serialized = toTransportJsonValue(payload);
    const payloadBytes = measureJsonBytes(serialized);
    const payloadLimit = state.grant.maxBytes ?? maxCapabilityPayloadBytes;
    if (payloadBytes > payloadLimit) {
      throw new SandboxResourceExhaustedError(
        `能力 ${binding.capability} 负载过大：${payloadBytes} bytes，超过上限 ${payloadLimit} bytes。`,
      );
    }

    state.count += 1;
    capabilityCalls.push({
      name: binding.capability,
      ...(serialized !== undefined ? { payload: serialized } : {}),
    });
    return undefined;
  };
}

function safelySerializeValue(value: unknown): SandboxJsonValue | undefined {
  try {
    return toTransportJsonValue(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`SANDBOX_RUNTIME_SERIALIZATION:${message}`);
  }
}

function normalizeError(error: SandboxError): SandboxError {
  if (error.type !== 'runtime') return error;

  if (error.message.startsWith('SANDBOX_POLICY_DENIED:')) {
    return {
      ...error,
      type: 'policy_denied',
      message: error.message.slice('SANDBOX_POLICY_DENIED:'.length),
    };
  }

  if (error.message.startsWith('SANDBOX_RESOURCE_EXHAUSTED:')) {
    return {
      ...error,
      type: 'resource_exhausted',
      message: error.message.slice('SANDBOX_RESOURCE_EXHAUSTED:'.length),
    };
  }

  if (error.message.startsWith('SANDBOX_RUNTIME_SERIALIZATION:')) {
    return {
      ...error,
      message: error.message.slice('SANDBOX_RUNTIME_SERIALIZATION:'.length),
    };
  }

  return error;
}
