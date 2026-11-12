/** 本地 CI 只模拟 macOS runner；runner.os 与矩阵选择都按这个平台判断。 */
export const LOCAL_CI_RUNNER_OS = 'macOS';

export type StepOutcome = 'success' | 'failure' | 'skipped';

/** 步骤条件求值时可见的事实：只包含本地能如实提供的内容。 */
export interface WorkflowConditionContext {
  readonly runnerOs: string;
  readonly matrix: Readonly<Record<string, string | number | boolean>>;
  /** 同一任务里已执行步骤（按 step id）的结果。 */
  readonly stepOutcomes: Readonly<Record<string, StepOutcome>>;
  /** 同一任务里之前是否已有步骤失败，用于 success()/failure()。 */
  readonly jobFailed: boolean;
}

/** 条件或命令里出现本地无法如实提供的值（needs、secrets、github 事件等）。 */
export class UnsupportedWorkflowExpression extends Error {
  constructor(readonly expression: string, reason: string) {
    super(`${reason}: ${expression}`);
    this.name = 'UnsupportedWorkflowExpression';
  }
}

export interface LocalCiStep {
  /** 计划内唯一键：工作流/任务[/矩阵]/序号。 */
  readonly key: string;
  readonly workflow: string;
  readonly job: string;
  readonly jobLabel: string;
  readonly name: string;
  readonly stepId?: string;
  readonly condition?: string;
  readonly matrix: Readonly<Record<string, string | number | boolean>>;
  readonly command?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly workingDirectory?: string;
  readonly shell?: string;
  /** 没有命令或本地不执行的原因；有值时只报告、不运行。 */
  readonly localSkip?: string;
  /** upload-artifact 声明保留的证据路径，失败时从干净检出复制出来。 */
  readonly evidencePaths?: readonly string[];
}

export interface LocalCiSkippedJob {
  readonly workflow: string;
  readonly job: string;
  readonly reason: string;
}

export interface LocalCiPlan {
  readonly steps: readonly LocalCiStep[];
  readonly skippedJobs: readonly LocalCiSkippedJob[];
}
