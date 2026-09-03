import { describe, expect, it } from 'vitest';

import type { SandboxRunnerEvaluationResult } from 'src/features/sandbox/runner-evaluation/definitions/sandboxRunnerEvaluation.js';
import type {
  SandboxUtilityProcessExit,
  SandboxUtilityTerminalPayload,
} from '../definitions/sandboxUtilityProcessTransport.js';
import {
  projectSandboxRunnerResult,
  type ProjectSandboxRunnerResultInput,
} from './projectSandboxRunnerResult.js';

const RUN_TOKEN = '0'.repeat(32);
const MISMATCHED_RUN_TOKEN = '1'.repeat(32);
const LIMITS = Object.freeze({ timeoutMs: 2_000, idleTimeoutMs: 750 });

describe('Sandbox runner 公开结果投影', () => {
  it('完整自然终态返回严格重读的业务结果，并隐藏内部 committed 帧名称', () => {
    const result = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      utilityForked: true,
      terminal: completeTerminal(),
      utilityExit: successfulUtilityExit(),
      evaluation: successfulEvaluation(),
    });

    expect(result).toEqual({
      success: true,
      value: { ok: true },
      logs: ['业务日志'],
      elapsedMs: 18,
      capabilityCalls: [{ name: 'asset.read', payload: { id: 'asset-1' } }],
      deniedActions: ['network.fetch'],
      stderr: 'evaluator diagnostic tail',
      diagnostics: {
        runnerKind: 'local-process',
        childPid: 2468,
        startConfirmed: true,
        heartbeatCount: 0,
        protocolEvents: ['ready', 'started', 'result'],
        lastEvent: 'result',
        stderrBytes: 98_765,
        idleTimeoutTriggered: false,
        cleanupStatus: 'succeeded',
      },
    });
    expect(JSON.stringify(result)).not.toContain('result_committed');
  });

  it('Evaluator 内部结构化 timeout 仍按自然终态保留已产生日志和业务错误', () => {
    const evaluation: SandboxRunnerEvaluationResult = {
      success: false,
      logs: ['死循环前的日志'],
      error: {
        type: 'timeout',
        message: 'Sandbox execution timed out after 2000ms',
      },
      elapsedMs: 2_001,
      capabilityCalls: [],
      deniedActions: [],
    };

    const result = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      utilityForked: true,
      terminal: completeTerminal(),
      utilityExit: successfulUtilityExit(),
      evaluation,
    });

    expect(result).toMatchObject({
      success: false,
      logs: ['死循环前的日志'],
      error: evaluation.error,
      elapsedMs: 2_001,
      diagnostics: {
        protocolEvents: ['ready', 'started', 'result'],
      },
    });
  });

  it.each([
    {
      cause: 'timed_out' as const,
      expected: {
        type: 'timeout',
        message: 'Sandbox runner 超时终止（>2000ms）。',
        elapsedMs: 2_000,
        idleTimeoutTriggered: false,
      },
    },
    {
      cause: 'idle_timed_out' as const,
      expected: {
        type: 'timeout',
        message: 'Sandbox runner 空闲超时终止（>750ms 无协议活动）。',
        elapsedMs: 750,
        idleTimeoutTriggered: true,
      },
    },
    {
      cause: 'cancelled' as const,
      expected: {
        type: 'transport',
        message: 'Sandbox runner 因宿主取消而终止。',
        elapsedMs: 0,
        idleTimeoutTriggered: false,
      },
    },
    {
      cause: 'owner_ended' as const,
      expected: {
        type: 'transport',
        message: 'Sandbox runner 因宿主结束而终止。',
        elapsedMs: 0,
        idleTimeoutTriggered: false,
      },
    },
    {
      cause: 'transport_failed' as const,
      expected: {
        type: 'transport',
        message: 'Sandbox runner 运行时通信失败。',
        elapsedMs: 0,
        idleTimeoutTriggered: false,
      },
    },
  ])('$cause 投影为稳定公开错误且不泄漏内部失败名', ({ cause, expected }) => {
    const result = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      utilityForked: true,
      terminal: completeTerminal({ cause }),
      utilityExit: successfulUtilityExit(),
    });

    expect(result).toMatchObject({
      success: false,
      logs: [],
      error: { type: expected.type, message: expected.message },
      elapsedMs: expected.elapsedMs,
      diagnostics: { idleTimeoutTriggered: expected.idleTimeoutTriggered },
    });
    expect(JSON.stringify(result)).not.toContain('settlement_failed');
  });

  it.each(['timed_out', 'idle_timed_out', 'cancelled', 'owner_ended'] as const)(
    '%s 保留业务首因，同时公开稳定的资源收口失败状态',
    cause => {
      const result = projectSandboxRunnerResult({
        runToken: RUN_TOKEN,
        limits: LIMITS,
        utilityForked: true,
        terminal: completeTerminal({
          cause,
          settlementFailures: ['tree_empty_failed', 'resource_release_failed'],
        }),
        utilityExit: successfulUtilityExit(),
      });

      expect(result.diagnostics.cleanupStatus).toBe('failed');
      expect(result.error?.message).toContain(
        cause === 'idle_timed_out'
          ? '空闲超时'
          : cause === 'timed_out'
            ? '超时终止'
            : cause === 'cancelled'
              ? '宿主取消'
              : '宿主结束'
      );
      expect(JSON.stringify(result)).not.toContain('tree_empty_failed');
      expect(JSON.stringify(result)).not.toContain('resource_release_failed');
    }
  );

  it('Utility 的非资源结算失败不能误报资源清理失败', () => {
    const result = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      utilityForked: true,
      terminal: completeTerminal({ settlementFailures: ['result_mailbox_failed'] }),
      utilityExit: successfulUtilityExit(),
    });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'transport', message: 'Sandbox runner 运行时通信失败。' },
      diagnostics: { cleanupStatus: 'succeeded' },
    });
    expect(JSON.stringify(result)).not.toContain('result_mailbox_failed');
  });

  it.each([
    {
      name: 'run token 错配',
      change: (): Partial<ProjectSandboxRunnerResultInput> => ({
        terminal: completeTerminal({ runToken: MISMATCHED_RUN_TOKEN }),
      }),
    },
    {
      name: 'Evaluator 非零退出',
      change: (): Partial<ProjectSandboxRunnerResultInput> => ({
        terminal: completeTerminal({ rootExit: { exitCode: 1, signal: null } }),
      }),
    },
    {
      name: '控制帧不完整',
      change: (): Partial<ProjectSandboxRunnerResultInput> => ({
        terminal: completeTerminal({
          control: {
            acceptedFrames: ['ready', 'started'],
            evaluatorPid: 2468,
            windowsCrLfPreambleObserved: false,
            completed: false,
          },
        }),
      }),
    },
    {
      name: 'Utility 非零退出',
      change: (): Partial<ProjectSandboxRunnerResultInput> => ({
        utilityExit: { exitCode: 1, stderrBytes: 8, stderrTail: 'utility failed' },
      }),
    },
    {
      name: 'Utility 虽退出为零但 transport 已失败',
      change: (): Partial<ProjectSandboxRunnerResultInput> => ({
        utilityExit: {
          exitCode: 0,
          stderrBytes: 8,
          stderrTail: 'transport failed',
          transportFailure: new Error('ack failed'),
        },
      }),
    },
    {
      name: '缺少严格重读结果',
      change: (): Partial<ProjectSandboxRunnerResultInput> => ({ evaluation: undefined }),
    },
    {
      name: '存在内部 settlement failure',
      change: (): Partial<ProjectSandboxRunnerResultInput> => ({
        terminal: completeTerminal({ settlementFailures: ['resource_release_failed'] }),
      }),
    },
  ])('自然路径在$name时统一降为 transport failure', ({ name, change }) => {
    const result = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      utilityForked: true,
      terminal: completeTerminal(),
      utilityExit: successfulUtilityExit(),
      evaluation: successfulEvaluation(),
      ...change(),
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'transport',
        message: 'Sandbox runner 运行时通信失败。',
      },
    });
    expect(JSON.stringify(result)).not.toContain('resource_release_failed');
    if (name === 'run token 错配') {
      expect('childPid' in result.diagnostics).toBe(false);
      expect(result.diagnostics.protocolEvents).toEqual([]);
      expect(result.stderr).toBe('');
    }
  });

  it('Utility 无 terminal 崩溃时只公开有界诊断尾部和完整 byte 计数', () => {
    const result = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      utilityForked: true,
      utilityExit: {
        exitCode: 1,
        stderrBytes: 123_456,
        stderrTail: 'utility diagnostic tail',
      },
    });

    expect(result).toMatchObject({
      success: false,
      stderr: 'utility diagnostic tail',
      diagnostics: {
        startConfirmed: false,
        protocolEvents: [],
        stderrBytes: 123_456,
      },
      error: {
        type: 'transport',
        message: 'Sandbox runner 运行时通信失败。',
      },
    });
  });

  it.each([
    ['cancelled', 'Sandbox runner 因宿主取消而终止。'],
    ['owner_ended', 'Sandbox runner 因宿主结束而终止。'],
  ] as const)('fork 前 %s intent 在没有跨进程事实时形成稳定结果', (intent, message) => {
    const result = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      utilityForked: false,
      terminationIntent: intent,
    });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'transport', message },
      diagnostics: {
        protocolEvents: [],
        stderrBytes: 0,
      },
    });
    expect('childPid' in result.diagnostics).toBe(false);
  });

  it('ready 前 owner end 已获 ACK 且 Utility 零退出时保持稳定 owner 结果', () => {
    const result = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      terminationIntent: 'owner_ended',
      utilityForked: true,
      utilityExit: successfulUtilityExit(),
    });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'transport', message: 'Sandbox runner 因宿主结束而终止。' },
    });
  });

  it('Utility 已 fork 但始终没有 exit 时不能冒充已取消', () => {
    const result = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      terminationIntent: 'cancelled',
      utilityForked: true,
      hostSettlementFailure: new Error('kill did not produce exit'),
      hostCleanupIncomplete: true,
    });

    expect(result).toMatchObject({
      error: { type: 'transport', message: 'Sandbox runner 运行时通信失败。' },
    });
  });

  it('terminal 事实优先于 fork 前 intent，host 清理失败只降为通用 transport', () => {
    const natural = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      utilityForked: true,
      terminal: completeTerminal(),
      utilityExit: successfulUtilityExit(),
      evaluation: successfulEvaluation(),
      terminationIntent: 'cancelled',
    });
    expect(natural.success).toBe(true);

    const cleanupFailure = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      utilityForked: true,
      terminal: completeTerminal(),
      utilityExit: successfulUtilityExit(),
      evaluation: successfulEvaluation(),
      hostSettlementFailure: new Error('/private/run/path could not be removed'),
      hostCleanupIncomplete: true,
    });
    expect(cleanupFailure).toMatchObject({
      success: false,
      error: {
        type: 'transport',
        message: 'Sandbox runner 运行时通信失败。',
      },
    });
    expect(JSON.stringify(cleanupFailure)).not.toContain('/private/run/path');
  });

  it('错 token 与 host 清理同时失败时也不借用错误 run 的诊断', () => {
    const result = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      utilityForked: true,
      terminal: completeTerminal({
        runToken: MISMATCHED_RUN_TOKEN,
      }),
      utilityExit: successfulUtilityExit(),
      hostSettlementFailure: new Error('cleanup failed'),
      hostCleanupIncomplete: true,
    });

    expect(result.stderr).toBe('');
    expect(result.diagnostics.protocolEvents).toEqual([]);
    expect('childPid' in result.diagnostics).toBe(false);
    expect(result.diagnostics.cleanupStatus).toBe('failed');
  });

  it('外层 timeout 已冻结后，host 清理失败不改写首因', () => {
    const result = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      utilityForked: true,
      terminal: completeTerminal({ cause: 'timed_out' }),
      utilityExit: successfulUtilityExit(),
      hostSettlementFailure: new Error('cleanup failed'),
      hostCleanupIncomplete: true,
    });

    expect(result).toMatchObject({
      error: { type: 'timeout', message: 'Sandbox runner 超时终止（>2000ms）。' },
      elapsedMs: 2_000,
      diagnostics: { cleanupStatus: 'failed' },
    });
  });

  it('fork 前执行失败没有创建资源时不误报清理失败', () => {
    const result = projectSandboxRunnerResult({
      runToken: RUN_TOKEN,
      limits: LIMITS,
      utilityForked: false,
      hostSettlementFailure: new Error('timeout arithmetic overflow'),
    });

    expect(result).toMatchObject({
      error: { type: 'transport', message: 'Sandbox runner 运行时通信失败。' },
      diagnostics: { cleanupStatus: 'succeeded' },
    });
  });
});

function completeTerminal(
  overrides: Partial<SandboxUtilityTerminalPayload> = {}
): SandboxUtilityTerminalPayload {
  return {
    kind: 'sandbox_terminal',
    runToken: RUN_TOKEN,
    cause: 'natural',
    rootExit: { exitCode: 0, signal: null },
    control: {
      acceptedFrames: ['ready', 'started', 'result_committed'],
      evaluatorPid: 2468,
      windowsCrLfPreambleObserved: false,
      completed: true,
    },
    stderrBytes: 98_765,
    stderrTail: 'evaluator diagnostic tail',
    settlementFailures: [],
    ...overrides,
  };
}

function successfulUtilityExit(): SandboxUtilityProcessExit {
  return { exitCode: 0, stderrBytes: 0, stderrTail: '' };
}

function successfulEvaluation(): SandboxRunnerEvaluationResult {
  return {
    success: true,
    value: { ok: true },
    logs: ['业务日志'],
    elapsedMs: 18,
    capabilityCalls: [{ name: 'asset.read', payload: { id: 'asset-1' } }],
    deniedActions: ['network.fetch'],
  };
}
