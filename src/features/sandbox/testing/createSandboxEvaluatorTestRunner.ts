import type { SandboxRunnerPort } from '../ports/sandboxRunnerPort.js';
import { evaluateSandboxRunnerRequest } from '../runner-evaluation/functions/evaluateSandboxRunnerRequest.js';

/**
 * 业务测试只需穿过唯一 evaluator，不应为了测试 profile 再启动一套旧进程运行时。
 * 该适配器不模拟取消、空闲超时、堆限制或进程归属；这些能力由正式平台端到端测试验证。
 */
export function createSandboxEvaluatorTestRunner(): SandboxRunnerPort {
  return {
    async execute(request) {
      const evaluation = await evaluateSandboxRunnerRequest(request, {
        confirmStarted: async () => {},
      });

      return {
        ...evaluation,
        stderr: '',
        diagnostics: {
          runnerKind: 'test-evaluator',
          startConfirmed: true,
          heartbeatCount: 0,
          protocolEvents: ['started', 'result'],
          lastEvent: 'result',
          stderrBytes: 0,
          idleTimeoutTriggered: false,
          cleanupStatus: 'succeeded',
        },
      };
    },
  };
}
