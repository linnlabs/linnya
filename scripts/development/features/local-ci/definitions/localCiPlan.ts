import type { LocalCiStepKind } from './localCiSchedule';

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

/** 测试分片合并为一次运行时的覆盖记录：必须正好覆盖 1..total 的每个分片才会合并。 */
export interface LocalCiShardMerge {
  readonly shards: readonly number[];
  readonly total: number;
  /** 各分片原本的命令，按分片顺序。 */
  readonly originalCommands: readonly string[];
  readonly testWorkers: number;
}

/**
 * 一次执行单元：`steps[0]` 是真正执行的计划步骤，其余步骤共享它的结果（矩阵组合里完全相同的步骤，
 * 或被合并的测试分片）。
 */
export interface LocalCiUnit {
  /** 计划步骤下标；第一个为主步骤。 */
  readonly steps: readonly number[];
  readonly kind: LocalCiStepKind;
  /** false 表示调度表里没有声明，按保守类别执行。 */
  readonly declared: boolean;
  /** 实际执行的命令；合并分片时与主步骤命令不同。 */
  readonly command?: string;
  readonly shardMerge?: LocalCiShardMerge;
}

/** 一个任务（或合并后的一组矩阵组合）内按顺序执行的单元。 */
export interface LocalCiLane {
  readonly label: string;
  readonly units: readonly LocalCiUnit[];
}
