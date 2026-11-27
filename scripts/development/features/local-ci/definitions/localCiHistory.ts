import type { LocalCiFailureDigest } from './localCiFailureDigest';
import type { StepOutcome } from './localCiPlan';
import type { LocalCiStepKind } from './localCiSchedule';

/**
 * 运行历史：每轮运行（`--list` 除外）结束时向 `_dev_data/ci-local/history.jsonl` 追加一行。
 * 它不是运行目录，按保留规则清理时不会被删，所以运行目录只留最近一批时仍能看几周的趋势。
 * 本机工具按这份格式读取；改字段含义时把版本加一。
 */
export const LOCAL_CI_HISTORY_FILE = 'history.jsonl';
export const LOCAL_CI_HISTORY_VERSION = 1;

/** 运行期间每 30 秒采一次 1 分钟负载。 */
export const LOCAL_CI_LOAD_SAMPLE_MS = 30_000;

export interface LocalCiLoadSummary {
  readonly cores: number;
  readonly samples: number;
  readonly mean: number;
  readonly max: number;
}

export interface LocalCiHistoryFailedStep {
  /** `任务 › 步骤`，与终端汇总一致。 */
  readonly step: string;
  readonly kind: LocalCiStepKind;
  readonly networkFailure: boolean;
  /** 合并测试失败后隔离重跑的结果；没有重跑时省略。 */
  readonly isolatedRerun?: StepOutcome;
}

/** 生成历史行要用到的步骤事实：步骤结果里的这几项，其余（日志路径、合并记录等）只留在回执里。 */
export interface LocalCiHistoryStepFacts {
  readonly jobLabel: string;
  readonly name: string;
  readonly outcome: StepOutcome;
  readonly kind: LocalCiStepKind;
  readonly reusedFrom?: string;
  readonly failureDigest?: Pick<LocalCiFailureDigest, 'networkFailure' | 'isolatedRerun'>;
}

export interface LocalCiHistoryEntry {
  readonly v: typeof LOCAL_CI_HISTORY_VERSION;
  /** 运行目录名（UTC 开始时间）。 */
  readonly run: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly commit: string;
  readonly tree: string;
  readonly clean: boolean;
  /** 没有用 `--workflow` / `--job` / `--working-copy` 缩小范围。被中断的全量运行这里仍为 true，而 fullRun 为 false。 */
  readonly fullScope: boolean;
  readonly fullRun: boolean;
  readonly passed: boolean;
  readonly interrupted: boolean;
  readonly durationMs: number;
  readonly failedSteps: readonly LocalCiHistoryFailedStep[];
  readonly load: LocalCiLoadSummary;
}
