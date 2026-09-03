import type { SandboxRunnerResult } from '../../definitions/sandboxRunner.js';

/** evaluator 只返回业务结果；stderr、PID 和协议事件由具体 transport owner 补充。 */
export type SandboxRunnerEvaluationResult = Omit<SandboxRunnerResult, 'stderr' | 'diagnostics'>;

export interface SandboxRunnerEvaluationLifecycle {
  /** 用户代码开始前必须先把 started 事实可靠地交给 transport。 */
  confirmStarted(): Promise<void>;
}
