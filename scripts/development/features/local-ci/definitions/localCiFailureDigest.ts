import type { StepOutcome } from './localCiPlan';
import type { LocalCiStepKind } from './localCiSchedule';

/**
 * 摘要的长度上限。目的是让 agent 读回执就能判断失败原因，而不是去翻几万行日志；
 * 完整日志仍在 `log` 路径里。上限按最坏情况算约 10 KB。
 */
export const LOCAL_CI_FAILURE_DIGEST_LIMITS = {
  /** 摘要里列出的失败用例数；总数另记在 failedTestCount。 */
  tests: 8,
  /** 每个失败用例保留的报错行数（断言消息、期望与实际的开头）。 */
  messageLines: 4,
  /** 步骤日志末尾保留的行数。 */
  tailLines: 15,
  /** 每行的字符上限，超出截断。 */
  lineChars: 200,
  /** 记下的失败测试文件数；隔离重跑只在不超过 isolatedRerunFiles 时进行。 */
  files: 50,
  /** 失败文件多于这个数时多半是确定性失败，不做隔离重跑，免得串行跑很久。 */
  isolatedRerunFiles: 10,
} as const;

/** vitest 默认报告里的一个失败用例（或整个文件加载失败）。 */
export interface LocalCiFailedTest {
  readonly file: string;
  /** 用例全名（不含文件）；整个文件加载失败时为空。 */
  readonly test: string;
  readonly message: readonly string[];
  /** 报错位置，形如 `src/foo.test.ts:12:5`。 */
  readonly location?: string;
}

/** 失败用例隔离重跑的结果：只用于诊断，不改变本轮结论。 */
export interface LocalCiIsolatedRerun {
  readonly files: readonly string[];
  readonly command: string;
  readonly outcome: StepOutcome;
  readonly durationMs: number;
  readonly log: string;
}

/**
 * 一个失败步骤的摘要。失败类别直接用步骤声明的调度类别（kind），
 * 加上“是否网络原因”“隔离重跑是否通过”两个信号，不另写日志分类器。
 */
export interface LocalCiFailureDigest {
  readonly kind: LocalCiStepKind;
  /** 日志里出现了构建脚本在重试用尽后写下的网络失败标记。 */
  readonly networkFailure: boolean;
  readonly failedTestCount: number;
  readonly failedTests: readonly LocalCiFailedTest[];
  readonly failedTestFiles: readonly string[];
  readonly tail: readonly string[];
  /** 只有合并测试运行、且失败文件数在上限内时才有。 */
  readonly isolatedRerun?: LocalCiIsolatedRerun;
}
