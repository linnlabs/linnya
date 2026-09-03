import { describe, expect, it, vi } from 'vitest';

import type { SandboxRunnerRequest } from '../../definitions/sandboxRunner.js';
import { evaluateSandboxRunnerRequest } from './evaluateSandboxRunnerRequest.js';

function createRequest(overrides: Partial<SandboxRunnerRequest> = {}): SandboxRunnerRequest {
  return {
    runId: 'run-evaluator',
    profileId: 'profile-evaluator',
    language: 'javascript',
    source: 'return 42;',
    globals: {},
    bindings: [],
    limits: {
      timeoutMs: 2_000,
      maxLogLines: 50,
      maxLogLineLength: 500,
      maxResultBytes: 32 * 1024,
      maxSourceBytes: 32 * 1024,
      maxCapabilityPayloadBytes: 32 * 1024,
      maxHeapMb: 64,
      idleTimeoutMs: 2_000,
    },
    capabilities: [],
    ...overrides,
  };
}

describe('evaluateSandboxRunnerRequest', () => {
  it('通过唯一入口执行用户代码并记录已授权 capability 的结构化调用', async () => {
    const confirmStarted = vi.fn(async () => undefined);
    const result = await evaluateSandboxRunnerRequest(createRequest({
      source: `
        emit({ ok: true });
        return { answer: ANSWER + 1 };
      `,
      globals: { ANSWER: 41 },
      bindings: [{ kind: 'capability', globalName: 'emit', capability: 'test.emit' }],
      capabilities: [{ name: 'test.emit', maxCalls: 1 }],
    }), { confirmStarted });

    expect(confirmStarted).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      success: true,
      value: { answer: 42 },
      capabilityCalls: [{ name: 'test.emit', payload: { ok: true } }],
      deniedActions: [],
    });
  });

  it('未授权和超限 capability 都返回稳定业务错误，不泄漏 transport 字段', async () => {
    const ungranted = await evaluateSandboxRunnerRequest(createRequest({
      source: 'emit({ ok: true });',
      bindings: [{ kind: 'capability', globalName: 'emit', capability: 'test.emit' }],
    }), { confirmStarted: async () => undefined });

    expect(ungranted.error).toMatchObject({
      type: 'policy_denied',
      message: '能力 test.emit 未授权。',
    });
    expect(ungranted.deniedActions).toEqual(['test.emit']);
    expect(ungranted).not.toHaveProperty('stderr');
    expect(ungranted).not.toHaveProperty('diagnostics');

    const oversized = await evaluateSandboxRunnerRequest(createRequest({
      source: `emit('${'x'.repeat(64)}');`,
      bindings: [{ kind: 'capability', globalName: 'emit', capability: 'test.emit' }],
      capabilities: [{ name: 'test.emit', maxBytes: 8 }],
    }), { confirmStarted: async () => undefined });

    expect(oversized.error?.type).toBe('resource_exhausted');
    expect(oversized.error?.message).toContain('能力 test.emit 负载过大');
    expect(oversized.capabilityCalls).toEqual([]);

    const tooManyCalls = await evaluateSandboxRunnerRequest(createRequest({
      source: 'emit(1); emit(2);',
      bindings: [{ kind: 'capability', globalName: 'emit', capability: 'test.emit' }],
      capabilities: [{ name: 'test.emit', maxCalls: 1 }],
    }), { confirmStarted: async () => undefined });

    expect(tooManyCalls.error).toMatchObject({
      type: 'policy_denied',
      message: '能力 test.emit 超出调用次数限制。',
    });
    expect(tooManyCalls.capabilityCalls).toEqual([{ name: 'test.emit', payload: 1 }]);
    expect(tooManyCalls.deniedActions).toEqual(['test.emit']);
  });

  it('结果容量和序列化错误保持旧 runner 的业务语义', async () => {
    const oversized = await evaluateSandboxRunnerRequest(createRequest({
      source: `return '${'x'.repeat(64)}';`,
      limits: {
        ...createRequest().limits,
        maxResultBytes: 8,
      },
    }), { confirmStarted: async () => undefined });
    expect(oversized.error?.type).toBe('resource_exhausted');
    expect(oversized.error?.message).toContain('执行结果过大');

    const cyclic = await evaluateSandboxRunnerRequest(createRequest({
      source: 'const value = {}; value.self = value; return value;',
    }), { confirmStarted: async () => undefined });
    expect(cyclic.error).toMatchObject({
      type: 'runtime',
    });
    expect(cyclic.error?.message).toContain('SANDBOX_RUNTIME_SERIALIZATION:');
  });

  it('started 交付失败时不执行用户代码，由 transport owner 统一收口', async () => {
    await expect(evaluateSandboxRunnerRequest(createRequest({
      source: 'while (true) {}',
    }), {
      confirmStarted: async () => {
        throw new Error('started transport failed');
      },
    })).rejects.toThrow('started transport failed');
  });
});
